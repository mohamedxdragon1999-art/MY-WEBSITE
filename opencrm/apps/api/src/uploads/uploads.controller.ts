import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES_PER_ACCOUNT = 100;
const NAME_RE = /^[a-f0-9-]{10,80}\.(png|jpg|jpeg|gif|webp)$/;

/** Writable library dir: <repo>/apps/api/uploads in both ts-node (src) and compiled (dist) layouts. */
export function uploadsRoot(): string {
  return path.join(__dirname, "..", "..", "uploads");
}

function accountDir(subAccountId: string): string {
  const safe = String(subAccountId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new BadRequestException("Invalid account");
  return path.join(uploadsRoot(), safe);
}

/** Magic-byte sniffing — never trust client MIME or extension. */
export function detectImage(buf: Buffer): "png" | "jpg" | "gif" | "webp" | null {
  if (!Buffer.isBuffer(buf) || buf.length < 12) {
    if (Buffer.isBuffer(buf) && buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
    if (Buffer.isBuffer(buf) && buf.length >= 6 && /^GIF8[79]a/.test(buf.toString("ascii", 0, 6))) return "gif";
    return null;
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (/^GIF8[79]a/.test(buf.toString("ascii", 0, 6))) return "gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

@Controller("uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  @Post("image")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES, files: 1 } }))
  async uploadImage(@Req() req: any, @UploadedFile() file?: any) {
    if (!file?.buffer?.length) throw new BadRequestException("No image uploaded (multipart field 'file')");
    const ext = detectImage(file.buffer);
    if (!ext) throw new BadRequestException("Only PNG, JPEG, GIF or WebP images are accepted");
    const dir = accountDir(req.user.subAccountId);
    await fs.mkdir(dir, { recursive: true });
    const existing = await fs.readdir(dir).catch(() => [] as string[]);
    if (existing.length >= MAX_FILES_PER_ACCOUNT) {
      throw new ConflictException("Image library full (100 files). Delete some first.");
    }
    const name = `${randomUUID()}.${ext}`;
    await fs.writeFile(path.join(dir, name), file.buffer);
    const stat = await fs.stat(path.join(dir, name));
    return { url: `/api/uploads/${path.basename(dir)}/${name}`, name, size: stat.size };
  }

  @Get()
  async list(@Req() req: any) {
    const dir = accountDir(req.user.subAccountId);
    const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => NAME_RE.test(n)).sort().reverse();
    const items = await Promise.all(
      names.map(async (name) => {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        return { name, url: `/api/uploads/${path.basename(dir)}/${name}`, size: stat?.size ?? 0, createdAt: stat?.birthtime ?? stat?.mtime ?? new Date(0) };
      }),
    );
    return { items, total: items.length };
  }

  @Delete(":name")
  @HttpCode(200)
  async remove(@Req() req: any, @Param("name") name: string) {
    if (!NAME_RE.test(String(name))) throw new BadRequestException("Invalid file name");
    const file = path.join(accountDir(req.user.subAccountId), String(name));
    try {
      await fs.unlink(file);
    } catch {
      throw new NotFoundException("File not found");
    }
    return { ok: true };
  }
}
