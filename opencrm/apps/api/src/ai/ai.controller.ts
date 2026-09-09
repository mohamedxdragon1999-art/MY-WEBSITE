import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AiService } from "./ai.service";

class GeneratePageDto {
  @IsString() @MaxLength(8000) prompt!: string;
  @IsOptional() @IsString() @MaxLength(32) provider?: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
  @IsOptional() @IsIn(["structured", "html"]) mode?: "structured" | "html";
  @IsOptional() @IsString() @MaxLength(120) system?: string;
}

class EditElementDto {
  @IsString() @MaxLength(4000) instruction!: string;
  @IsObject() element!: any;
  @IsOptional() @IsString() @MaxLength(120) system?: string;
  @IsOptional() @IsIn(["structured", "html"]) mode?: "structured" | "html";
}

class SaveConfigDto {
  @IsString() @MaxLength(32) provider!: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
}

class KeyEntryDto {
  @IsString() @MaxLength(500) apiKey!: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

class SaveKeysDto {
  @IsString() @MaxLength(32) provider!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => KeyEntryDto) keys!: KeyEntryDto[];
  @IsOptional() @IsString() @MaxLength(200) model?: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
}

class TestConnectionDto {
  @IsOptional() @IsString() @MaxLength(32) provider?: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
}

class ImportUrlDto {
  @IsString() @MaxLength(2000) url!: string;
  @IsOptional() @IsString() @MaxLength(32) provider?: string;
  @IsOptional() @IsString() @MaxLength(500) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(500) apiKey?: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
  @IsOptional() @IsIn(["structured", "html"]) mode?: "structured" | "html";
  @IsOptional() @IsString() @MaxLength(120) system?: string;
}

/** 4xx validation/config errors must reach the client as 4xx. Only upstream failures fall back. */
function isClientError(e: any): boolean {
  const status = e?.status ?? e?.getStatus?.();
  if (typeof status === "number") return status >= 400 && status < 500;
  if (e instanceof BadRequestException) return true;
  const msg = String(e?.message ?? "");
  return /prompt|instruction|element|Unknown design|Invalid|too long|too large|corrupt|No AI provider|API key|Base URL|keys must|model/i.test(msg) && !/^UPSTREAM_|upstream_unavailable|rate_limited|Empty response/i.test(msg);
}

@Controller("ai")
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private svc: AiService) {}

  @Post("generate-page")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async generate(@Req() req: any, @Body() dto: GeneratePageDto) {
    try {
      return await this.svc.generate(req.user.subAccountId, dto.prompt, dto);
    } catch (e: any) {
      if (e instanceof HttpException || isClientError(e)) throw e;
      // Only upstream/transient failures resolve into a usable local fallback so the app never hangs.
      const safePrompt = String(dto.prompt ?? "").slice(0, 500);
      return { document: this.svc.fallbackDocument(safePrompt, dto.system), fallback: true, reason: String(e?.message ?? "AI unavailable").slice(0, 500) };
    }
  }

  @Post("edit-element")
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async editElement(@Req() req: any, @Body() dto: EditElementDto, @Query("provider") provider?: string, @Query("baseUrl") baseUrl?: string, @Query("apiKey") apiKey?: string, @Query("model") model?: string) {
    return this.svc.editElement(
      req.user.subAccountId,
      { instruction: dto.instruction, element: dto.element, system: dto.system, mode: dto.mode },
      { provider, baseUrl, apiKey, model },
    );
  }

  @Post("models")
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async listModels(@Body() dto: TestConnectionDto) {
    return this.svc.listModels(dto);
  }

  @Post("test")
  @Throttle({ default: { ttl: 60_000, limit: 15 } })
  async testConnection(@Req() req: any, @Body() dto: TestConnectionDto) {
    return this.svc.testConnection(req.user.subAccountId, dto);
  }

  @Post("import-url")
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async importUrl(@Req() req: any, @Body() dto: ImportUrlDto) {
    return this.svc.importUrl(req.user.subAccountId, dto.url, dto);
  }

  @Post("config")
  saveConfig(@Req() req: any, @Body() dto: SaveConfigDto) {
    return this.svc.saveConfig(req.user.subAccountId, dto);
  }

  /** Multi-key pool: saves up to 10 keys per provider. Falls back if LOST_KEY rotates mid-generation. */
  @Post("config/keys")
  saveKeys(@Req() req: any, @Body() dto: SaveKeysDto) {
    return this.svc.saveKeys(req.user.subAccountId, dto.provider, dto.keys, { model: dto.model, baseUrl: dto.baseUrl });
  }

  /** Returns the last 10 attempts with per-key status so users can ubável keys. */
  @Get("config/keys/:provider")
  getKeys(@Req() req: any, @Param("provider") p: string) {
    return this.svc.listKeys(req.user.subAccountId, p);
  }

  @Get("config")
  listConfigs(@Req() req: any) {
    return this.svc.listConfigs(req.user.subAccountId);
  }

  @Get("usage")
  usage(@Req() req: any) {
    return this.svc.getUsage(req.user.subAccountId);
  }
}