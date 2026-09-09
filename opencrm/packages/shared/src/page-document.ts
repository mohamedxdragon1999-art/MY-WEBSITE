import { z } from "zod";

/**
 * PageDocument — the serializable block tree powering the website builder.
 * Structure: Page → Sections → Rows → Columns → Blocks.
 * Every node has a stable `id` for DnD, selection, and AI edits.
 */

// ─── Style schema (flat fields + responsive overrides, explicitly typed) ────

export const spacingSchema = z.object({
  top: z.number().optional(),
  right: z.number().optional(),
  bottom: z.number().optional(),
  left: z.number().optional(),
});
export type Spacing = z.infer<typeof spacingSchema>;

const animationSchema = z.object({
  preset: z.enum([
    "none", "fade-in", "slide-up", "slide-down", "slide-left",
    "slide-right", "zoom-in", "zoom-out", "bounce", "rotate-in",
  ]).optional(),
  durationMs: z.number().optional(),
  delayMs: z.number().optional(),
  triggerOn: z.enum(["load", "scroll", "hover"]).optional(),
});

export interface AnimationSpec {
  preset?: "none" | "fade-in" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom-in" | "zoom-out" | "bounce" | "rotate-in";
  durationMs?: number;
  delayMs?: number;
  triggerOn?: "load" | "scroll" | "hover";
}

export interface StyleOverride {
  display?: string;
  width?: string;
  maxWidth?: string;
  textAlign?: "left" | "center" | "right" | "justify";
  padding?: Spacing;
  margin?: Spacing;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  color?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundOverlay?: string;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: string;
  boxShadow?: string;
  opacity?: number;
  blur?: number;
  gradientFrom?: string;
  gradientTo?: string;
  gradientDirection?: string;
  transform?: string;
  transition?: string;
  animation?: AnimationSpec;
}

export interface BlockStyles extends StyleOverride {
  tablet?: StyleOverride;
  mobile?: StyleOverride;
}

const styleOverrideInner = {
  display: z.string().optional(),
  width: z.string().optional(),
  maxWidth: z.string().optional(),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
  padding: spacingSchema.optional(),
  margin: spacingSchema.optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.number().optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  backgroundImage: z.string().optional(),
  backgroundOverlay: z.string().optional(),
  borderRadius: z.number().optional(),
  borderWidth: z.number().optional(),
  borderColor: z.string().optional(),
  borderStyle: z.string().optional(),
  boxShadow: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  blur: z.number().optional(),
  gradientFrom: z.string().optional(),
  gradientTo: z.string().optional(),
  gradientDirection: z.string().optional(),
  transform: z.string().optional(),
  transition: z.string().optional(),
  animation: animationSchema.optional(),
} as const;

const styleOverrideSchema: z.ZodType<StyleOverride> = z.object(styleOverrideInner) as unknown as z.ZodType<StyleOverride>;

export const styleSchema: z.ZodType<BlockStyles> = z.object({
  ...styleOverrideInner,
  tablet: styleOverrideSchema.optional(),
  mobile: styleOverrideSchema.optional(),
}) as unknown as z.ZodType<BlockStyles>;

// ─── Block types & schema ────────────────────────────────────

export type BlockType =
  | "heading" | "text" | "button" | "image" | "video" | "spacer"
  | "divider" | "icon" | "list" | "form" | "html" | "countdown"
  | "testimonial" | "pricing-table" | "faq" | "logo-cloud";

export interface Block {
  id: string;
  type: BlockType;
  styles: BlockStyles;
  hidden: boolean;
  customCss?: string;
  htmlAttributes?: Record<string, string>;
  props: Record<string, any>;
}

const baseBlock = {
  id: z.string(),
  styles: styleSchema.default({}),
  hidden: z.boolean().default(false),
  customCss: z.string().optional(),
  htmlAttributes: z.record(z.string()).optional(),
};

export const blockSchema: z.ZodType<Block> = z.discriminatedUnion("type", [
  z.object({ ...baseBlock, type: z.literal("heading"), props: z.object({ text: z.string(), level: z.enum(["h1", "h2", "h3", "h4", "h5", "h6"]).default("h2") }) }),
  z.object({ ...baseBlock, type: z.literal("text"), props: z.object({ html: z.string() }) }),
  z.object({ ...baseBlock, type: z.literal("button"), props: z.object({
    text: z.string(), href: z.string().default("#"),
    variant: z.enum(["primary", "secondary", "outline", "ghost"]).default("primary"),
    size: z.enum(["sm", "md", "lg"]).default("md"), icon: z.string().optional(), openInNewTab: z.boolean().default(false),
  }) }),
  z.object({ ...baseBlock, type: z.literal("image"), props: z.object({ src: z.string(), alt: z.string().default(""), objectFit: z.enum(["cover", "contain", "fill"]).default("cover") }) }),
  z.object({ ...baseBlock, type: z.literal("video"), props: z.object({ url: z.string(), autoplay: z.boolean().default(false), loop: z.boolean().default(false), controls: z.boolean().default(true) }) }),
  z.object({ ...baseBlock, type: z.literal("spacer"), props: z.object({ height: z.number().default(48) }) }),
  z.object({ ...baseBlock, type: z.literal("divider"), props: z.object({ thickness: z.number().default(1), color: z.string().default("#e5e7eb") }) }),
  z.object({ ...baseBlock, type: z.literal("icon"), props: z.object({ name: z.string(), size: z.number().default(24), color: z.string().optional() }) }),
  z.object({ ...baseBlock, type: z.literal("list"), props: z.object({ items: z.array(z.string()), ordered: z.boolean().default(false) }) }),
  z.object({ ...baseBlock, type: z.literal("form"), props: z.object({
    fields: z.array(z.object({ name: z.string(), label: z.string(), type: z.enum(["text", "email", "phone", "textarea", "select"]), required: z.boolean().default(false), options: z.array(z.string()).optional() })),
    submitLabel: z.string().default("Submit"), workflowTriggerId: z.string().optional(), collectContact: z.boolean().default(true),
  }) }),
  z.object({ ...baseBlock, type: z.literal("html"), props: z.object({ code: z.string() }) }),
  z.object({ ...baseBlock, type: z.literal("countdown"), props: z.object({ targetDate: z.string(), expiredText: z.string().default("Offer expired") }) }),
  z.object({ ...baseBlock, type: z.literal("testimonial"), props: z.object({
    quote: z.string(), author: z.string(), role: z.string().default(""),
    avatarUrl: z.string().optional(), rating: z.number().min(0).max(5).default(5),
  }) }),
  z.object({ ...baseBlock, type: z.literal("pricing-table"), props: z.object({
    tiers: z.array(z.object({ name: z.string(), price: z.string(), period: z.string().default("/mo"), features: z.array(z.string()), highlighted: z.boolean().default(false), ctaText: z.string().default("Get started"), ctaHref: z.string().default("#") })),
  }) }),
  z.object({ ...baseBlock, type: z.literal("faq"), props: z.object({ items: z.array(z.object({ question: z.string(), answer: z.string() })) }) }),
  z.object({ ...baseBlock, type: z.literal("logo-cloud"), props: z.object({ logos: z.array(z.object({ src: z.string(), alt: z.string() })) }) }),
]) as unknown as z.ZodType<Block>;

// ─── Layout nodes ────────────────────────────────────────────

export interface Column {
  id: string;
  widthPercent: number;   // within its row
  styles: BlockStyles;
  blocks: Block[];
}

export const columnSchema: z.ZodType<Column> = z.object({
  id: z.string(),
  widthPercent: z.number().min(5).max(100),
  styles: styleSchema.default({}),
  blocks: z.array(blockSchema),
}) as unknown as z.ZodType<Column>;

export interface Row {
  id: string;
  styles: BlockStyles;
  columns: Column[];
}

export const rowSchema: z.ZodType<Row> = z.object({
  id: z.string(),
  styles: styleSchema.default({}),
  columns: z.array(columnSchema),
}) as unknown as z.ZodType<Row>;

export interface Section {
  id: string;
  name: string;
  styles: BlockStyles;
  fullWidth: boolean;
  rows: Row[];
}

export const sectionSchema: z.ZodType<Section> = z.object({
  id: z.string(),
  name: z.string().default("Section"),
  styles: styleSchema.default({}),
  fullWidth: z.boolean().default(false),
  rows: z.array(rowSchema),
}) as unknown as z.ZodType<Section>;

// ─── Theme (design tokens) ───────────────────────────────────

export interface PageTheme {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
  borderRadius: number;
  spacingScale: number;
  system?: string;
  tokens?: Record<string, string>;
}

export const themeSchema: z.ZodType<PageTheme> = z.object({
  colors: z.object({
    primary: z.string().default("#2563eb"),
    secondary: z.string().default("#7c3aed"),
    accent: z.string().default("#f59e0b"),
    background: z.string().default("#ffffff"),
    surface: z.string().default("#f8fafc"),
    text: z.string().default("#0f172a"),
    textMuted: z.string().default("#64748b"),
  }).default({ primary: "#2563eb", secondary: "#7c3aed", accent: "#f59e0b", background: "#ffffff", surface: "#f8fafc", text: "#0f172a", textMuted: "#64748b" }),
  fonts: z.object({
    heading: z.string().default("Inter"),
    body: z.string().default("Inter"),
  }).default({ heading: "Inter", body: "Inter" }),
  borderRadius: z.number().default(8),
  spacingScale: z.number().default(4),
  system: z.string().optional(),
  tokens: z.record(z.string(), z.string()).optional(),
}).default({
  colors: { primary: "#2563eb", secondary: "#7c3aed", accent: "#f59e0b", background: "#ffffff", surface: "#f8fafc", text: "#0f172a", textMuted: "#64748b" },
  fonts: { heading: "Inter", body: "Inter" },
  borderRadius: 8,
  spacingScale: 4,
  system: undefined,
  tokens: undefined,
}) as unknown as z.ZodType<PageTheme>;

/** Map a design-system token map onto the simplified theme fields used by consumers. */
export function applySystemToTheme(theme: PageTheme, system: { tokens: Record<string, string>; name: string }, id: string): PageTheme {
  const t = system.tokens;
  return {
    ...theme,
    system: id,
    tokens: t,
    colors: {
      primary: t["accent"] ?? theme.colors.primary,
      secondary: t["accent-active"] ?? t["accent"] ?? theme.colors.secondary,
      accent: t["accent"] ?? theme.colors.accent,
      background: t["bg"] ?? theme.colors.background,
      surface: t["surface"] ?? theme.colors.surface,
      text: t["fg"] ?? theme.colors.text,
      textMuted: t["muted"] ?? theme.colors.textMuted,
    },
    fonts: {
      heading: cleanFontFamily(t["font-display"] ?? theme.fonts.heading),
      body: cleanFontFamily(t["font-body"] ?? theme.fonts.body),
    },
    borderRadius: parsePx(t["radius-md"] ?? "") ?? theme.borderRadius,
    spacingScale: 4,
  };
}

function cleanFontFamily(s: string): string {
  return s.split(",")[0].replace(/["']/g, "").trim() || "Inter";
}
function parsePx(s: string): number | null {
  const m = s.match(/(\d+)px/);
  return m ? Number(m[1]) : null;
}

// ─── Root document ───────────────────────────────────────────

export interface PageDocument {
  version: 2;
  theme: PageTheme;
  sections: Section[];
  customCss?: string;
  customJs?: string;
  mode: "structured" | "html";
  rawHtml?: string;
}

export const pageDocumentSchema: z.ZodType<PageDocument> = z.object({
  version: z.literal(2),
  theme: themeSchema.catch(() => ({
    colors: { primary: "#2563eb", secondary: "#7c3aed", accent: "#f59e0b", background: "#ffffff", surface: "#f8fafc", text: "#0f172a", textMuted: "#64748b" },
    fonts: { heading: "Inter", body: "Inter" }, borderRadius: 8, spacingScale: 4, system: undefined, tokens: undefined,
  } as PageTheme)),
  sections: z.array(sectionSchema),
  customCss: z.string().optional(),
  customJs: z.string().optional(),
  mode: z.enum(["structured", "html"]).optional().default("structured"),
  rawHtml: z.string().optional(),
}) as unknown as z.ZodType<PageDocument>;

// ─── Helpers ─────────────────────────────────────────────────

let counter = 0;
export function newId(prefix = "n"): string {
  return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyDocument(): PageDocument {
  return { version: 2, theme: themeSchema.parse({}), sections: [], mode: "structured" };
}

export function createBlock(type: BlockType, overrides: Partial<Record<string, unknown>> = {}): Block {
  const defaults: Record<BlockType, Record<string, any>> = {
    heading: { text: "Headline", level: "h2" },
    text: { html: "<p>Start typing…</p>" },
    button: { text: "Click me", href: "#", variant: "primary", size: "md", openInNewTab: false },
    image: { src: "https://placehold.co/800x400", alt: "", objectFit: "cover" },
    video: { url: "", autoplay: false, loop: false, controls: true },
    spacer: { height: 48 },
    divider: { thickness: 1, color: "#e5e7eb" },
    icon: { name: "star", size: 24 },
    list: { items: ["Item one", "Item two"], ordered: false },
    form: { fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "email", label: "Email", type: "email", required: true },
    ], submitLabel: "Submit", collectContact: true },
    html: { code: "<div><!-- custom html --></div>" },
    countdown: { targetDate: new Date(Date.now() + 86400000 * 7).toISOString(), expiredText: "Offer expired" },
    testimonial: { quote: "This product changed everything.", author: "Jane Doe", role: "CEO", rating: 5 },
    "pricing-table": { tiers: [
      { name: "Basic", price: "$29", period: "/mo", features: ["Primary feature", "Basic support"], ctaText: "Get started", ctaHref: "#", highlighted: false },
      { name: "Pro", price: "$79", period: "/mo", features: ["Everything in Basic", "Priority support"], ctaText: "Get started", ctaHref: "#", highlighted: true },
    ] },
    faq: { items: [{ question: "How does it work?", answer: "It works beautifully." }] },
    "logo-cloud": { logos: [] },
  };
  return { id: newId("b"), type, styles: {}, hidden: false, props: { ...(defaults[type] ?? {}), ...overrides } } as Block;
}

/** Max serialized document size accepted by the API (500KB). Frontend: show 400 message, do not silently truncate. */
export const MAX_DOCUMENT_BYTES = 500 * 1024;

/** Strict-but-lossless parse: returns {ok, document} without silently stripping unknown valid data. */
export function safeParseDocument(input: unknown): { ok: true; document: PageDocument } | { ok: false; error: string } {
  const parsed = pageDocumentSchema.safeParse(input);
  if (parsed.success) return { ok: true, document: parsed.data };
  const first = parsed.error.issues[0];
  return { ok: false, error: first ? `${first.path.join(".") || "document"}: ${first.message}` : "Invalid PageDocument" };
}

/** Walk document and `visit` every node. */
export function walkDocument(
  doc: PageDocument,
  visit: {
    section?: (s: Section) => void;
    row?: (r: Row) => void;
    column?: (c: Column) => void;
    block?: (b: Block) => void;
  }
) {
  for (const section of doc.sections) {
    visit.section?.(section);
    for (const row of section.rows) {
      visit.row?.(row);
      for (const col of row.columns) {
        visit.column?.(col);
        for (const block of col.blocks) visit.block?.(block);
      }
    }
  }
}