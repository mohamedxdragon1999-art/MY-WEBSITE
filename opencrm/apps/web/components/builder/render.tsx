"use client";
import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import type { Block, BlockStyles, PageDocument } from "@opencrm/shared";
import { api } from "@/lib/api";
import {
  Star, Mail, Phone, Globe, Clock, Zap, Wind, Heart, ThumbsUp,
  TrendingUp, Camera, Video, Image, Menu, X, Search, Share, Lock,
} from "lucide-react";

export function toCss(s: BlockStyles | null | undefined): CSSProperties {
  const o: Record<string, any> = {};
  if (!s) return o;
  const px = (n?: number) => (n === undefined ? undefined : `${n}px`);
  if (s.display) o.display = s.display;
  if (s.width) o.width = s.width;
  if (s.maxWidth) o.maxWidth = s.maxWidth;
  if (s.textAlign) o.textAlign = s.textAlign;
  if (s.padding) {
    if (s.padding.top !== undefined) o.paddingTop = px(s.padding.top);
    if (s.padding.right !== undefined) o.paddingRight = px(s.padding.right);
    if (s.padding.bottom !== undefined) o.paddingBottom = px(s.padding.bottom);
    if (s.padding.left !== undefined) o.paddingLeft = px(s.padding.left);
  }
  if (s.margin) {
    if (s.margin.top !== undefined) o.marginTop = px(s.margin.top);
    if (s.margin.right !== undefined) o.marginRight = px(s.margin.right);
    if (s.margin.bottom !== undefined) o.marginBottom = px(s.margin.bottom);
    if (s.margin.left !== undefined) o.marginLeft = px(s.margin.left);
  }
  if (s.fontFamily) o.fontFamily = `"${s.fontFamily}", system-ui, sans-serif`;
  if (s.fontSize) o.fontSize = px(s.fontSize);
  if (s.fontWeight) o.fontWeight = s.fontWeight;
  if (s.lineHeight !== undefined) o.lineHeight = s.lineHeight;
  if (s.letterSpacing !== undefined) o.letterSpacing = px(s.letterSpacing);
  if (s.color) o.color = s.color;
  if (s.opacity !== undefined) o.opacity = s.opacity;
  if (s.transform) o.transform = s.transform;
  if (s.transition) o.transition = s.transition;
  // Background
  if (s.backgroundImage && s.backgroundOverlay) {
    o.backgroundImage = `linear-gradient(${s.backgroundOverlay}, ${s.backgroundOverlay}), url("${s.backgroundImage}")`;
    o.backgroundSize = "cover"; o.backgroundPosition = "center";
  } else if (s.backgroundImage) {
    o.backgroundImage = `url("${s.backgroundImage}")`;
    o.backgroundSize = "cover"; o.backgroundPosition = "center";
  } else if (s.gradientFrom && s.gradientTo) {
    o.backgroundImage = `linear-gradient(${s.gradientDirection ?? "90deg"}, ${s.gradientFrom}, ${s.gradientTo})`;
  } else if (s.backgroundColor) o.backgroundColor = s.backgroundColor;
  if (s.borderRadius !== undefined) o.borderRadius = px(s.borderRadius);
  if (s.borderWidth !== undefined) o.borderWidth = px(s.borderWidth);
  if (s.borderStyle && s.borderWidth) o.borderStyle = s.borderStyle as any;
  if (s.borderColor) o.borderColor = s.borderColor;
  if (s.boxShadow) o.boxShadow = s.boxShadow;
  if (s.blur !== undefined) o.filter = `blur(${s.blur}px)`;
  return o;
}

export function blockAnimCss(a?: BlockStyles["animation"]): CSSProperties {  if (!a?.preset || a.preset === "none") return {};
  const dur = (a.durationMs ?? 600) + "ms";
  const del = (a.delayMs ?? 0) + "ms";
  const map: Record<string, string> = {
    "fade-in": "dist-fade-in", "slide-up": "dist-slide-up", "slide-down": "dist-slide-down",
    "zoom-in": "dist-zoom-in", "zoom-out": "dist-zoom-out", "slide-left": "dist-slide-left",
    "slide-right": "dist-slide-right", bounce: "dist-bounce", "rotate-in": "dist-rotate-in",
  };
  const kf = map[a.preset];
  if (!kf) return {};
  return { animation: `${kf} ${dur} ${del} both` };
}

/**
 * Responsive layer for published pages: turns per-node tablet/mobile style
 * overrides into real media-query CSS (inline styles can't do breakpoints),
 * plus mobile stacking so multi-column rows never overflow a phone.
 * Nodes carry `bl-<id>` classes (see PageRenderer); overrides win via !important.
 */
export function responsiveCss(doc: PageDocument): string {
  const chunks: string[] = [];
  const cls = (id: string) => `.bl-${String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const decls = (s: any): string => {
    if (!s || typeof s !== "object") return "";
    const o = toCss(s as BlockStyles) as Record<string, any>;
    return Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}:${v}!important`)
      .join(";");
  };
  const node = (id: string, styles: any) => {
    const t = decls(styles?.tablet);
    const m = decls(styles?.mobile);
    if (t) chunks.push(`@media (max-width:1024px){${cls(id)}{${t}}}`);
    if (m) chunks.push(`@media (max-width:640px){${cls(id)}{${m}}}`);
  };
  for (const s of (doc.sections ?? []) as any[]) {
    node(s.id, s.styles);
    for (const r of s.rows ?? []) {
      node(r.id, r.styles);
      for (const c of r.columns ?? []) {
        node(c.id, c.styles);
        for (const b of c.blocks ?? []) node(b.id, b.styles);
      }
    }
  }
  chunks.push(`@media (max-width:640px){.bl-row{flex-direction:column!important}.bl-row>.bl-col{width:100%!important}.bl-pricing{grid-template-columns:1fr!important}}`);
  return chunks.join("\n");
}

export interface SubmitEvent { fields: Record<string, string>; pageId: string; }
type FormSubmit = ((ev: SubmitEvent) => Promise<void>) | null;

const ICON_MAP: Record<string, any> = {
  star: Star, mail: Mail, phone: Phone, globe: Globe, clock: Clock, zap: Zap,
  wind: Wind, heart: Heart, like: ThumbsUp, trend: TrendingUp, camera: Camera,
  video: Video, image: Image, menu: Menu, x: X, search: Search, share: Share, shield: Lock, lock: Lock,
};

export function BlockView(props: { block: Block; styles: BlockStyles; formSubmit?: FormSubmit; pageId?: string }) {
  const { block, styles, formSubmit, pageId } = props;
  // Forms submit to the public capture endpoint when a page context exists
  // (preview + published). Inside the editor canvas there is no pageId → inert.
  const submit: FormSubmit = formSubmit ?? (pageId
    ? async (ev) => {
        await api(`/public/forms/${pageId}/submit`, { method: "POST", body: JSON.stringify({ fields: ev.fields }) });
      }
    : null);
  const css = { ...toCss(styles), ...blockAnimCss(styles.animation) };
  const p = (block.props ?? {}) as Record<string, any>;

  switch (block.type) {
    case "heading": {
      const Tag = (p.level ?? "h2") as any;
      // Plain text by schema — render escaped (React default), never as HTML:
      // imported/AI content must not become a script vector.
      return <Tag style={css}>{String(p.text ?? "")}</Tag>;
    }
    case "text": return <div style={css} dangerouslySetInnerHTML={{ __html: htmlify(p.html) }} />;
    case "button": {
      const v = p.variant ?? "primary";
      const sz = p.size ?? "md";
      const pad = sz === "sm" ? "8px 16px" : sz === "lg" ? "16px 32px" : "12px 24px";
      const fontSize = sz === "sm" ? 14 : sz === "lg" ? 18 : 16;
      const base: CSSProperties = {
        display: "inline-block", borderRadius: 8, textDecoration: "none", cursor: "pointer",
        fontWeight: 600, fontSize, padding: pad, transition: "all 0.15s ease", ...css,
      };
      const map: Record<string, CSSProperties> = {
        primary: { background: "var(--accent, #2563eb)", color: "var(--accent-on, #fff)", border: "none" },
        secondary: { background: "var(--surface, #7c3aed)", color: "#fff", border: "none" },
        outline: { background: "transparent", color: css.color ?? "var(--accent, #2563eb)", border: `2px solid ${css.color ?? "var(--accent, #2563eb)"}` },
        ghost: { background: "transparent", color: css.color ?? "var(--accent, #2563eb)", border: "none" },
      };
      return <a href={p.href ?? "#"} target={p.openInNewTab ? "_blank" : undefined} rel="noreferrer" style={{ ...map[v], ...base }}>{p.text ?? "Button"}</a>;
    }
    case "image": return <img src={p.src} alt={p.alt ?? ""} style={{ ...css, objectFit: p.objectFit ?? "cover", maxWidth: "100%", display: "block" }} />;
    case "video": return p.url ? <video src={p.url} autoPlay={p.autoplay} loop={p.loop} controls={p.controls} style={{ ...css, width: "100%" }} /> : <div style={css}>Video</div>;
    case "spacer": return <div style={{ height: (p.height ?? 48) + "px" }} />;
    case "divider": return <hr style={{ ...css, border: "none", height: cnum(p.thickness, 1) + "px", background: p.color ?? "#e5e7eb" }} />;
    case "icon": {
      const size = (p.size ?? 24);
      const IconComp = ICON_MAP[(p.name ?? "star").toLowerCase()] ?? Star;
      return <IconComp style={{ width: size, height: size, color: p.color ?? css.color ?? "currentColor", ...css }} />;
    }
    case "list": {
      const Tag = p.ordered ? "ol" : "ul";
      return <Tag style={{ ...css, paddingLeft: 24, margin: 0 }}>{(p.items ?? []).map((it: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{it}</li>)}</Tag>;
    }
    case "form": return <FormBlock props={p} styles={styles} submit={submit} pageId={pageId ?? ""} />;
    case "html": return <div style={css} dangerouslySetInnerHTML={{ __html: p.code ?? "" }} />;
    case "countdown": return <CountdownBlock targetDate={p.targetDate} expired={p.expiredText} css={css} />;
    case "testimonial": return (
      <figure style={{ ...css, maxWidth: 720 }}>
        <blockquote style={{ fontSize: 20, lineHeight: 1.6, fontStyle: "italic", marginBottom: 16 }}>"{p.quote}"</blockquote>
        <figcaption style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {p.avatarUrl && <img src={p.avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />}
          <div>
            <div style={{ fontWeight: 600 }}>{p.author}</div>
            {p.role && <div style={{ fontSize: 13, opacity: 0.65 }}>{p.role}</div>}
          </div>
          {p.rating > 0 && (
            <div style={{ marginLeft: 16, display: "inline-flex", gap: 2 }}>
              {Array.from({ length: p.rating }).map((_, i) => <Star key={i} size={14} fill="var(--accent, #f59e0b)" stroke="none" />)}
            </div>
          )}
        </figcaption>
      </figure>
    );
    case "pricing-table": return (
      <div className="bl-pricing" style={{ ...css, display: "grid", gridTemplateColumns: `repeat(${(p.tiers ?? []).length}, minmax(0, 1fr))`, gap: 16 }}>
        {(p.tiers ?? []).map((t: any, i: number) => (
          <div key={i} style={{
            border: `1px solid ${t.highlighted ? "var(--accent, #2563eb)" : "var(--border, #e5e7eb)"}`,
            borderRadius: 12, padding: 28, background: t.highlighted ? "var(--surface-warm, #f8fafc)" : "#fff",
            boxShadow: t.highlighted ? "0 20px 40px -12px rgba(0,0,0,0.08)" : "none",
            position: "relative",
          }}>
            {t.highlighted && <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "var(--accent, #2563eb)", color: "#fff", fontSize: 11, padding: "3px 10px", borderRadius: 999 }}>Most popular</span>}
            <div style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</div>
            <div style={{ fontSize: 36, fontWeight: 700, margin: "12px 0", letterSpacing: "-0.02em" }}>{t.price}<span style={{ fontSize: 14, fontWeight: 400, opacity: 0.6 }}>/{t.period?.replace(/^\//, "")}</span></div>
            <ul style={{ paddingLeft: 0, margin: 0, listStyle: "none" }}>
              {(t.features ?? []).map((f: string, j: number) => <li key={j} style={{ marginBottom: 8, fontSize: 14, display: "flex", gap: 8, alignItems: "flex-start" }}><span style={{ color: "var(--accent, #2563eb)", marginTop: 2 }}>&#10003;</span>{f}</li>)}
            </ul>
            <a href={t.ctaHref ?? "#"} style={{ display: "block", textAlign: "center", marginTop: 16, padding: "10px 18px", borderRadius: 8, background: t.highlighted ? "var(--accent, #2563eb)" : "var(--surface, #f1f5f9)", color: t.highlighted ? "#fff" : "inherit", textDecoration: "none", fontWeight: 600, transition: "opacity 0.15s" }}>{t.ctaText ?? "Get started"}</a>
          </div>
        ))}
      </div>
    );
    case "faq": return (
      <div style={css}>
        {(p.items ?? []).map((it: any, i: number) => (
          <details key={i} style={{ borderBottom: "1px solid var(--border-soft, #e5e7eb)", padding: "14px 4px", cursor: "pointer" } as CSSProperties}>
            <summary style={{ fontWeight: 600, cursor: "pointer" }}>{it.question}</summary>
            <p style={{ marginTop: 8, opacity: 0.82, marginBottom: 0 }}>{it.answer}</p>
          </details>
        ))}
      </div>
    );
    case "logo-cloud": return (
      <div style={{ ...css, display: "flex", gap: 32, flexWrap: "wrap", alignItems: "center", justifyContent: "center" }}>
        {(p.logos ?? []).map((l: any, i: number) => <img key={i} src={l.src} alt={l.alt} style={{ height: 28, opacity: 0.6 }} />)}
      </div>
    );
    default: return <div style={css}>{htmlify(p.text ?? block.type)}</div>;
  }
}

function FormBlock({ props: p, styles, submit, pageId }: { props: Record<string, any>; styles: BlockStyles; submit: FormSubmit; pageId: string }) {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = (p.fields ?? []) as any[];
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!submit) return;
    const pData: Record<string, string> = {};
    new FormData(e.currentTarget).forEach((v, k) => { pData[k as string] = String(v); });
    setSending(true); setError(null);
    try { await submit({ fields: pData, pageId }); setSent(true); } catch (eErr: any) { setError(eErr.message); }
    setSending(false);
  }
  return (
    <form style={toCss(styles)} onSubmit={onSubmit}>
      {sent ? <div style={{ padding: 16, textAlign: "center", color: "var(--accent, #16a34a)", fontWeight: 600 }}>{translateBack(p.successMessage ?? "✓ Thank you! We'll be in touch.")}</div>
        : (
          <>
            {fields.map((f: any) => (
              <div key={f.name} style={{ marginBottom: 12 }}>
                <label style={{ display: "block", marginBottom: 4, fontSize: 13, fontWeight: 500 }}>{f.label}{f.required ? " *" : ""}</label>
                {f.type === "textarea" ? (
                  <textarea name={f.name} required={f.required} rows={3} style={inputCss()}
                  />
                ) : f.type === "select" ? (
                  <select name={f.name} required={f.required} style={inputCss()}>
                    <option value="">Select...</option>
                    {(f.options ?? []).map((o: string) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input name={f.name} type={f.type} required={f.required} style={inputCss()} />
                )}
              </div>
            ))}
            <button type="submit" disabled={sending}
              style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "var(--accent, #2563eb)", color: "#fff", fontWeight: 600, cursor: "pointer", opacity: sending ? 0.6 : 1 }}>
              {sending ? "Sending…" : (p.submitLabel ?? "Submit")}
            </button>
            {error && <p style={{ color: "#dc2626", fontSize: 12, marginTop: 6 }}>{error}</p>}
          </>
        )}
    </form>
  );
}

function inputCss(): CSSProperties {
  return { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border, #cbd5e1)", background: "#fff", color: "#0f172a", fontSize: 14 };
}

function CountdownBlock({ targetDate, expired, css }: { targetDate?: string; expired?: string; css: CSSProperties }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const end = new Date(targetDate ?? Date.now()).getTime();
  const diff = end - now;
  if (diff <= 0) return <div style={css}>{expired ?? "Offer expired"}</div>;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  const box = { padding: "12px 16px", borderRadius: 8, background: "var(--surface, #f1f5f9)", textAlign: "center" as const };
  return (
    <div style={{ ...css, display: "flex", gap: 8, alignItems: "center", justifyContent: css.textAlign === "center" ? "center" : "flex-start" }}>
      {([{ v: days, l: "days" }, { v: hours, l: "hours" }, { v: mins, l: "min" }, { v: secs, l: "sec" }] as const).map(({ v, l }) => (
        <div key={l} style={box}>
          <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{String(v).padStart(2, "0")}</div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, opacity: 0.6 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

function htmlify(s: any): string {
  return String(s ?? "").replace(/</g, "<").replace(/>/g, ">");
}

function cnum(v: any, d = 0) { return typeof v === "number" ? v : (typeof v === "string" ? parseFloat(v) : d); }

function translateBack(s: string) {
  return s.replace(/^✓/, "");
}
