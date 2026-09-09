"use client";
import { useRef, useState } from "react";
import { SlidersHorizontal, Layers, Palette, Type, Upload } from "lucide-react";
import { useBuilder, stylesAt } from "./store";
import type { BlockStyles } from "@opencrm/shared";
import { DESIGN_SYSTEMS as DS } from "@opencrm/shared";
import { apiForm } from "@/lib/api";
import { cn } from "@/lib/utils";

type Tab = "content" | "style" | "layers" | "theme";

export function Inspector() {
  const [tab, setTab] = useState<Tab>("style");
  const { selectedId } = useBuilder();

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: "content", label: "Content", icon: Type },
    { id: "style", label: "Style", icon: SlidersHorizontal },
    { id: "layers", label: "Layers", icon: Layers },
    { id: "theme", label: "Theme", icon: Palette },
  ];

  return (
    <div className="w-80 shrink-0 bg-ink-900 border-l border-ink-800 flex flex-col">
      <div className="flex border-b border-ink-800">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-medium", tab === t.id ? "bg-ink-800 text-white border-b-2 border-blue-500" : "text-ink-400 hover:text-white")}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-4">
        {!selectedId ? (
          <p className="text-ink-500 text-sm text-center mt-8">Select an element to edit it</p>
        ) : tab === "content" ? <ContentPanel /> : tab === "style" ? <StylePanel /> : tab === "layers" ? <LayersPanel /> : <ThemePanel />}
      </div>
    </div>
  );
}

/** Self-hosted image upload (PNG/JPEG/GIF/WebP ≤5MB) straight into the selected image block. */
function UploadField({ onUploaded }: { onUploaded: (url: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError("Max 5MB per image."); return; }
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await apiForm<{ url: string }>("/uploads/image", form);
      onUploaded(r.url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
        onChange={(e) => pick(e.target.files?.[0])} />
      <button onClick={() => inputRef.current?.click()} disabled={busy}
        className="w-full flex items-center justify-center gap-2 py-2 rounded border border-ink-700 text-ink-300 hover:text-white text-xs disabled:opacity-50">
        <Upload size={13} /> {busy ? "Uploading…" : "Upload image"}
      </button>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
}

function ContentPanel() {  const { doc, selectedId, updateSelectedProps } = useBuilder();
  const node = findBlock(doc, selectedId!) as any;
  if (!node?.props) return <p className="text-ink-500 text-sm">No editable content</p>;
  const p = node.props;

  return (
    <div className="space-y-3 text-sm">
      {p.text !== undefined && (
        <Field label="Text"><textarea value={p.text} onChange={(e) => updateSelectedProps({ text: e.target.value })} className="field" rows={2} /></Field>
      )}
      {p.html !== undefined && (
        <Field label="HTML"><textarea value={p.html} onChange={(e) => updateSelectedProps({ html: e.target.value })} className="field" rows={5} /></Field>
      )}
      {p.href !== undefined && (
        <Field label="Link"><input value={p.href} onChange={(e) => updateSelectedProps({ href: e.target.value })} className="field" /></Field>
      )}
      {p.image?.src !== undefined && <Field label="Image URL"><input value={p.image.src} onChange={(e) => updateSelectedProps({ image: { ...p.image, src: e.target.value } })} className="field" /></Field>}
      {node.type === "button" && (
        <>
          <Field label="Button text"><input value={p.text} onChange={(e) => updateSelectedProps({ text: e.target.value })} className="field" /></Field>
          <SelectField label="Variant" value={p.variant} options={["primary", "secondary", "outline", "ghost"]} onChange={(v) => updateSelectedProps({ variant: v })} />
          <SelectField label="Size" value={p.size} options={["sm", "md", "lg"]} onChange={(v) => updateSelectedProps({ size: v })} />
        </>
      )}
      {node.type === "heading" && (
        <SelectField label="Level" value={p.level} options={["h1", "h2", "h3", "h4", "h5", "h6"]} onChange={(v) => updateSelectedProps({ level: v })} />
      )}
      {node.type === "image" && (
        <>
          <Field label="Source"><input value={p.src} onChange={(e) => updateSelectedProps({ src: e.target.value })} className="field" /></Field>
          <UploadField
            onUploaded={(url) => updateSelectedProps({ src: url })}
          />
          <Field label="Alt"><input value={p.alt} onChange={(e) => updateSelectedProps({ alt: e.target.value })} className="field" /></Field>
        </>
      )}
      {node.type === "spacer" && (
        <Field label="Height (px)"><input type="number" value={p.height} onChange={(e) => updateSelectedProps({ height: Number(e.target.value) })} className="field" /></Field>
      )}
      {node.type === "list" && (
        <Field label="Items (one per line)"><textarea value={(p.items ?? []).join("\n")} onChange={(e) => updateSelectedProps({ items: e.target.value.split("\n") })} className="field" rows={5} /></Field>
      )}
    </div>
  );
}

function StylePanel() {
  const { doc, selectedId, updateSelectedStyles, breakpoint } = useBuilder();
  const node: any = findAnyNode(doc, selectedId!);
  if (!node) return null;
  const styles = stylesAt(node.styles ?? {}, breakpoint);

  const set = (patch: Partial<BlockStyles>) => updateSelectedStyles(patch);

  return (
    <div className="space-y-4 text-sm">
      <SectionTitle>Typography</SectionTitle>
      <Field label="Font family"><input value={styles.fontFamily ?? ""} placeholder="Inter" onChange={(e) => set({ fontFamily: e.target.value })} className="field" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Size"><NumInput value={styles.fontSize} onChange={(v) => set({ fontSize: v })} /></Field>
        <Field label="Weight"><NumInput value={styles.fontWeight} onChange={(v) => set({ fontWeight: v })} /></Field>
        <Field label="Line height"><NumInput value={styles.lineHeight} onChange={(v) => set({ lineHeight: v })} /></Field>
        <Field label="Letter spacing"><NumInput value={styles.letterSpacing} onChange={(v) => set({ letterSpacing: v })} /></Field>
      </div>
      <Field label="Color"><input type="color" value={normalizeColor(styles.color)} onChange={(e) => set({ color: e.target.value })} className="field h-9" /></Field>
      <SelectField label="Align" value={styles.textAlign ?? ""} options={["", "left", "center", "right", "justify"]} onChange={(v) => set({ textAlign: (v || undefined) as any })} />

      <SectionTitle>Background</SectionTitle>
      <Field label="Color"><input type="color" value={normalizeColor(styles.backgroundColor)} onChange={(e) => set({ backgroundColor: e.target.value })} className="field h-9" /></Field>
      <Field label="Image URL"><input value={styles.backgroundImage ?? ""} onChange={(e) => set({ backgroundImage: e.target.value })} className="field" /></Field>
      <Field label="Overlay (rgba)"><input value={styles.backgroundOverlay ?? ""} placeholder="rgba(0,0,0,0.5)" onChange={(e) => set({ backgroundOverlay: e.target.value })} className="field" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Gradient from"><input type="color" value={normalizeColor(styles.gradientFrom)} onChange={(e) => set({ gradientFrom: e.target.value })} className="field h-9" /></Field>
        <Field label="Gradient to"><input type="color" value={normalizeColor(styles.gradientTo)} onChange={(e) => set({ gradientTo: e.target.value })} className="field h-9" /></Field>
      </div>

      <SectionTitle>Spacing (px)</SectionTitle>
      <div className="grid grid-cols-4 gap-2">
        <SpacingInput label="T" value={styles.padding?.top} onChange={(v) => set({ padding: { ...styles.padding, top: v } })} />
        <SpacingInput label="R" value={styles.padding?.right} onChange={(v) => set({ padding: { ...styles.padding, right: v } })} />
        <SpacingInput label="B" value={styles.padding?.bottom} onChange={(v) => set({ padding: { ...styles.padding, bottom: v } })} />
        <SpacingInput label="L" value={styles.padding?.left} onChange={(v) => set({ padding: { ...styles.padding, left: v } })} />
      </div>

      <SectionTitle>Border & effects</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Radius"><NumInput value={styles.borderRadius} onChange={(v) => set({ borderRadius: v })} /></Field>
        <Field label="Width"><NumInput value={styles.borderWidth} onChange={(v) => set({ borderWidth: v })} /></Field>
      </div>
      <Field label="Box shadow"><input value={styles.boxShadow ?? ""} placeholder="0 4px 12px rgba(0,0,0,0.1)" onChange={(e) => set({ boxShadow: e.target.value })} className="field" /></Field>
      <Field label="Opacity (0–1)"><NumInput value={styles.opacity} onChange={(v) => set({ opacity: v })} step={0.05} /></Field>

      <SectionTitle>Animation</SectionTitle>
      <SelectField label="Preset" value={styles.animation?.preset ?? "none"} options={["none", "fade-in", "slide-up", "zoom-in", "bounce"]} onChange={(v) => set({ animation: { ...styles.animation, preset: v as any } })} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Duration ms"><NumInput value={styles.animation?.durationMs} onChange={(v) => set({ animation: { ...styles.animation, durationMs: v } })} /></Field>
        <Field label="Delay ms"><NumInput value={styles.animation?.delayMs} onChange={(v) => set({ animation: { ...styles.animation, delayMs: v } })} /></Field>
      </div>

      <button onClick={() => updateSelectedStyles({}, "replace")} className="w-full mt-2 py-2 rounded border border-ink-700 text-ink-400 hover:text-white text-xs">Reset styles</button>
    </div>
  );
}

function LayersPanel() {
  const { doc, selectedId, select } = useBuilder();
  return (
    <div className="space-y-1 text-sm">
      {doc.sections.map((s) => (
        <div key={s.id}>
          <LayerRow id={s.id} label={s.name || "Section"} depth={0} selected={selectedId === s.id} onSelect={select} />
          {s.rows.map((r) => (
            <div key={r.id}>
              <LayerRow id={r.id} label="Row" depth={1} selected={selectedId === r.id} onSelect={select} />
              {r.columns.map((c) => (
                <div key={c.id}>
                  <LayerRow id={c.id} label="Column" depth={2} selected={selectedId === c.id} onSelect={select} />
                  {c.blocks.map((b) => (
                    <LayerRow key={b.id} id={b.id} label={b.type} depth={3} selected={selectedId === b.id} onSelect={select} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function LayerRow({ id, label, depth, selected, onSelect }: { id: string; label: string; depth: number; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button onClick={() => onSelect(id)}
      className={cn("w-full text-left px-2 py-1 rounded text-xs flex items-center", selected ? "bg-blue-600/30 text-blue-300" : "text-ink-300 hover:bg-ink-800")}
      style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="w-3 h-3 mr-2 rounded-sm border border-ink-500 inline-block" />
      {label}
    </button>
  );
}

function ThemePanel() {
  const { doc, updateTheme, applySystem } = useBuilder();
  const t = doc.theme;
  return (
    <div className="space-y-3 text-sm">
      <SectionTitle>Design system</SectionTitle>
      <div className="relative">
        <select value={t.system ?? ""} onChange={(e) => e.target.value && applySystem(e.target.value)} className="field">
          <option value="" disabled>Apply a design system…</option>
          {Object.entries(DS).map(([id, s]) => (
            <option key={id} value={id}>{s.name}</option>
          ))}
        </select>
      </div>
      {t.system && DS[t.system] && <p className="text-[11px] text-ink-500">{DS[t.system].description}</p>}

      <SectionTitle>Colors</SectionTitle>
      {Object.entries(t.colors).map(([k, v]) => (
        <div key={k} className="flex items-center justify-between">
          <span className="capitalize text-ink-300">{k}</span>
          <input type="color" value={normalizeColor(v)} onChange={(e) => updateTheme({ colors: { ...t.colors, [k]: e.target.value } })} className="h-8 w-12 rounded bg-ink-800 border border-ink-700" />
        </div>
      ))}
      <SectionTitle>Fonts</SectionTitle>
      <Field label="Heading"><input value={t.fonts.heading} onChange={(e) => updateTheme({ fonts: { ...t.fonts, heading: e.target.value } })} className="field" /></Field>
      <Field label="Body"><input value={t.fonts.body} onChange={(e) => updateTheme({ fonts: { ...t.fonts, body: e.target.value } })} className="field" /></Field>
      <Field label="Border radius"><NumInput value={t.borderRadius} onChange={(v) => updateTheme({ borderRadius: v })} /></Field>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────
function findBlock(doc: any, id: string): any {
  for (const s of doc.sections) for (const r of s.rows) for (const c of r.columns) for (const b of c.blocks) if (b.id === id) return b;
  return null;
}
function findAnyNode(doc: any, id: string): any {
  for (const s of doc.sections) {
    if (s.id === id) return s;
    for (const r of s.rows) {
      if (r.id === id) return r;
      for (const c of r.columns) {
        if (c.id === id) return c;
        for (const b of c.blocks) if (b.id === id) return b;
      }
    }
  }
  return null;
}

function normalizeColor(c?: string): string {
  if (!c) return "#ffffff";
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return "#ffffff";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] text-ink-400 mb-1">{label}</span>{children}</label>;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-800 pb-1 mb-1">{children}</div>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field">
        {options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
      </select>
    </Field>
  );
}
function NumInput({ value, onChange, step = 1 }: { value?: number; onChange: (v: number | undefined) => void; step?: number }) {
  return <input type="number" value={value ?? ""} step={step} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="field" />;
}
function SpacingInput({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <div>
      <span className="block text-[10px] text-ink-500 text-center">{label}</span>
      <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} className="field text-center" />
    </div>
  );
}