import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MAX_DOCUMENT_BYTES, createEmptyDocument, safeParseDocument, type PageDocument } from "@opencrm/shared";

@Injectable()
export class FunnelsService {
  constructor(private prisma: PrismaService) {}

  async list(subAccountId: string, envelope?: boolean) {
    const funnels = await this.prisma.funnel.findMany({
      where: { subAccountId },
      orderBy: { updatedAt: "desc" },
      include: { pages: { orderBy: { order: "asc" } } },
    }).then((rows) => rows.map((f) => ({ ...f, pages: f.pages.map(p => ({ ...p, document: parseDoc(p.document) })) })));
    // Default stays a bare array (frontend-compatible); ?envelope=1 opts into metadata.
    if (envelope) return { items: funnels, total: funnels.length };
    return funnels;
  }

  async create(subAccountId: string, name: string) {
    const clean = String(name ?? "").trim().slice(0, 120);
    if (!clean) throw new BadRequestException("Funnel name is required");
    const base = "/" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    // Retry suffix on path collision (P2002) instead of 500.
    for (let attempt = 0; attempt < 3; attempt++) {
      const path = `${base || "/funnel"}-${Date.now().toString(36)}${attempt > 0 ? `-${attempt}` : ""}`;
      try {
        const funnel = await this.prisma.funnel.create({
          data: {
            subAccountId,
            name: clean,
            path,
            pages: { create: { title: "Home", slug: "home", order: 0, document: JSON.stringify(createEmptyDocument()) } },
          },
          include: { pages: true },
        });
        return { ...funnel, pages: funnel.pages.map((p) => ({ ...p, document: parseDoc(p.document) })) };
      } catch (e: any) {
        if (e?.code === "P2002" && attempt < 2) continue;
        throw e;
      }
    }
    throw new BadRequestException("Could not create funnel path, retry");
  }

  async getPage(subAccountId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, funnel: { subAccountId } },
    });
    if (!page) throw new NotFoundException("Page not found");
    return { ...page, document: parseDoc(page.document) };
  }

  async rename(subAccountId: string, funnelId: string, name: string) {
    const clean = String(name ?? "").trim().slice(0, 120);
    if (!clean) throw new BadRequestException("Funnel name is required");
    const existing = await this.prisma.funnel.findFirst({ where: { id: funnelId, subAccountId } });
    if (!existing) throw new NotFoundException("Funnel not found");
    return this.prisma.funnel.update({ where: { id: funnelId }, data: { name: clean } });
  }

  async remove(subAccountId: string, funnelId: string) {
    const res = await this.prisma.funnel.deleteMany({ where: { id: funnelId, subAccountId } });
    if (res.count === 0) throw new NotFoundException("Funnel not found");
    return { ok: true, deleted: res.count };
  }

  async clone(subAccountId: string, funnelId: string) {
    const src = await this.prisma.funnel.findFirst({
      where: { id: funnelId, subAccountId },
      include: { pages: { orderBy: { order: "asc" } } },
    });
    if (!src) throw new NotFoundException("Funnel not found");
    const name = `${src.name} (Copy)`.slice(0, 120);
    const path = `/copy-${src.path.replace(/^\//, "").slice(0, 30)}-${Date.now().toString(36)}`;
    return this.prisma.funnel.create({
      data: {
        subAccountId,
        name,
        path,
        pages: {
          create: src.pages.map((p, i) => ({
            title: p.title,
            slug: `${p.slug}-copy`,
            order: i,
            document: p.document,
            seo: p.seo,
          })),
        },
      },
      include: { pages: { orderBy: { order: "asc" } } },
    }).then((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, document: parseDoc(p.document) })) }));
  }

  async createPage(subAccountId: string, funnelId: string, title: string) {
    const clean = String(title ?? "").trim().slice(0, 120) || "Untitled";
    const funnel = await this.prisma.funnel.findFirst({
      where: { id: funnelId, subAccountId },
      include: { pages: { orderBy: { order: "desc" }, take: 1 } },
    });
    if (!funnel) throw new NotFoundException("Funnel not found");
    const order = (funnel.pages[0]?.order ?? -1) + 1;
    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `page-${order}`;
    const page = await this.prisma.page.create({
      data: { funnelId, title: clean, slug: `${slug}-${Date.now().toString(36)}`, order, document: JSON.stringify(createEmptyDocument()) },
    });
    return { ...page, document: parseDoc(page.document) };
  }

  async renamePage(subAccountId: string, pageId: string, title: string) {
    const clean = String(title ?? "").trim().slice(0, 120);
    if (!clean) throw new BadRequestException("Page title is required");
    await this.getPage(subAccountId, pageId);
    return this.prisma.page.update({ where: { id: pageId }, data: { title: clean } });
  }

  async deletePage(subAccountId: string, pageId: string) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, funnel: { subAccountId } },
      include: { funnel: { include: { pages: { select: { id: true } } } } },
    });
    if (!page) throw new NotFoundException("Page not found");
    if (page.funnel.pages.length <= 1) throw new BadRequestException("Cannot delete the only page of a funnel");
    const res = await this.prisma.page.deleteMany({ where: { id: pageId, funnel: { subAccountId } } });
    return { ok: true, deleted: res.count };
  }

  async updatePageDocument(subAccountId: string, pageId: string, document: PageDocument) {
    // Strict gate: size cap + Zod shape. Never silently strip sections.
    if (!document || typeof document !== "object") throw new BadRequestException("document must be a PageDocument object");
    const bytes = Buffer.byteLength(JSON.stringify(document), "utf8");
    if (bytes > MAX_DOCUMENT_BYTES)
      throw new PayloadTooLargeException(`document too large (${bytes} bytes, max ${MAX_DOCUMENT_BYTES})`);
    const checked = safeParseDocument(document);
    if (!checked.ok) throw new BadRequestException(`Invalid document: ${checked.error}`);
    await this.getPage(subAccountId, pageId);
    const updated = await this.prisma.page.update({ where: { id: pageId }, data: { document: JSON.stringify(checked.document) } });
    // Snapshot version history (fire-and-forget prune to last 20).
    await this.snapshotVersion(pageId, checked.document).catch(() => undefined);
    return { ...updated, document: parseDoc(updated.document) };
  }

  /** Last-20 version snapshots per page (server-side undo for the builder). */
  async listVersions(subAccountId: string, pageId: string) {
    await this.getPage(subAccountId, pageId);
    const rows = await this.prisma.pageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, bytes: true },
    });
    return rows;
  }

  async getVersion(subAccountId: string, pageId: string, versionId: string) {
    await this.getPage(subAccountId, pageId);
    const v = await this.prisma.pageVersion.findFirst({ where: { id: versionId, pageId } });
    if (!v) throw new NotFoundException("Version not found");
    return { id: v.id, createdAt: v.createdAt, document: parseDoc(v.document) };
  }

  async restoreVersion(subAccountId: string, pageId: string, versionId: string) {
    const v = await this.getVersion(subAccountId, pageId, versionId);
    // Restoring goes through the normal validated save path (which snapshots current first).
    return this.updatePageDocument(subAccountId, pageId, v.document);
  }

  private async snapshotVersion(pageId: string, document: PageDocument) {
    const raw = JSON.stringify(document);
    await this.prisma.pageVersion.create({
      data: { pageId, document: raw, bytes: Buffer.byteLength(raw, "utf8") },
    });
    const count = await this.prisma.pageVersion.count({ where: { pageId } });
    if (count > 20) {
      const keep = await this.prisma.pageVersion.findMany({
        where: { pageId },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true },
      });
      const keepIds = new Set(keep.map((k) => k.id));
      const old = await this.prisma.pageVersion.findMany({ where: { pageId }, select: { id: true } });
      const dropIds = old.map((o) => o.id).filter((id) => !keepIds.has(id));
      if (dropIds.length > 0) await this.prisma.pageVersion.deleteMany({ where: { id: { in: dropIds } } });
    }
  }

  async getPublicPage(pageId: string) {
    const page = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!page) throw new NotFoundException("Page not found");
    return { title: page.title, slug: page.slug, seo: parseSeo(page.seo), document: parseDoc(page.document) };
  }

  async updateMeta(subAccountId: string, pageId: string, patch: { title?: string; slug?: string; description?: string }) {
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, funnel: { subAccountId } },
    });
    if (!page) throw new NotFoundException("Page not found");
    const data: Record<string, string> = {};
    if (patch.title !== undefined) {
      const title = String(patch.title).trim().slice(0, 120);
      if (!title) throw new BadRequestException("Title cannot be empty");
      data.title = title;
    }
    if (patch.slug !== undefined) {
      const slug = String(patch.slug).trim().toLowerCase().slice(0, 80);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
        throw new BadRequestException("Slug must be lowercase letters, numbers and single hyphens");
      }
      const clash = await this.prisma.page.findFirst({ where: { funnelId: page.funnelId, slug, id: { not: pageId } } });
      if (clash) throw new ConflictException("Another page in this funnel already uses that slug");
      data.slug = slug;
    }
    if (patch.description !== undefined) {
      const seo = parseSeo(page.seo);
      seo.description = String(patch.description).slice(0, 300);
      data.seo = JSON.stringify(seo);
    }
    if (Object.keys(data).length === 0) throw new BadRequestException("Provide title, slug or description");
    const updated = await this.prisma.page.update({ where: { id: pageId }, data });
    return { id: updated.id, title: updated.title, slug: updated.slug, seo: parseSeo(updated.seo) };
  }

  async publish(subAccountId: string, pageId: string) {
    await this.getPage(subAccountId, pageId);
    return this.prisma.page.update({ where: { id: pageId }, data: { publishedAt: new Date() } });
  }
}

function parseDoc(doc: unknown): PageDocument {
  if (typeof doc !== "string") return doc as PageDocument;
  try { return JSON.parse(doc) as PageDocument; } catch { return createEmptyDocument(); }
}

function parseSeo(seo: unknown): Record<string, string> {
  if (seo && typeof seo === "object") return seo as Record<string, string>;
  if (typeof seo === "string") {
    try {
      const v = JSON.parse(seo);
      if (v && typeof v === "object") return v;
    } catch { /* fall through */ }
  }
  return {};
}