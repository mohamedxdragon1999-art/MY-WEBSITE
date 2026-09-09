import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException();
    const token = header.slice(7);
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub: string }>(token);
    } catch {
      throw new UnauthorizedException();
    }
    if (!payload?.sub) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { subAccount: { include: { agency: true } } },
    });
    if (!user || !user.subAccountId) throw new UnauthorizedException();
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      subAccountId: user.subAccountId,
      agencyId: (user.subAccount as any)?.agencyId ?? (user.subAccount as any)?.agency?.id,
    };
    return true;
  }
}
