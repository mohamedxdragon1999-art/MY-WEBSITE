import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { requireIntegrationKey } from "../common/env-check";
import { ProviderPoolService } from "./provider-pool";
import { sanitizeAiDocument } from "./sanitize";
import {
  briefToPrompt,
  extractSiteContent,
  fetchSiteHtml,
  synthesizeFromBrief,
  synthesizeHtmlFromBrief,
} from "./site-import";
import {
  createBlock,
  createEmptyDocument,
  newId,
  pageDocumentSchema,
  applySystemToTheme,
  DESIGN_SYSTEMS,
  CRAFT_PROMPT_FRAGMENT,
  type PageDocument,
} from "@opencrm/shared";

const CORE_RULES = `Design craft rules (MUST obey — these separate designed work from AI slop):

1. NEVER use default Tailwind indigo as accent (#6366f1,#4f46e5,#4338ca,#3730a3,#8b5cf6,#7c3aed,#a855f7). Use only the design system's accent.
2. NO generic purple→blue / blue→cyan / indigo→pink hero gradient. A flat surface + strong typography beats it.
3. NO emoji as feature icons. Use clean monoline SVG with currentColor, or none.
4. Headings must use the display font; body copy uses the body font. Never system-ui alone on a heading.
5. NO rounded card with a colored left-border ("AI dashboard tile").
6. NO invented metrics or filler copy. Real, specific, plausible copy only.
7. Accent color appears at most 2× per screen.
8. Display ≥32px needs negative letter-spacing (-0.01em to -0.03em). ALL-CAPS needs positive tracking (+0.06em to +0.1em). Body 15-18px, lh 1.5-1.6, max-width 65ch. Under 3 sizes above the fold.
9. Vary the section rhythm: at least 1 unconventional section (full-bleed quote, comparison, demo, gallery).
 10. ~80% proven patterns + ~20% distinctive: 1 bold visual move, voice in microcopy, 1 memorable micro-interaction.`;

const PAGE_BLUEPRINT = `FULL-PAGE BLUEPRINT (follow this order — a 3-section page is a FAILURE, deliver 6-9 sections):
1. HERO (fullWidth, dark or deep-brand background, padding 96-128): eyebrow small-caps line, ONE h1 52-68px with negative letter-spacing, 1-2 sentence subcopy 17-19px, TWO buttons (primary CTA + ghost/outline secondary), trust row (rating stars via testimonial-free text like "★★★★★ 4.9 from 300+ customers" — never emoji).
2. PROOF STRIP (surface bg, padding 32-48): logo-cloud OR 3-4 stat pairs (heading number + muted label). No invented awards.
3. VALUE / SERVICES (background bg, padding 80-96): h2 36-44px + subcopy, then 3-4 columns each with icon + h3 20-22px + 2-sentence text. Stagger animation delayMs 0/100/200.
4. SHOWCASE (fullWidth image or split 50/50 image+copy): 1-2 picsum images with real alt text, checklist via list block, secondary CTA button.
5. TESTIMONIALS (surface bg): 2-3 testimonial blocks with full names + roles + 5/4.5 ratings, specific praise (not "great service!").
6. OFFER (pricing-table for stores/SaaS with 3 tiers, middle highlighted; for local trades use an "offer card": heading + price anchor + bullet list + countdown to a real near date + CTA).
7. FAQ (4-6 genuine questions a buyer would ask, 2-3 sentence answers).
8. FINAL CTA + CONTACT (dark bg): h2 + phone button (href "tel:+1..." for trades) + form (name, phone, email, textarea message; submitLabel like "Get my free quote"; collectContact:true).
9. FOOTER (surface or dark, padding 48-64): 3-4 columns of list blocks (Services / Company / Contact info with real-ish address + hours), divider, small muted line "© year Business. All rights reserved."
RHYTHM: alternate section backgrounds (dark hero → surface strip → bg → surface → bg …) so the page breathes. Section padding 64-128 vertical, never 0. Exactly ONE h1 per page.`;

const COPY_PLAYBOOK = `COPY PLAYBOOK (infer the business type from the request and commit to it):
- ONLINE STORE: brand the store (name + niche), hero = flagship offer + "Shop bestsellers", pricing-table = 3 product bundles with prices, FAQ covers shipping/returns/sizing, footer has policies. Prices realistic.
- LOCAL TRADES (plumbing, construction, electrical, HVAC…): business name + city, hero CTA = "Call (555) 01X-XXXX" tel: link + "Free estimates" button, services list with areas served, license/insured line, emergency callout, reviews with local names, form includes phone + service select + message.
- RESTAURANT/CAFE: cuisine + neighborhood, hero with hours + "Reserve a table", menu-ish pricing tiers or specials, testimonials about dishes, FAQ (parking, dietary, hours).
- SAAS/AGENCY/PORTFOLIO: outcome headline with numbers, feature grid, 3-tier pricing, FAQ objections, contact form.
- NEVER: lorem ipsum, "Your Headline Goes Here", "Lorem", "John Doe" (use varied plausible names), more than one h1, empty src/alt, buttons pointing nowhere meaningful (use "#" only for demo links, tel:/mailto: where real).`;

function buildSystemPrompt(mode: "structured" | "html", systemId?: string): string {
  const sys = systemId ? DESIGN_SYSTEMS[systemId] : undefined;
  const tokenBlock = sys
    ? `\n\nACTIVE DESIGN SYSTEM: "${sys.name}" — ${sys.description}\nApply these CSS custom properties (use var(--name), never hardcode the hex):\n${Object.entries(sys.tokens).map(([k, v]) => `  --${k}: ${v};`).join("\n")}\n`
    : "\n\nNo design system selected — pick an intentional palette that isn't AI-default indigo.";

  if (mode === "html") {
    return `You are a world-class web designer and frontend engineer. Return COMPLETE, production-quality single-page HTML as ONE self-contained file.
${tokenBlock}
${CORE_RULES}

${PAGE_BLUEPRINT}

OUTPUT FORMAT (respond with ONLY the HTML — no markdown fences, no explanation):
- A full <!doctype html> document with a <style> block in <head> (all CSS inline; never use external fonts that might 404).
- Semantic HTML: <header> <main> <section> <footer>. Fully responsive.
- Real images via https://picsum.photos/seed/<slug>/1200/800 (never hotlink other sites, never empty src).
- Add subtle scroll-reveal via IntersectionObserver where appropriate.
Return the HTML only.`;
  }

  return `You generate JSON for a website builder. Respond ONLY with valid JSON matching this schema — no commentary, no markdown fences:
${tokenBlock}
${CORE_RULES}

${PAGE_BLUEPRINT}
${COPY_PLAYBOOK}

JSON SCHEMA:
{
  "version": 2,
  "customCss": "optional raw css string",
  "theme": { "system": "${systemId || ""}", "colors": {"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","surface":"#hex","text":"#hex","textMuted":"#hex"}, "fonts": {"heading":"Name","body":"Name"}, "borderRadius": 8, "spacingScale": 4 },
  "sections": [{
    "id": "s_1", "name": "Hero", "fullWidth": false,
    "styles": { "backgroundColor":"#hex", "padding": {"top":96,"bottom":96}, "textAlign":"center" },
    "rows": [{ "id":"r_1", "styles":{}, "columns":[{ "id":"c_1", "widthPercent":100, "styles":{}, "blocks":[] }] }]
  }]
}

BLOCK TYPES (each: { id, type, hidden:false, styles:{}, props }):
heading -> { text, level }            // h1 once per page (hero), h2 for section titles, h3 for cards
text    -> { html }                   // short paragraphs, <p>/<strong> only, 1-3 sentences
button  -> { text, href, variant:"primary|secondary|outline|ghost", size:"sm|md|lg" }
image   -> { src, alt }               // src MUST be https://picsum.photos/seed/<unique-slug>/1200/800, alt meaningful
video   -> { url, autoplay, loop, controls }
spacer  -> { height }
divider -> { thickness, color }
icon    -> { name, size }             // name: star|check|phone|mail|pin|clock|shield|truck|wrench|sparkles|arrow
list    -> { items:[], ordered:bool } // checklists, service areas, footer link columns
form    -> { fields:[{name,label,type:"text|email|phone|textarea|select",required}], submitLabel, collectContact:true }
html    -> { code }                   // avoid unless truly needed
countdown -> { targetDate, expiredText }
testimonial -> { quote, author, role, rating }
pricing-table -> { tiers:[{name,price,period,features:[],highlighted,ctaText,ctaHref}] }
faq     -> { items:[{question,answer}] }   // 4-6 real questions
logo-cloud -> { logos:[{src,alt}] }

STYLES may include: backgroundColor, backgroundImage, backgroundOverlay, gradientFrom, gradientTo, color, fontSize(px), fontWeight, lineHeight, letterSpacing, textAlign, padding{top,right,bottom,left}, margin, borderRadius, borderWidth, borderColor, boxShadow, opacity, width, maxWidth.
ANIMATION (below-fold sections SHOULD animate): styles.animation = { preset:"fade-in"|"slide-up", durationMs:600-800, triggerOn:"scroll" }; hero heading uses { preset:"fade-in", triggerOn:"load" }; stagger cards with delayMs 0/100/200.
IDS: unique per node (s_1,s_2… r_1… c_1… b_1…). Column widthPercents in a row MUST sum to 100 (use 100 | 50/50 | 33.3/33.3/33.4 | 25×4).
Create a conversion-focused, modern, beautiful page following the blueprint.`;
}

export type AIProvider = "nvidia" | "openai" | "anthropic" | "deepseek" | "custom";

export const MAX_PROMPT_CHARS = 8000;
export const MAX_INSTRUCTION_CHARS = 4000;
export const MAX_ELEMENT_BYTES = 200 * 1024;
export const DEFAULT_AI_DAILY_CAP = 200;
/** Full pages are big JSON — 4k cut them off mid-section. Ceiling only; billing follows actual tokens. */
export const AI_MAX_OUTPUT_TOKENS = 8000;

export function aiDailyCap(): number {
  const raw = Number(process.env.AI_DAILY_CAP ?? DEFAULT_AI_DAILY_CAP);
  if (!Number.isFinite(raw) || raw < 1) return DEFAULT_AI_DAILY_CAP;
  return Math.min(10000, Math.floor(raw));
}

function startOfTodayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function nextMidnightUtc(): Date {
  const d = startOfTodayUtc();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

interface Credentials { baseURL?: string; apiKey?: string; model?: string; }

const DEFAULT_BASE: Record<string, string> = {
  nvidia: "https://integrate.api.nvidia.com/v1",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
};

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private pool: ProviderPoolService,
  ) {}

  // ── config persistence ─────────────────────────────────────
  async saveKeys(subAccountId: string, provider: string, keys: Array<{ apiKey: string; baseUrl?: string; label?: string }>, defaults?: { model?: string; baseUrl?: string }) {
    if (!Array.isArray(keys) || keys.length === 0) throw new BadRequestException("keys must be a non-empty array");
    if (keys.length > 10) throw new BadRequestException("max 10 keys per provider");
    for (const k of keys) {
      if (!k?.apiKey || String(k.apiKey).length < 8 || String(k.apiKey).length > 500)
        throw new BadRequestException("each key needs apiKey 8-500 chars");
      if (k.baseUrl) validateBase(k.baseUrl); // throws 400 on SSRF/private
    }
    const clean = keys.map(k => ({ apiKey: k.apiKey, baseUrl: k.baseUrl ?? "", label: String(k.label ?? "").slice(0, 60) })).slice(0, 10);
    // Store with encrypted credentials JSON
    const payload = JSON.stringify({ keys: clean, defaults: defaults ?? {} });
    const data = { credentials: this.encrypt({ json: payload }), provider, enabled: true };
    await this.prisma.integration.upsert({
      where: { subAccountId_provider: { subAccountId, provider } },
      create: { subAccountId, ...data },
      update: { ...data, credentials: this.encrypt({ json: payload }) },
    });
    // Hydrate in-memory rotation pool so generate/edit actually rotate.
    try {
      this.pool.setKeys(subAccountId, provider, clean.map(c => ({ apiKey: c.apiKey, baseUrl: c.baseUrl || undefined, label: c.label || undefined })));
    } catch { /* pool hydration is best-effort */ }
    return { ok: true, provider, keys: clean.length };
  }

  private async resolveCreds(subAccountId: string, opts: any): Promise<{ creds: Credentials; provider: string }> {
    const provider = String(opts.provider ?? "nvidia").slice(0, 32);
    let creds: Credentials = { baseURL: opts.baseUrl, apiKey: opts.apiKey, model: opts.model };
    if (!creds.apiKey && !creds.baseURL) {
      const stored = await this.prisma.integration.findUnique({ where: { subAccountId_provider: { subAccountId, provider } } });
      if (stored?.enabled) {
        try {
          const c = this.decrypt(stored.credentials) as any;
          // New multi-key shape: {json: "{\"keys\":[...],\"defaults\":{}}"} or legacy {apiKey,baseURL,model}
          let parsed: any = c;
          if (typeof c.json === "string") {
            try { parsed = JSON.parse(c.json); } catch { parsed = c; }
          }
          if (Array.isArray(parsed.keys) && parsed.keys.length > 0) {
            const first = parsed.keys[0];
            creds = {
              baseURL: creds.baseURL ?? first.baseUrl ?? parsed.defaults?.baseUrl ?? c.baseURL,
              apiKey: creds.apiKey ?? first.apiKey ?? c.apiKey,
              model: creds.model ?? parsed.defaults?.model ?? c.model,
            };
            // Hydrate pool for rotation on subsequent calls.
            try {
              this.pool.setKeys(subAccountId, provider, parsed.keys.map((k: any) => ({ apiKey: k.apiKey, baseUrl: k.baseUrl || undefined, label: k.label || undefined })));
            } catch { /* best-effort */ }
          } else {
            creds = { baseURL: creds.baseURL ?? c.baseURL ?? c.baseUrl, apiKey: creds.apiKey ?? c.apiKey, model: creds.model ?? c.model };
          }
        } catch {
          throw new BadRequestException("Stored provider credentials are corrupt. Re-save your key in Settings.");
        }
      }
    }
    creds.apiKey = creds.apiKey ?? process.env.NVIDIA_API_KEY ?? process.env.OPENAI_API_KEY;
    creds.baseURL = creds.baseURL ?? DEFAULT_BASE[provider] ?? process.env.AI_BASE_URL;
    if (!creds.apiKey || !creds.baseURL)
      throw new BadRequestException("No AI provider configured. Add your NVIDIA/OpenAI key in Settings.");
    const hint = keyHintFor(creds.apiKey, provider);
    if (hint) throw new BadRequestException(hint);
    return { creds, provider };
  }

  /** Persist a key/pool to the Integration table (encrypted). Used by Settings page. */
  async saveConfig(subAccountId: string, input: { provider: string; baseUrl?: string; apiKey?: string; model?: string }) {
    if (!input.provider || String(input.provider).length > 32) throw new BadRequestException("Invalid provider");
    if (input.baseUrl) validateBase(input.baseUrl);
    if (input.apiKey && (String(input.apiKey).length < 8 || String(input.apiKey).length > 500))
      throw new BadRequestException("apiKey must be 8-500 chars");
    if (input.model && String(input.model).length > 200) throw new BadRequestException("model too long");
    const creds: Credentials = { baseURL: input.baseUrl, apiKey: input.apiKey, model: input.model };
    const data = { provider: input.provider, credentials: this.encrypt(creds), enabled: true };
    await this.prisma.integration.upsert({
      where: { subAccountId_provider: { subAccountId, provider: input.provider } },
      create: { subAccountId, ...data },
      update: data,
    });
    return { ok: true, provider: input.provider };
  }

  /** Lists all integrations with masked keys (never dumps decrypted material). */
  async listConfigs(subAccountId: string) {
    const rows = await this.prisma.integration.findMany({ where: { subAccountId } });
    return rows.map((r) => {
      let c: any = {};
      try {
        c = this.decrypt(r.credentials) as any;
        if (typeof c.json === "string") {
          try {
            const inner = JSON.parse(c.json);
            c = { ...c, ...inner, keys: inner.keys ?? c.keys };
          } catch { /* keep outer */ }
        }
      } catch {
        return { provider: r.provider, enabled: r.enabled, corrupt: true, hasKey: false, keyHint: "", keysCount: 0, baseURL: "", model: "" };
      }
      const keys = Array.isArray((c as any).keys) ? (c as any).keys : [{ ...c }];
      const first = keys[0] ?? {};
      return {
        provider: r.provider,
        enabled: r.enabled,
        baseURL: (first.baseUrl ?? first.baseURL ?? c.baseURL ?? c.baseUrl ?? "") as string,
        model: (first.model ?? c.model ?? "") as string,
        hasKey: !!((first as any).apiKey ?? (c as any).apiKey),
        keyHint: ((first as any).apiKey ?? (c as any).apiKey) ? maskKey((first as any).apiKey ?? (c as any).apiKey) : "",
        keysCount: keys.length,
      };
    });
  }

  /** Per-provider key health listing (shows masked keys + last error + cooldowns). */
  async listKeys(subAccountId: string, provider: string) {
    const poolRows: any[] = (() => {
      try { return (this.pool.getPool(subAccountId, provider) ?? []) as any[]; } catch { return []; }
    })();
    if (poolRows.length > 0) {
      return poolRows.map((e: any) => ({
        label: e.label ?? "Primary",
        key: maskKey(e.apiKey),
        baseUrl: e.baseUrl ?? e.baseURL,
        fails: e.fails,
        lastError: typeof e.lastError === "string" ? String(redact(e.lastError)).slice(0, 300) : e.lastError,
        cooldownUntil: e.cooldownUntil,
        health: e.fails === 0 ? "healthy" : e.fails < 3 ? "warning" : "error",
      }));
    }
    // Fallback: masked DB list so UI is never empty after saveKeys before first generate.
    const stored = await this.prisma.integration.findUnique({ where: { subAccountId_provider: { subAccountId, provider } } }).catch(() => null);
    if (!stored) return [];
    try {
      const c = this.decrypt(stored.credentials) as any;
      let keys: any[] = [];
      if (typeof c.json === "string") {
        try { keys = JSON.parse(c.json).keys ?? []; } catch { keys = []; }
      } else if (Array.isArray(c.keys)) keys = c.keys;
      else if (c.apiKey) keys = [{ apiKey: c.apiKey, baseUrl: c.baseURL ?? c.baseUrl, label: "Primary" }];
      return keys.map((k: any, i: number) => ({
        label: k.label ?? `Key ${String(i + 1).padStart(2, "0")}`,
        key: maskKey(k.apiKey ?? ""),
        baseUrl: k.baseUrl ?? k.baseURL ?? "",
        fails: 0,
        lastError: undefined,
        cooldownUntil: 0,
        health: "healthy" as const,
      }));
    } catch {
      return [];
    }
  }

  // ── usage metering + daily caps ────────────────────────────
  async getUsage(subAccountId: string) {
    const cap = aiDailyCap();
    const used = await this.prisma.aiUsage.count({
      where: { subAccountId, createdAt: { gte: startOfTodayUtc() } },
    });
    return { used, cap, remaining: Math.max(0, cap - used), resetsAt: nextMidnightUtc().toISOString() };
  }

  private async checkCap(subAccountId: string): Promise<void> {
    const cap = aiDailyCap();
    const used = await this.prisma.aiUsage.count({
      where: { subAccountId, createdAt: { gte: startOfTodayUtc() } },
    });
    if (used >= cap)
      throw new HttpException(
        `AI daily cap reached (${used}/${cap}). Resets at ${nextMidnightUtc().toISOString()}. Raise AI_DAILY_CAP server-side if needed.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private recordUsage(subAccountId: string, kind: string, provider: string, model: string): void {
    // Fire-and-forget: metering must never break generation.
    this.prisma.aiUsage
      .create({ data: { subAccountId, kind, provider: String(provider ?? "").slice(0, 32), model: String(model ?? "").slice(0, 200) } })
      .catch(() => undefined);
  }

  // ── site & pages — used by funnels module ────────────────
  listModels(opts: { provider?: string; baseUrl?: string; apiKey?: string; model?: string }) {
    const base = withVersionedPath(validateBase(opts.baseUrl || DEFAULT_BASE[opts.provider || "nvidia"] || "https://integrate.api.nvidia.com"), "");
    const apiKey = opts.apiKey ?? process.env.NVIDIA_API_KEY ?? process.env.OPENAI_API_KEY;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return fetch(`${base}/models`, { headers }).then(async r => {
      if (!r.ok) throw new Error(mappedError(r.status, await r.text().catch(() => "")));
      return r.json();
    });
  }

  async generate(subAccountId: string, prompt: string, opts: {
    provider?: string; baseUrl?: string; apiKey?: string; model?: string;
    mode?: "structured" | "html"; system?: string;
  }): Promise<{ document?: PageDocument; html?: string; system?: string; keyUsed?: string }> {
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) throw new BadRequestException("prompt is required");
    if (prompt.length > MAX_PROMPT_CHARS) throw new BadRequestException(`prompt too long (max ${MAX_PROMPT_CHARS} chars)`);
    if (opts.system && !DESIGN_SYSTEMS[opts.system]) throw new BadRequestException("Unknown design system");
    if (opts.mode && opts.mode !== "structured" && opts.mode !== "html") throw new BadRequestException("Invalid mode");
    const mode = opts.mode ?? "structured";
    const { creds, provider } = await this.resolveCreds(subAccountId, opts);
    await this.checkCap(subAccountId);
    this.recordUsage(subAccountId, "generate", provider, creds.model ?? opts.model ?? "");
    const systemPrompt = buildSystemPrompt(mode, opts.system);

    // Rotate across pooled keys when available; otherwise single call.
    const poolKeys = (() => { try { return this.pool.getPool(subAccountId, provider) ?? []; } catch { return []; } })();
    const callOnce = (override?: { apiKey?: string; baseUrl?: string; model?: string }) => {
      const c: Credentials = {
        apiKey: override?.apiKey ?? creds.apiKey,
        baseURL: override?.baseUrl ?? creds.baseURL,
        model: override?.model ?? creds.model,
      };
      return provider === "anthropic"
        ? this.callAnthropic(c.apiKey!, c.model ?? "claude-3-5-sonnet-20241022", systemPrompt, prompt)
        : this.callOpenAICompatible(c, systemPrompt, prompt);
    };
    let raw: string;
    let keyLabel: string | undefined;
    if (poolKeys.length > 1) {
      const { result, keyUsed } = await this.pool.chat(subAccountId, provider, (entry) =>
        callOnce({ apiKey: (entry as any).apiKey, baseUrl: (entry as any).baseUrl, model: creds.model }),
      );
      raw = result;
      keyLabel = (keyUsed as any)?.label;
    } else {
      raw = await callOnce();
    }

    const cleaned = raw.replace(/```(json|html)?\n?|```/g, "").trim();

    if (mode === "html") {
      const html = extractHtml(cleaned);
      if (!html) throw new Error("UPSTREAM_EMPTY: AI returned no HTML.");
      return { html, keyUsed: keyLabel };
    }

    let parsed: any;
    try {
      const json = extractJson(cleaned);
      parsed = JSON.parse(json) as any;
    } catch {
      throw new Error("UPSTREAM_INVALID_JSON: AI did not return valid JSON.");
    }
    let document = this.parseAiDocument(parsed, opts.system);
    // Thin-page retry: a 1-3 section page is a failure of the blueprint — one
    // expansion pass reusing the same key, keeping the fuller of the two.
    if (document.sections.length < 4) {
      try {
        const prev = JSON.stringify(parsed).slice(0, 12000);
        const expandUser = `Your page has only ${document.sections.length} section(s) — that is INCOMPLETE. EXPAND it to 6-9 sections following the FULL-PAGE BLUEPRINT (proof strip, services, showcase, testimonials, offer, FAQ, final CTA + contact form, footer). Keep all existing sections, add the missing ones, keep copy specific and non-filler. Return the FULL expanded page as valid JSON only.\n\nCURRENT PAGE JSON:\n${prev}`;
        const raw2 = provider === "anthropic"
          ? await this.callAnthropic(creds.apiKey!, creds.model ?? "claude-3-5-sonnet-20241022", systemPrompt, expandUser)
          : await this.callOpenAICompatible(creds, systemPrompt, expandUser);
        const cleaned2 = raw2.replace(/```(json|html)?\n?|```/g, "").trim();
        const parsed2 = JSON.parse(extractJson(cleaned2)) as any;
        const expanded = this.parseAiDocument(parsed2, opts.system);
        if (expanded.sections.length > document.sections.length) document = expanded;
      } catch {
        // Expansion is best-effort: the original (sanitized) page still stands.
      }
    }
    return { document, system: opts.system, keyUsed: keyLabel };
  }

  /** Sanitize-then-validate AI output. Repairs trivia, drops rogue blocks, never silently strips sections. */
  private parseAiDocument(parsed: any, systemId?: string): PageDocument {
    const { candidate } = sanitizeAiDocument(parsed);
    const checked = pageDocumentSchema.safeParse(candidate);
    if (!checked.success) {
      const first = checked.error.issues[0];
      throw new Error(`UPSTREAM_INVALID_DOC: ${first?.path?.join(".") || "document"} ${first?.message || "invalid"}`);
    }
    const document = checked.data as PageDocument;
    if (systemId && DESIGN_SYSTEMS[systemId] && !document.theme.system) {
      document.theme = applySystemToTheme(document.theme, DESIGN_SYSTEMS[systemId], systemId);
    }
    return document;
  }

  /**
   * Import a public website URL: fetch (SSRF-guarded) → extract brief →
   * LLM recreation as an ORIGINAL page, or deterministic synthesis when AI is down.
   * Client errors (bad URL, empty page, missing keys, caps) always throw as 4xx/429/502.
   */
  async importUrl(subAccountId: string, url: string, opts: {
    provider?: string; baseUrl?: string; apiKey?: string; model?: string;
    mode?: "structured" | "html"; system?: string;
  }): Promise<{ document?: PageDocument; html?: string; system?: string; source: { url: string; title: string }; fallback?: boolean; reason?: string; keyUsed?: string }> {
    if (!url || typeof url !== "string" || url.length > 2000) throw new BadRequestException("url is required (max 2000 chars)");
    if (opts.mode && opts.mode !== "structured" && opts.mode !== "html") throw new BadRequestException("Invalid mode");
    if (opts.system && !DESIGN_SYSTEMS[opts.system]) throw new BadRequestException("Unknown design system");
    const mode = opts.mode ?? "structured";
    const { html, finalUrl } = await fetchSiteHtml(url);
    const brief = extractSiteContent(html, finalUrl);
    if (!brief.title && brief.h1.length === 0 && brief.headings.length === 0 && brief.texts.length === 0) {
      throw new HttpException("That page had no readable content to import.", HttpStatus.BAD_GATEWAY);
    }
    const source = { url: finalUrl, title: brief.title || brief.h1[0] || finalUrl };
    try {
      const gen = await this.generate(subAccountId, briefToPrompt(brief), { ...opts, mode });
      return { ...gen, source };
    } catch (e: any) {
      // Config/validation/cap problems are the caller's to fix — never mask them as a fallback.
      if (e instanceof HttpException) throw e;
      if (mode === "html") {
        return { html: synthesizeHtmlFromBrief(brief), source, fallback: true, reason: String(e?.message ?? "AI unavailable").slice(0, 300) };
      }
      const document = synthesizeFromBrief(brief);
      if (opts.system && DESIGN_SYSTEMS[opts.system]) {
        document.theme = applySystemToTheme(document.theme, DESIGN_SYSTEMS[opts.system], opts.system);
      }
      return { document, system: opts.system, source, fallback: true, reason: String(e?.message ?? "AI unavailable").slice(0, 300) };
    }
  }

  async editElement(
    subAccountId: string,
    args: { instruction: string; element: unknown; system?: string; mode?: "structured" | "html" },
    opts: { provider?: string; baseUrl?: string; apiKey?: string; model?: string }
  ) {
    if (!args?.instruction || typeof args.instruction !== "string" || !args.instruction.trim())
      throw new BadRequestException("instruction is required");
    if (args.instruction.length > MAX_INSTRUCTION_CHARS)
      throw new BadRequestException(`instruction too long (max ${MAX_INSTRUCTION_CHARS} chars)`);
    if (args.element === undefined || args.element === null) throw new BadRequestException("element is required");
    const elBytes = Buffer.byteLength(JSON.stringify(args.element), "utf8");
    if (elBytes > MAX_ELEMENT_BYTES) throw new BadRequestException(`element too large (max ${MAX_ELEMENT_BYTES} bytes)`);
    if (args.system && !DESIGN_SYSTEMS[args.system]) throw new BadRequestException("Unknown design system");
    const { creds, provider } = await this.resolveCreds(subAccountId, opts);
    await this.checkCap(subAccountId);
    this.recordUsage(subAccountId, "edit", provider, creds.model ?? opts.model ?? "");
    const sys = args.system && DESIGN_SYSTEMS[args.system];
    const tokenLine = sys ? `Design system "${sys.name}" tokens: ${Object.keys(sys.tokens).map(k => `--${k}:${sys.tokens[k]}`).join(" ")}` : "";
    const craftRulesSnippet = CORE_RULES.split("\n").slice(0, 12).join("\n");
    const systemPrompt = `You edit a single element of a website builder JSON. ${tokenLine}\n${craftRulesSnippet}\n\nThe element is JSON. Apply the user's instruction and return ONLY the modified element as valid JSON — same shape, no commentary, no fences. Keep ids stable.`;
    const user = `INSTRUCTION: ${args.instruction}\n\nELEMENT JSON:\n${JSON.stringify(args.element, null, 2)}`;
    const raw = provider === "anthropic"
      ? await this.callAnthropic(creds.apiKey!, creds.model ?? "claude-3-5-sonnet-20241022", systemPrompt, user)
      : await this.callOpenAICompatible(creds, systemPrompt, user);

    const cleaned = raw.replace(/```(json)?\n?|```/g, "").trim();
    try {
      return JSON.parse(extractJson(cleaned));
    } catch {
      throw new Error("UPSTREAM_INVALID_JSON: AI did not return valid JSON.");
    }
  }

  // ── model listing + connection test ────────────────────────
  async testConnection(subAccountId: string, opts: { provider?: string; baseUrl?: string; apiKey?: string; model?: string }) {
    if (opts.baseUrl) validateBase(opts.baseUrl);
    const { creds } = await this.resolveCreds(subAccountId, opts);
    await this.checkCap(subAccountId);
    this.recordUsage(subAccountId, "test", opts.provider ?? "nvidia", creds.model ?? opts.model ?? "");
    const model = String(creds.model ?? opts.model ?? "meta/llama-3.3-70b-instruct").slice(0, 200);
    const res = await this.callOpenAICompatible(creds, "Reply with only: ok", "Reply with exactly: ok");
    return { ok: true, model, reply: res.slice(0, 60) };
  }

  private async callOpenAICompatible(creds: Credentials, systemPrompt: string, user: string): Promise<string> {
    const base = withVersionedPath(validateBase(creds.baseURL!), "");
    const model = creds.model ?? "meta/llama-3.3-70b-instruct";
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${creds.apiKey}` };
    const tokenParam = usesMaxCompletionTokens(model) ? { max_completion_tokens: AI_MAX_OUTPUT_TOKENS } : { max_tokens: AI_MAX_OUTPUT_TOKENS };
    const wantsJson = systemPrompt.includes("valid JSON");
    const body: Record<string, unknown> = { model, stream: false, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: user }], ...tokenParam };
    if (wantsJson && (model.includes("openai") || model.includes("gpt") || model.includes("deepseek"))) body.response_format = { type: "json_object" };
    const res = await this.fetchWithRetry(`${base}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(mappedError(res.status, data));
    const text = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "";
    if (!text) throw new Error("Empty response from model.");
    return text;
  }

  private async callAnthropic(apiKey: string, model: string, system: string, user: string): Promise<string> {
    const res = await this.fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: AI_MAX_OUTPUT_TOKENS, system, messages: [{ role: "user", content: user }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(mappedError(res.status, data));
    return data.content?.[0]?.text ?? "";
  }

  private async fetchWithRetry(url: string, init: RequestInit, retries = 4): Promise<Response> {
    let attempt = 0;
    while (true) {
      try {
        const res = await fetch(url, init);
        if ([429, 500, 502, 503, 504].includes(res.status) && attempt < retries) {
          const ra = Number(res.headers.get("retry-after"));
          const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(8000, 500 * 2 ** attempt);
          await new Promise(r => setTimeout(r, waitMs));
          attempt++;
          continue;
        }
        return res;
      } catch (e: any) {
        if (attempt < retries) {
          const waitMs = Math.min(8000, 500 * 2 ** attempt);
          await new Promise(r => setTimeout(r, waitMs));
          attempt++;
          continue;
        }
        throw e;
      }
    }
  }

  // ── local fallback ─────────────────────────────────────────
  fallbackDocument(prompt: string, systemId?: string): PageDocument {
    const doc = createEmptyDocument();
    if (systemId && DESIGN_SYSTEMS[systemId]) doc.theme = applySystemToTheme(doc.theme, DESIGN_SYSTEMS[systemId], systemId);
    const t = doc.theme.colors;
    const headline = prompt.replace(/\s+/g, " ").trim().slice(0, 60) || "Grow your business online";
    const scroll = { preset: "slide-up", durationMs: 700, triggerOn: "scroll" } as const;
    doc.sections = [
      {
        id: newId("s"), name: "Hero", fullWidth: true,
        styles: { backgroundColor: t.text, padding: { top: 112, bottom: 112 } },
        rows: [{ id: newId("r"), styles: { textAlign: "center" }, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [
          { ...createBlock("heading", { text: headline, level: "h1" }), styles: { fontSize: 60, fontWeight: 800, letterSpacing: -0.02, color: "#ffffff", animation: { preset: "fade-in", durationMs: 800, triggerOn: "load" } } } as any,
          createBlock("text", { html: `<p>A clean, persuasive page for your business — edit anything, then publish.</p>` }) as any,
          createBlock("button", { text: "Get started", href: "#contact", variant: "primary", size: "lg" }) as any,
          createBlock("button", { text: "See how it works", href: "#proof", variant: "ghost", size: "lg" }) as any,
        ] }] }],
      },
      {
        id: newId("s"), name: "Proof", fullWidth: false,
        styles: { backgroundColor: t.surface, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
        rows: [{ id: newId("r"), styles: {}, columns: [33.3, 33.3, 33.4].map((w, i) => ({ id: newId("c"), widthPercent: w, styles: { animation: { preset: "fade-in", durationMs: 600, delayMs: i * 100, triggerOn: "scroll" } }, blocks: [
          createBlock("heading", { text: ["Built for results", "Easy to edit", "Ready to publish"][i], level: "h3" }) as any,
          createBlock("text", { html: "<p>Specific, plausible detail — never placeholder copy.</p>" }) as any,
        ] })) }],
      },
      {
        id: newId("s"), name: "Showcase", fullWidth: true,
        styles: { backgroundColor: t.background, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
        rows: [{ id: newId("r"), styles: {}, columns: [
          { id: newId("c"), widthPercent: 50, styles: {}, blocks: [
            createBlock("image", { src: `https://picsum.photos/seed/${Date.now().toString(36)}/1200/800`, alt: "Showcase image" }) as any,
          ] },
          { id: newId("c"), widthPercent: 50, styles: {}, blocks: [
            createBlock("heading", { text: "Why customers choose us", level: "h2" }) as any,
            createBlock("list", { items: ["Clear pricing, no surprises", "Fast turnaround", "Friendly human support"], ordered: false }) as any,
            createBlock("button", { text: "Learn more", href: "#contact", variant: "secondary", size: "md" }) as any,
          ] },
        ] }],
      },
      {
        id: newId("s"), name: "Testimonials", fullWidth: false,
        styles: { backgroundColor: t.surface, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
        rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [
          createBlock("heading", { text: "Loved by customers", level: "h2" }) as any,
          createBlock("testimonial", { quote: "Exactly what we needed — fast, professional, and easy to work with.", author: "Sarah Mitchell", role: "Boutique owner", rating: 5 }) as any,
        ] }] }],
      },
      {
        id: newId("s"), name: "Contact", fullWidth: false,
        styles: { backgroundColor: t.background, padding: { top: 72, bottom: 72 }, animation: { ...scroll } },
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

  // ── AES-256-GCM credential encryption ────────────────────────
  private encKey(): Buffer {
    return requireIntegrationKey();
  }
  private encrypt(payload: any): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.encKey(), iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString("base64");
  }
  private decrypt(blob: string): Record<string, any> {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.encKey(), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
  }
}

// ─── shared helpers ─────────────────────────────────────────
/** Never return raw provider keys to clients — length-only fingerprint. */
export function maskKey(s: string): string {
  const v = String(s ?? "");
  if (!v) return "";
  return `*** (${v.length} chars)`;
}

export function redact(s: string): string {
  if (!s) return s;
  return String(s).replace(/nvapi-[A-Za-z0-9_\-]+/g, "nvapi-***")
    .replace(/sk-[A-Za-z0-9_\-]+/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***");
}

export function withVersionedPath(rawUrl: string, suffix: string): string {
  const url = new URL(rawUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/v\d+(\/|$)/.test(pathname) ? pathname + suffix : pathname + "/v1" + suffix;
  return url.toString();
}

export function validateBase(base: string): string {
  let url: URL;
  try { url = new URL(String(base).slice(0, 500)); } catch { throw new BadRequestException("Invalid Base URL"); }
  if (url.username || url.password) throw new BadRequestException("Base URL must not contain credentials");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new BadRequestException("Base URL must be http(s).");
  const h = url.hostname.toLowerCase();
  if (!h || h.length > 253) throw new BadRequestException("Invalid Base URL host");
  const privateHost = h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".lan") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === "0.0.0.0" || h === "::1" || h === "[::1]";
  if (privateHost) throw new BadRequestException("Private/local Base URLs are blocked (SSRF protection). Set AI_BASE_URL server-side if you host your own.");
  return url.toString().replace(/\/+$/, "");
}

function usesMaxCompletionTokens(model: string): boolean {
  const m = String(model).toLowerCase();
  return /(^|\/)(o[134]|gpt-5|nemotron-3|reason)/.test(m);
}

function extractJson(s: string): string {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const candidate = s.slice(start, end + 1);
    try { JSON.parse(candidate); return candidate; } catch {}
  }
  return s;
}

function extractHtml(s: string): string | null {
  if (/<!doctype\s+html/i.test(s)) return s;
  const start = s.indexOf("<html");
  if (start >= 0) return s.slice(start);
  return s.indexOf("<body") >= 0 ? s : null;
}

export function mappedError(status: number, data: any): string {
  const body = typeof data === "string" ? data : JSON.stringify(data ?? {});
  const hint = String(body).slice(0, 300);
  if (status === 401) return "auth_failed — check your API key.";
  if (status === 403) return "forbidden — key valid but not permitted to that model. ON THE_ai/models to list enabled IDentifiers.";
  if (status === 404) return "model not found — wrong model ID or missing /v1 in base URL.";
  if (status === 429) return "rate_limited — too many requests. Retry later.";
  if (status >= 500) return "upstream_unavailable — provider outage. Retry or switch model.";
  if (/DEGRADED/i.test(hint)) return "Model instance temporarily down. Retry with another model.";
  return `HTTP ${status}: ${redact(hint)}`;
}

function keyHintFor(apiKey: string, provider: string): string | null {
  if (provider === "nvidia" && apiKey && !/^nvapi-[A-Za-z0-9]{20,}$/.test(apiKey)) {
    return "Your NVIDIA key seems too short (~40 chars expected). It's invalid. Regenerate at build.nvidia.com.'";
  }
  if (provider === "openai" && apiKey && !apiKey.startsWith("sk-")) {
    return "OpenAI keys start with sk-.";
  }
  if (provider === "anthropic" && apiKey && !apiKey.startsWith("sk-ant-")) {
    return "Anthropic keys start with sk-ant-.";
  }
  return null;
}