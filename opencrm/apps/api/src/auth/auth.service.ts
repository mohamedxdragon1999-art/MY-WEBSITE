import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";

const MAX_LOGIN_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Attempt { fails: number; lockedUntil: number; }

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}
  /** Per-email brute-force ledger (per-process; multi-instance needs Redis — see PROGRESS known limits). */
  private attempts = new Map<string, Attempt>();

  async signup(email: string, password: string, firstName: string, lastName: string, agencyName: string) {
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw new BadRequestException("Invalid email");
    if (String(password ?? "").length < 8 || String(password ?? "").length > 128)
      throw new BadRequestException("Password must be 8-128 characters");
    if (!agencyName?.trim()) throw new BadRequestException("Agency name is required");
    try {
      const hash = await bcrypt.hash(password, 10);
      // Unique slug to avoid constraint frustration (slug is non-user-facing)
      const slugRaw = agencyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "agency";
      const slug = `${slugRaw}-${crypto.randomBytes(4).toString("hex")}`;
      const agency = await this.prisma.agency.create({
        data: {
          name: agencyName.slice(0, 120),
          slug,
          subAccounts: { create: { name: "Default" } },
        },
        include: { subAccounts: true },
      });
      const user = await this.prisma.user.create({
        data: { email: cleanEmail, passwordHash: hash, firstName: String(firstName ?? "").slice(0, 80), lastName: String(lastName ?? "").slice(0, 80), role: "AGENCY_OWNER", subAccountId: agency.subAccounts[0].id },
      });
      return this.sign(user.id);
    } catch (e: any) {
      if (e?.code === 'P2002' || /unique/i.test(e?.message ?? '') || /duplicate/i.test(e?.message ?? '')) {
        throw new ConflictException('An account with this email already exists');
      }
      throw e;
    }
  }

  async login(email: string, password: string) {
    const cleanEmail = String(email ?? "").trim().toLowerCase();
    this.assertNotLocked(cleanEmail);
    const user = await this.prisma.user.findUnique({ where: { email: cleanEmail } });
    if (!user) {
      // No user enumeration shortcut change (still 401), but still count the attempt.
      this.noteFail(cleanEmail);
      throw new UnauthorizedException("Invalid credentials");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      this.noteFail(cleanEmail);
      this.assertNotLocked(cleanEmail);
      throw new UnauthorizedException("Invalid credentials");
    }
    this.attempts.delete(cleanEmail);
    return this.sign(user.id);
  }

  private assertNotLocked(email: string): void {
    const a = this.attempts.get(email);
    if (a && a.lockedUntil > Date.now()) {
      const secs = Math.ceil((a.lockedUntil - Date.now()) / 1000);
      throw new HttpException(`Too many failed logins. Try again in ${secs}s.`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private noteFail(email: string): void {
    const a = this.attempts.get(email) ?? { fails: 0, lockedUntil: 0 };
    a.fails += 1;
    if (a.fails >= MAX_LOGIN_FAILS) a.lockedUntil = Date.now() + LOCKOUT_MS;
    this.attempts.set(email, a);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, subAccountId: true, createdAt: true },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (String(newPassword ?? "").length < 8 || String(newPassword ?? "").length > 128)
      throw new BadRequestException("New password must be 8-128 characters");
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Current password is incorrect");
    const hash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    return { ok: true };
  }

  private sign(userId: string) {
    return { accessToken: this.jwt.sign({ sub: userId }) };
  }
}
