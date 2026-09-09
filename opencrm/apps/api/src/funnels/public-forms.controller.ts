import { BadRequestException, Body, Controller, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";

class SubmitFormDto {
  @IsObject() fields!: Record<string, unknown>;
  /** Honeypot anti-spam: legit builders leave it empty; bots fill it. Non-empty → fake success, nothing stored. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

/**
 * Public form capture — makes builder `form` blocks functional end-to-end.
 * No auth (it's the public site). Strict throttle + caps; never leaks whether the page exists to spammers
 * beyond 404 for truly unknown ids (needed for legit debugging).
 */
@Controller("public")
export class PublicFormsController {
  constructor(private prisma: PrismaService) {}

  @Post("forms/:pageId/submit")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  async submit(@Param("pageId") pageId: string, @Body() dto: SubmitFormDto) {
    // Spam fast-path: pretend success without touching the DB.
    if (dto.website && dto.website.trim().length > 0) return { ok: true };

    const fields = dto.fields ?? {};
    const keys = Object.keys(fields);
    if (keys.length === 0 || keys.length > 20) throw new BadRequestException("fields must have 1-20 entries");
    const clean: Record<string, string> = {};
    for (const k of keys) {
      const name = String(k).slice(0, 60);
      const v = fields[k];
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
      clean[name] = String(v).slice(0, 2000);
    }
    const email = Object.entries(clean).find(([k]) => /email/i.test(k))?.[1]?.trim().toLowerCase();
    const phone = Object.entries(clean).find(([k]) => /phone/i.test(k))?.[1]?.trim();
    const name = Object.entries(clean).find(([k]) => /^(name|full.?name)$/i.test(k))?.[1]?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Invalid email");
    if (!email && !phone && !name && Object.keys(clean).length === 0)
      throw new BadRequestException("Provide at least one field value");

    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      include: { funnel: { select: { subAccountId: true } } },
    });
    if (!page) throw new NotFoundException("Page not found");

    const [firstName, ...rest] = (name ?? "").split(/\s+/).filter(Boolean);
    await this.prisma.contact.create({
      data: {
        subAccountId: page.funnel.subAccountId,
        email: email || undefined,
        phone: phone || undefined,
        firstName: firstName || undefined,
        lastName: rest.join(" ") || undefined,
        source: `form:${pageId}`,
        customFields: JSON.stringify(clean).slice(0, 8000),
      },
    });
    return { ok: true };
  }
}
