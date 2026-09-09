import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { Transform, Type } from "class-transformer";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ContactsService } from "./contacts.service";

function userId(req: any): string {
  if (!req?.user?.subAccountId) throw new UnauthorizedException();
  return req.user.subAccountId;
}

class CreateContactDto {
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
}

class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
}

class ListContactsQuery {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) skip?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @Transform(({ value }) => value === true || value === "1" || value === "true") @IsBoolean() envelope?: boolean;
}

@Controller("contacts")
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private svc: ContactsService) {}

  @Get()
  list(@Req() req: any, @Query() query: ListContactsQuery) { return this.svc.list(userId(req), query); }

  @Post()
  create(@Req() req: any, @Body() dto: CreateContactDto) { return this.svc.create(userId(req), dto); }

  @Patch("/:id")
  update(@Req() req: any, @Param("id") id: string, @Body() dto: UpdateContactDto) {
    return this.svc.update(userId(req), id, dto);
  }

  @Delete("/:id")
  @HttpCode(200)
  remove(@Req() req: any, @Param("id") id: string) { return this.svc.remove(userId(req), id); }
}
