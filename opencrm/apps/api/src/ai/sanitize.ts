import { newId, themeSchema } from "@opencrm/shared";

/**
 * Repair AI-generated documents BEFORE Zod validation so one bad block or
 * out-of-range number can't nuke an entire page into the local fallback.
 * Policy: clamp numbers, fill ids/defaults, DROP unknown block types (counted),
 * strip executable/script payloads (customJs, rawHtml in structured mode).
 */

const KNOWN_BLOCKS = new Set([
  "heading", "text", "button", "image", "video", "spacer",
  "divider", "icon", "list", "form", "html", "countdown",
  "testimonial", "pricing-table", "faq", "logo-cloud",
]);

const VARIANTS = {
  button: ["primary", "secondary", "outline", "ghost"],
  buttonSize: ["sm", "md", "lg"],
  heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
  field: ["text", "email", "phone", "textarea", "select"],
};

export interface SanitizeResult {
  candidate: unknown;
  droppedBlocks: number;
  notes: string[];
}

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};
const str = (v: unknown, fallback: string, max = 2000): string =>
  (typeof v === "string" && v ? v : fallback).slice(0, max);
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {});

function sanitizeStyles(s: unknown, depth = 0): Record<string, any> {
  const src = obj(s);
  const out: Record<string, any> = {};
  const pick = (k: string) => {
    if (src[k] !== undefined) out[k] = src[k];
  };
  ["display", "width", "maxWidth", "textAlign", "color", "backgroundColor", "backgroundImage",
    "backgroundOverlay", "borderColor", "borderStyle", "boxShadow", "gradientFrom", "gradientTo",
    "gradientDirection", "transform", "transition", "fontFamily"].forEach(pick);
  if (src.fontSize !== undefined) out.fontSize = num(src.fontSize, 16, 8, 144);
  if (src.fontWeight !== undefined) out.fontWeight = num(src.fontWeight, 400, 100, 900);
  if (src.lineHeight !== undefined) out.lineHeight = num(src.lineHeight, 1.5, 0.8, 3);
  if (src.letterSpacing !== undefined) out.letterSpacing = num(src.letterSpacing, 0, -5, 20);
  if (src.opacity !== undefined) out.opacity = num(src.opacity, 1, 0, 1);
  if (src.borderRadius !== undefined) out.borderRadius = num(src.borderRadius, 8, 0, 100);
  if (src.borderWidth !== undefined) out.borderWidth = num(src.borderWidth, 0, 0, 24);
  if (src.blur !== undefined) out.blur = num(src.blur, 0, 0, 40);
  for (const k of ["padding", "margin"]) {
    const sp = obj(src[k]);
    const clean: Record<string, number> = {};
    for (const side of ["top", "right", "bottom", "left"]) {
      if (sp[side] !== undefined) clean[side] = num(sp[side], 0, 0, 400);
    }
    if (Object.keys(clean).length > 0) out[k] = clean;
  }
  if (src.animation && depth === 0) {
    const a = obj(src.animation);
    const presets = ["none", "fade-in", "slide-up", "slide-down", "slide-left", "slide-right", "zoom-in", "zoom-out", "bounce", "rotate-in"];
    out.animation = {
      ...(typeof a.preset === "string" && presets.includes(a.preset) ? { preset: a.preset } : {}),
      ...(a.durationMs !== undefined ? { durationMs: num(a.durationMs, 700, 100, 5000) } : {}),
      ...(a.delayMs !== undefined ? { delayMs: num(a.delayMs, 0, 0, 5000) } : {}),
      ...(a.triggerOn === "load" || a.triggerOn === "scroll" || a.triggerOn === "hover" ? { triggerOn: a.triggerOn } : {}),
    };
  }
  if (depth === 0) {
    for (const k of ["tablet", "mobile"]) {
      if (src[k] !== undefined) out[k] = sanitizeStyles(src[k], 1);
    }
  }
  return out;
}

function sanitizeProps(type: string, props: Record<string, any>): Record<string, any> {
  const p = obj(props);
  switch (type) {
    case "heading": return { text: str(p.text, "Headline", 500), level: VARIANTS.heading.includes(p.level) ? p.level : "h2" };
    case "text": return { html: str(p.html, "<p></p>", 20000) };
    case "button": return {
      text: str(p.text, "Click me", 120),
      href: str(p.href, "#", 500),
      variant: VARIANTS.button.includes(p.variant) ? p.variant : "primary",
      size: VARIANTS.buttonSize.includes(p.size) ? p.size : "md",
    };
    case "image": {
      const src = typeof p.src === "string" && /^https?:\/\//.test(p.src) ? p.src.slice(0, 2000) : `https://picsum.photos/seed/${newId("img")}/1200/800`;
      return { src, alt: str(p.alt, "", 300) };
    }
    case "video": return { url: str(p.url, "", 2000), autoplay: bool(p.autoplay), loop: bool(p.loop), controls: p.controls === undefined ? true : bool(p.controls, true) };
    case "spacer": return { height: num(p.height, 48, 8, 400) };
    case "divider": return { thickness: num(p.thickness, 1, 1, 12), color: str(p.color, "#e5e7eb", 30) };
    case "icon": return { name: str(p.name, "star", 40), size: num(p.size, 24, 12, 96) };
    case "list": return {
      items: (Array.isArray(p.items) ? p.items : []).filter((i) => typeof i === "string").map((i) => i.slice(0, 300)).slice(0, 30),
      ordered: bool(p.ordered),
    };
    case "form": return {
      fields: (Array.isArray(p.fields) ? p.fields : []).slice(0, 10).map((f: any) => {
        const fo = obj(f);
        return {
          name: str(fo.name, "field", 60),
          label: str(fo.label, "Field", 120),
          type: VARIANTS.field.includes(fo.type) ? fo.type : "text",
          required: bool(fo.required),
        };
      }),
      submitLabel: str(p.submitLabel, "Submit", 80),
      collectContact: p.collectContact === undefined ? true : bool(p.collectContact, true),
    };
    case "html": return { code: str(p.code, "<div></div>", 20000) };
    case "countdown": {
      const t = typeof p.targetDate === "string" && !Number.isNaN(Date.parse(p.targetDate)) ? p.targetDate : new Date(Date.now() + 7 * 86400000).toISOString();
      return { targetDate: t, expiredText: str(p.expiredText, "Offer expired", 200) };
    }
    case "testimonial": return {
      quote: str(p.quote, "Excellent work.", 2000),
      author: str(p.author, "Happy customer", 120),
      role: str(p.role, "", 160),
      rating: num(p.rating, 5, 0, 5),
    };
    case "pricing-table": return {
      tiers: (Array.isArray(p.tiers) ? p.tiers : []).slice(0, 6).map((t: any) => {
        const to = obj(t);
        return {
          name: str(to.name, "Plan", 80),
          price: str(to.price, "$0", 40),
          period: str(to.period, "/mo", 40),
          features: (Array.isArray(to.features) ? to.features : []).filter((f) => typeof f === "string").map((f: string) => f.slice(0, 200)).slice(0, 20),
          highlighted: bool(to.highlighted),
          ctaText: str(to.ctaText, "Get started", 80),
          ctaHref: str(to.ctaHref, "#", 500),
        };
      }),
    };
    case "faq": return {
      items: (Array.isArray(p.items) ? p.items : []).slice(0, 12).map((it: any) => {
        const io = obj(it);
        return { question: str(io.question, "Question?", 500), answer: str(io.answer, "", 2000) };
      }),
    };
    case "logo-cloud": return {
      logos: (Array.isArray(p.logos) ? p.logos : []).slice(0, 12).map((l: any) => {
        const lo = obj(l);
        return { src: str(lo.src, "", 2000), alt: str(lo.alt, "", 200) };
      }),
    };
    default: return {};
  }
}

export function sanitizeAiDocument(raw: unknown): SanitizeResult {
  const notes: string[] = [];
  let droppedBlocks = 0;
  const src = obj(raw);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { candidate: raw, droppedBlocks, notes: ["not-an-object"] };
  }

  let theme: unknown;
  try {
    const parsed = themeSchema.safeParse((src as any).theme);
    theme = parsed.success ? parsed.data : themeSchema.parse({});
    if (!parsed.success) notes.push("theme-defaulted");
  } catch {
    theme = themeSchema.parse({});
    notes.push("theme-defaulted");
  }

  const sections = (Array.isArray((src as any).sections) ? (src as any).sections : []).map((s: any, si: number) => {
    const so = obj(s);
    const rows = (Array.isArray(so.rows) ? so.rows : []).map((r: any) => {
      const ro = obj(r);
      const cols = (Array.isArray(ro.columns) ? ro.columns : []).map((c: any) => {
        const co = obj(c);
        const blocks: any[] = [];
        for (const b of Array.isArray(co.blocks) ? co.blocks : []) {
          const bo = obj(b);
          if (typeof bo.type !== "string" || !KNOWN_BLOCKS.has(bo.type)) {
            droppedBlocks++;
            continue;
          }
          blocks.push({
            id: typeof bo.id === "string" && bo.id ? bo.id : newId("b"),
            type: bo.type,
            styles: sanitizeStyles(bo.styles),
            hidden: bool(bo.hidden),
            ...(typeof bo.customCss === "string" && bo.customCss ? { customCss: bo.customCss.slice(0, 5000) } : {}),
            props: sanitizeProps(bo.type, bo.props),
          });
        }
        return {
          id: typeof co.id === "string" && co.id ? co.id : newId("c"),
          widthPercent: num(co.widthPercent, 100, 5, 100),
          styles: sanitizeStyles(co.styles),
          blocks,
        };
      });
      // Renormalize widths to sum exactly 100.
      const total = cols.reduce((a, c) => a + c.widthPercent, 0);
      if (cols.length > 0 && total > 0 && Math.abs(total - 100) > 0.5) {
        let acc = 0;
        cols.forEach((c, i) => {
          c.widthPercent = i === cols.length - 1
            ? Math.round((100 - acc) * 10) / 10
            : Math.round(((c.widthPercent / total) * 100) * 10) / 10;
          acc += c.widthPercent;
        });
        notes.push(`row-widths-renormalized:${si}`);
      }
      return { id: typeof ro.id === "string" && ro.id ? ro.id : newId("r"), styles: sanitizeStyles(ro.styles), columns: cols };
    });
    return {
      id: typeof so.id === "string" && so.id ? so.id : newId("s"),
      name: str(so.name, "Section", 80),
      styles: sanitizeStyles(so.styles),
      fullWidth: bool(so.fullWidth),
      rows,
    };
  });
  if (droppedBlocks > 0) notes.push(`dropped-blocks:${droppedBlocks}`);

  const candidate: Record<string, any> = {
    version: 2,
    theme,
    sections,
    mode: "structured",
  };
  if (typeof (src as any).customCss === "string" && (src as any).customCss) {
    candidate.customCss = (src as any).customCss.slice(0, 20000);
  }
  // customJs / rawHtml intentionally stripped: never let AI ship executable payloads in structured docs.
  return { candidate, droppedBlocks, notes };
}
