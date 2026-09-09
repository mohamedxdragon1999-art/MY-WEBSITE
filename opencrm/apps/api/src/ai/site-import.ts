import { BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import { createBlock, createEmptyDocument, newId, type PageDocument } from "@opencrm/shared";

/**
 * Website-URL import: fetch a public page (SSRF-guarded), extract its essence,
 * then either let the LLM recreate it as an original full page or synthesize
 * a deterministic document from the brief when AI is unavailable.
 */

export const MAX_SITE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

export interface SiteBrief {
  url: string;
  title: string;
  description: string;
  h1: string[];
  headings: string[];
  texts: string[];
  points: string[];
  images: Array<{ src: string; alt: string }>;
  ctas: Array<{ text: string; href: string }>;
  colors: string[];
}

/** Same SSRF policy as provider base URLs, but returns the untouched URL for fetching. */
export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? "").slice(0, 2000));
  } catch {
    throw new BadRequestException("Invalid URL");
  }
  if (url.username || url.password) throw new BadRequestException("URLs with credentials are blocked");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException("Only http(s) URLs can be imported");
  const h = url.hostname.toLowerCase();
  if (!h || h.length > 253) throw new BadRequestException("Invalid URL host");
  const blocked =
    h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "0.0.0.0" || h === "::1" || h === "[::1]";
  if (blocked) throw new BadRequestException("Private/local URLs are blocked (SSRF protection)");
  return url;
}

export async function fetchSiteHtml(rawUrl: string): Promise<{ html: string; finalUrl: string }> {
  let current = assertSafeHttpUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "User-Agent": "OpenCRM-SiteImport/1.0 (+website builder)", Accept: "text/html" },
      });
    } catch (e: any) {
      if (e?.name === "TimeoutError") throw new HttpException("Fetching that URL timed out (15s).", HttpStatus.BAD_GATEWAY);
      throw new HttpException("Could not fetch that URL.", HttpStatus.BAD_GATEWAY);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop === MAX_REDIRECTS) throw new HttpException("Too many redirects.", HttpStatus.BAD_GATEWAY);
      try {
        current = assertSafeHttpUrl(new URL(res.headers.get("location")!, current).toString());
      } catch (e: any) {
        if (e instanceof HttpException) throw e;
        throw new HttpException("Redirect target is not importable.", HttpStatus.BAD_GATEWAY);
      }
      continue;
    }
    if (!res.ok) throw new HttpException(`That URL answered HTTP ${res.status}.`, HttpStatus.BAD_GATEWAY);
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype && !/text\/html/i.test(ctype)) throw new BadRequestException("That URL did not return an HTML page");
    const len = Number(res.headers.get("content-length") ?? 0);
    if (Number.isFinite(len) && len > MAX_SITE_BYTES) throw new HttpException("That page is too large to import.", HttpStatus.PAYLOAD_TOO_LARGE);
    const html = (await res.text()).slice(0, MAX_SITE_BYTES);
    if (!html.trim()) throw new HttpException("That page returned no content.", HttpStatus.BAD_GATEWAY);
    return { html, finalUrl: current.toString() };
  }
  throw new HttpException("Too many redirects.", HttpStatus.BAD_GATEWAY);
}

function decodeEntities(s: string): string {
  return s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim();
}

export function extractSiteContent(html: string, baseUrl: string): SiteBrief {
  const base = new URL(baseUrl);
  const resolve = (u: string): string => {
    try {
      const abs = new URL(u, base);
      return abs.protocol === "http:" || abs.protocol === "https:" ? abs.toString().slice(0, 2000) : "";
    } catch {
      return "";
    }
  };

  // Colors first (before style tags are stripped).
  const colorSet = new Set<string>();
  const styleSrc = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") +
    [...html.matchAll(/style\s*=\s*"([^"]*)"/gi)].map((m) => m[1]).join("\n");
  for (const m of styleSrc.matchAll(/#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)) {
    if (colorSet.size >= 10) break;
    colorSet.add(m[0].toLowerCase());
  }

  const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const main = noScripts.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? noScripts;
  const body = main.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? main;

  const title = textOf(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 160) ||
    textOf(html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)?.[0] ? attr(html.match(/<meta[^>]+property=["']og:title["'][^>]*>/i)![0], "content") : "").slice(0, 160);
  const descTag = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ?? html.match(/<meta[^>]+property=["']og:description["'][^>]*>/i)?.[0] ?? "";
  const description = textOf(attr(descTag, "content")).slice(0, 300);

  const take = (re: RegExp, n: number, min: number, max: number): string[] => {
    const out: string[] = [];
    for (const m of body.matchAll(re)) {
      if (out.length >= n) break;
      const t = textOf(m[1] ?? m[0]);
      if (t.length >= min && t.length <= max && !out.includes(t)) out.push(t);
    }
    return out;
  };
  const h1 = take(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, 3, 3, 140);
  const headings = take(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi, 12, 3, 140);
  const texts = take(/<p[^>]*>([\s\S]*?)<\/p>/gi, 15, 40, 600);
  const points = take(/<li[^>]*>([\s\S]*?)<\/li>/gi, 15, 10, 200);

  const images: SiteBrief["images"] = [];
  for (const m of body.matchAll(/<img[^>]*>/gi)) {
    if (images.length >= 8) break;
    const src = resolve(attr(m[0], "src"));
    if (!src || /\.(svg|ico)(\?|$)/i.test(src)) continue;
    if (/1x1|pixel|tracking|spacer/i.test(src + attr(m[0], "alt") + attr(m[0], "class"))) continue;
    images.push({ src, alt: textOf(attr(m[0], "alt")).slice(0, 200) });
  }
  const ctas: SiteBrief["ctas"] = [];
  for (const m of body.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (ctas.length >= 12) break;
    const text = textOf(m[2]);
    if (text.length < 2 || text.length > 48) continue;
    const href = resolve(attr(m[0], "href"));
    if (!href && !/^(tel:|mailto:|#)/.test(attr(m[0], "href"))) continue;
    ctas.push({ text, href: href || attr(m[0], "href") });
  }

  return { url: baseUrl, title, description, h1, headings, texts, points, images, ctas, colors: [...colorSet] };
}

/** Prompt the LLM to recreate the site's essence as an ORIGINAL full page (never a pixel copy). */
export function briefToPrompt(brief: SiteBrief): string {
  const lines = [
    `Recreate the essence of this website as an ORIGINAL, full, conversion-focused page. Do NOT copy text verbatim — rewrite everything in fresh words. Do NOT hotlink their images.`,
    `SOURCE: ${brief.url}`,
    brief.title ? `Their title: ${brief.title}` : "",
    brief.description ? `Their description: ${brief.description}` : "",
    brief.h1.length > 0 ? `Their main headlines: ${brief.h1.map((h) => `"${h}"`).join(" | ")}` : "",
    brief.headings.length > 0 ? `Their sections: ${brief.headings.slice(0, 10).map((h) => `"${h}"`).join(" | ")}` : "",
    brief.texts.length > 0 ? `Their key messages: ${brief.texts.slice(0, 8).map((t) => `"${t.slice(0, 160)}"`).join(" | ")}` : "",
    brief.ctas.length > 0 ? `Their calls to action: ${brief.ctas.slice(0, 8).map((c) => `"${c.text}"`).join(" | ")}` : "",
    brief.colors.length > 0 ? `Their palette hints (adapt, don't clone): ${brief.colors.join(" ")}` : "",
    `Build the same KIND of business website, better: full blueprint, real-feeling copy, working contact form.`,
  ];
  return lines.filter(Boolean).join("\n").slice(0, 6000);
}

/** Minimal standalone HTML fallback for import-url in html mode (fully escaped). */
export function synthesizeHtmlFromBrief(brief: SiteBrief): string {
  const t = escapeHtml(brief.title || brief.h1[0] || "Imported page");
  const h1 = escapeHtml(brief.h1[0] || brief.title || "Welcome");
  const desc = escapeHtml(brief.description);
  const sections = brief.headings.slice(0, 8).map((h) => `<section><h2>${escapeHtml(h)}</h2></section>`).join("\n");
  const cta = brief.ctas[0];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>body{font-family:system-ui,sans-serif;margin:0;color:#0f172a}header{background:#0f172a;color:#fff;padding:96px 24px;text-align:center}main{max-width:960px;margin:0 auto;padding:48px 24px}section{margin:32px 0}.btn{display:inline-block;margin-top:16px;padding:12px 28px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none}</style></head><body><header><h1>${h1}</h1>${desc ? `<p>${desc}</p>` : ""}${cta ? `<a class="btn" href="${escapeHtml(cta.href)}">${escapeHtml(cta.text)}</a>` : ""}</header><main>${sections}<p><small>Imported from ${escapeHtml(brief.url)} — edit freely.</small></p></main></body></html>`;
}
/** Deterministic fallback: map the brief onto the blueprint without any LLM. */
export function synthesizeFromBrief(brief: SiteBrief): PageDocument {
  const doc = createEmptyDocument();
  const t = doc.theme.colors;
  const name = brief.title.split(/[|–—-]/)[0].trim().slice(0, 60) || "Our business";
  const hero = brief.h1[0] || brief.title || name;
  const scroll = { preset: "slide-up", durationMs: 700, triggerOn: "scroll" } as const;
  const img = (i: number) => brief.images[i]?.src ?? `https://picsum.photos/seed/import${i}/1200/800`;
  const imgAlt = (i: number, fb: string) => brief.images[i]?.alt || fb;
  const cta = brief.ctas[0];

  doc.sections = [
    {
      id: newId("s"), name: "Hero", fullWidth: true,
      styles: { backgroundColor: t.text, padding: { top: 112, bottom: 112 } },
      rows: [{ id: newId("r"), styles: { textAlign: "center" }, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [
        { ...createBlock("heading", { text: hero.slice(0, 90), level: "h1" }), styles: { fontSize: 56, fontWeight: 800, letterSpacing: -0.02, color: "#ffffff", animation: { preset: "fade-in", durationMs: 800, triggerOn: "load" } } } as any,
        ...(brief.description ? [createBlock("text", { html: `<p>${brief.description.slice(0, 220)}</p>` }) as any] : []),
        createBlock("button", { text: cta?.text.slice(0, 40) || "Get started", href: cta?.href || "#contact", variant: "primary", size: "lg" }) as any,
      ] }] }],
    },
    ...(brief.headings.length > 0 ? [{
      id: newId("s"), name: "Highlights", fullWidth: false,
      styles: { backgroundColor: t.surface, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
      rows: [{ id: newId("r"), styles: {}, columns: brief.headings.slice(0, 3).map((h, i, arr) => ({ id: newId("c"), widthPercent: arr.length === 1 ? 100 : arr.length === 2 ? 50 : [33.3, 33.3, 33.4][i] ?? 33.3, styles: {}, blocks: [
        createBlock("heading", { text: h.slice(0, 90), level: "h3" }) as any,
        ...(brief.texts[i] ? [createBlock("text", { html: `<p>${brief.texts[i].slice(0, 240)}</p>` }) as any] : []),
      ] })) }],
    }] : []),
    {
      id: newId("s"), name: "Showcase", fullWidth: true,
      styles: { backgroundColor: t.background, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
      rows: [{ id: newId("r"), styles: {}, columns: [
        { id: newId("c"), widthPercent: 50, styles: {}, blocks: [createBlock("image", { src: img(0), alt: imgAlt(0, "Showcase") }) as any] },
        { id: newId("c"), widthPercent: 50, styles: {}, blocks: [
          createBlock("heading", { text: `Why choose ${name}`, level: "h2" }) as any,
          ...(brief.points.length > 0
            ? [createBlock("list", { items: brief.points.slice(0, 5), ordered: false }) as any]
            : [createBlock("text", { html: `<p>${(brief.texts[0] ?? "Quality service, fair prices, friendly support.").slice(0, 240)}</p>` }) as any]),
        ] },
      ] }],
    },
    {
      id: newId("s"), name: "Contact", fullWidth: false,
      styles: { backgroundColor: t.surface, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
      rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [
        createBlock("heading", { text: "Get in touch", level: "h2" }) as any,
        createBlock("form", { fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "message", label: "Message", type: "textarea", required: false },
        ], submitLabel: "Send message" }) as any,
      ] }] }],
    },
  ];
  return doc;
}
