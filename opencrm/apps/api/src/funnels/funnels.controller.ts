import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsObject, IsOptional, IsString, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { FunnelsService } from "./funnels.service";

class CreateFunnelDto { @IsString() @MaxLength(120) name!: string; }
class RenameFunnelDto { @IsString() @MaxLength(120) name!: string; }
class CreatePageDto { @IsOptional() @IsString() @MaxLength(120) title?: string; }
class RenamePageDto { @IsString() @MaxLength(120) title!: string; }
class UpdateMetaDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(80) slug?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
}
class UpdateDocumentDto {
  @IsObject()
  document!: any;
}

@Controller("funnels")
export class FunnelsController {
  constructor(private svc: FunnelsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  list(@Req() req: any, @Query("envelope") envelopeRaw?: string) {
    const envelope = envelopeRaw === "1" || envelopeRaw === "true";
    return this.svc.list(req.user.subAccountId, envelope);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@Req() req: any, @Body() dto: CreateFunnelDto) {
    return this.svc.create(req.user.subAccountId, dto.name);
  }

  @Patch(":id")
  @UseGuards(JwtAuthGuard)
  rename(@Req() req: any, @Param("id") id: string, @Body() dto: RenameFunnelDto) {
    return this.svc.rename(req.user.subAccountId, id, dto.name);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  remove(@Req() req: any, @Param("id") id: string) {
    return this.svc.remove(req.user.subAccountId, id);
  }

  @Post(":id/clone")
  @UseGuards(JwtAuthGuard)
  clone(@Req() req: any, @Param("id") id: string) {
    return this.svc.clone(req.user.subAccountId, id);
  }

  @Post(":funnelId/pages")
  @UseGuards(JwtAuthGuard)
  createPage(@Req() req: any, @Param("funnelId") funnelId: string, @Body() dto: CreatePageDto) {
    return this.svc.createPage(req.user.subAccountId, funnelId, dto.title ?? "Untitled");
  }

  @Get("page/:pageId")
  @UseGuards(JwtAuthGuard)
  getPage(@Req() req: any, @Param("pageId") pageId: string) {
    return this.svc.getPage(req.user.subAccountId, pageId);
  }

  @Patch("page/:pageId")
  @UseGuards(JwtAuthGuard)
  renamePage(@Req() req: any, @Param("pageId") pageId: string, @Body() dto: RenamePageDto) {
    return this.svc.renamePage(req.user.subAccountId, pageId, dto.title);
  }

  @Patch("page/:pageId/meta")
  @UseGuards(JwtAuthGuard)
  updateMeta(@Req() req: any, @Param("pageId") pageId: string, @Body() dto: UpdateMetaDto) {
    return this.svc.updateMeta(req.user.subAccountId, pageId, dto);
  }

  @Delete("page/:pageId")
  @UseGuards(JwtAuthGuard)
  deletePage(@Req() req: any, @Param("pageId") pageId: string) {
    return this.svc.deletePage(req.user.subAccountId, pageId);
  }

  @Get("public-page/:pageId")
  getPublicPage(@Param("pageId") pageId: string) {
    return this.svc.getPublicPage(pageId);
  }

  @Patch("page/:pageId/document")
  @UseGuards(JwtAuthGuard)
  updateDocument(@Req() req: any, @Param("pageId") pageId: string, @Body() dto: UpdateDocumentDto) {
    return this.svc.updatePageDocument(req.user.subAccountId, pageId, dto.document);
  }

  @Get("page/:pageId/versions")
  @UseGuards(JwtAuthGuard)
  listVersions(@Req() req: any, @Param("pageId") pageId: string) {
    return this.svc.listVersions(req.user.subAccountId, pageId);
  }

  @Get("page/:pageId/versions/:versionId")
  @UseGuards(JwtAuthGuard)
  getVersion(@Req() req: any, @Param("pageId") pageId: string, @Param("versionId") versionId: string) {
    return this.svc.getVersion(req.user.subAccountId, pageId, versionId);
  }

  @Post("page/:pageId/restore/:versionId")
  @UseGuards(JwtAuthGuard)
  restoreVersion(@Req() req: any, @Param("pageId") pageId: string, @Param("versionId") versionId: string) {
    return this.svc.restoreVersion(req.user.subAccountId, pageId, versionId);
  }

  @Post("page/:pageId/publish")
  @UseGuards(JwtAuthGuard)
  publish(@Req() req: any, @Param("pageId") pageId: string) {
    return this.svc.publish(req.user.subAccountId, pageId);
  }
}
