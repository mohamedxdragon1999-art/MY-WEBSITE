import { BadRequestException, Body, ConflictException, Controller, Get, HttpException, InternalServerErrorException, Post, Req, UseGuards } from "@nestjs/common";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

class SignupDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsString() @MaxLength(80) firstName!: string;
  @IsString() @MaxLength(80) lastName!: string;
  @IsString() @MaxLength(120) agencyName!: string;
}
class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MaxLength(128) password!: string;
}
class ChangePasswordDto {
  @IsString() @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

@Controller("auth")
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post("signup")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async signup(@Body() dto: SignupDto) {
    try {
      return await this.auth.signup(dto.email, dto.password, dto.firstName, dto.lastName, dto.agencyName);
    } catch (e: any) {
      // Preserve client-error statuses; only mask true server faults.
      if (e instanceof HttpException) throw e;
      if (e?.status === 400 || e?.status === 409) throw e;
      const msg = String(e?.message ?? "Signup failed");
      if (/already exists/i.test(msg)) throw new ConflictException("An account with this email already exists");
      throw new InternalServerErrorException("Signup failed");
    }
  }

  @Post("login")
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  login(@Body() dto: LoginDto) { return this.auth.login(dto.email, dto.password); }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@Req() req: any) { return this.auth.me(req.user.id); }

  @Post("change-password")
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(req.user.id, dto.currentPassword, dto.newPassword);
  }
}