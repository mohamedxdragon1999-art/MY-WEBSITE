"use client";
import { useEffect, useState } from "react";
import { Globe, Sparkles, Wand2, X } from "lucide-react";
import type { PageDocument } from "@opencrm/shared";
import { DESIGN_SYSTEMS } from "@opencrm/shared";
import { api } from "@/lib/api";
import { useBuilder } from "./store";
import * as ops from "./ops";

type Tab = "describe" | "import";

export function AiModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { load, doc, selectedId, apply, setRawHtml } = useBuilder();
  const [tab, setTab] = useState<Tab>("describe");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"structured" | "html">("structured");
  const [system, setSystem] = useState("minimal");
  const [target, setTarget] = useState<"page" | "element">("page");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number; remaining: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null); setNote(null);
    api<{ used: number; cap: number; remaining: number }>("/ai/usage").then(setUsage).catch(() => setUsage(null));
  }, [open ]);

  if (!open) return null;

  function applyResult(r: any, source?: { url: string; title: string }) {
    if (r.html) {
      setRawHtml(r.html);
      setNote("Generated raw HTML. Use Code view to fine-tune.");
    } else if (r.document) {
      load(r.document as PageDocument, true); // unsaved until Save is pressed
      const n = (r.document.sections ?? []).length;
      setNote(`Loaded ${n} section${n === 1 ? "" : "s"} — press Save to keep.${source ? ` Imported from "${source.title}". Review copy before publishing.` : ""}${r.fallback ? ` Note: AI was unreachable, used local generator (${r.reason ?? "no reason"}).` : ""}`);
    }
    setUsage((u) => (u ? { ...u, used: u.used + 1, remaining: Math.max(0, u.remaining - 1) } : u));
  }

  async function generate() {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await api<any>("/ai/generate-page", {
        method: "POST",
        body: JSON.stringify({ prompt, mode, system }),
      });
      applyResult(r);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function importUrl() {
    setBusy(true); setError(null); setNote(null);
    try {
      const r = await api<any>("/ai/import-url", {
        method: "POST",
        body: JSON.stringify({ url, mode, system }),
      });
      applyResult(r, r.source);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function editSelected() {
    const sel = selectedId;
    if (!sel) return;
    const node = ops.getNode(doc, sel);
    if (!node) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const updated = await api<any>("/ai/edit-element", {
        method: "POST",
        body: JSON.stringify({ instruction, element: node, system }),
      });
      const d = JSON.parse(JSON.stringify(doc)) as PageDocument;
      replaceNode(d, sel, updated);
      apply(d);
      setNote("Element updated — press Save to keep.");
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = !busy && (tab === "import" ? url.trim().length > 8 : target === "element" ? instruction.trim().length > 0 : prompt.trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onMouseDown={onClose}>
      <div className="w-full max-w-lg bg-ink-900 border border-ink-700 rounded-xl p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Sparkles size={18} className="text-purple-400" /> AI website builder</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-ink-800"><X size={16} /></button>
        </div>
        <p className="text-sm text-ink-400 mb-1">Describe, import a site, or edit the selection. Uses your own NVIDIA/OpenAI key in Settings.</p>
        {usage && (
          <p className="text-[11px] text-ink-500 mb-3">AI usage today: {usage.used}/{usage.cap}{usage.remaining === 0 ? " — cap reached, resumes tomorrow" : ""}</p>
        )}

        <div className="flex gap-2 mb-3">
          <button onClick={() => setTab("describe")} className={`px-3 py-1.5 rounded text-xs ${tab === "describe" ? "bg-blue-600" : "bg-ink-800"}`}>Describe</button>
          <button onClick={() => setTab("import")} className={`px-3 py-1.5 rounded text-xs flex items-center gap-1 ${tab === "import" ? "bg-blue-600" : "bg-ink-800"}`}><Globe size={12} /> Import URL</button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="text-[11px] text-ink-400 mb-1 block">Output</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="field">
              <option value="structured">Editable blocks</option>
              <option value="html">Raw HTML (max freedom)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] text-ink-400 mb-1 block">Design system</span>
            <select value={system} onChange={(e) => setSystem(e.target.value)} className="field">
              {Object.keys(DESIGN_SYSTEMS).map((id) => (
                <option key={id} value={id}>{DESIGN_SYSTEMS[id].name}</option>
              ))}
            </select>
          </label>
        </div>

        {tab === "import" ? (
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com — we read it and rebuild it as an original page"
            className="field" inputMode="url" />
        ) : selectedId ? (
          <>
            <div className="flex gap-2 mb-3">
              <button onClick={() => setTarget("page")} className={`px-3 py-1.5 rounded text-xs ${target === "page" ? "bg-blue-600" : "bg-ink-800"}`}>Whole page</button>
              <button onClick={() => setTarget("element")} className={`px-3 py-1.5 rounded text-xs flex items-center gap-1 ${target === "element" ? "bg-purple-600" : "bg-ink-800"}`}>
                <Wand2 size={12} /> Edit selection
              </button>
            </div>
            {target === "element" ? (
              <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
                placeholder='e.g. "make this CTA button bigger, rounded pill, glassy" or "turn this section into a pricing table"'
                className="field min-h-[80px]" rows={3} />
            ) : (
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A plumbing website for Springfield: hero with call button, services, reviews, booking form."
                className="field min-h-[90px]" rows={4} />
            )}
          </>
        ) : (
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. An online store for handmade candles: hero, bestsellers, reviews, FAQ, footer."
            className="field min-h-[90px]" rows={4} />
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 rounded border border-ink-700 text-ink-300 hover:text-white text-sm">Cancel</button>
          <button
            onClick={tab === "import" ? importUrl : target === "element" && tab === "describe" ? editSelected : generate}
            disabled={!canSubmit}
            className="px-5 py-2 rounded bg-gradient-to-r from-blue-600 to-purple-600 hover:opacity-90 text-sm font-medium disabled:opacity-50">
            {busy ? "Working…" : tab === "import" ? "Import & rebuild" : target === "element" ? "Edit element" : "Generate"}
          </button>
        </div>
        {error && <p className="text-red-400 text-sm mt-3">{error}</p>}
        {note && <p className="text-amber-400 text-sm mt-3">{note}</p>}
      </div>
    </div>
  );
}

function friendlyError(e: any): string {
  const status = e?.status;
  const msg = String(e?.message ?? "Something went wrong");
  if (status === 429) return msg + " (Wait a minute, or raise the AI daily cap server-side.)";
  if (status === 502) return "That website couldn't be fetched. Check the link and try again.";
  if (status === 401) return "Session expired — log in again.";
  return msg;
}

function replaceNode(doc: PageDocument, id: string, updated: any) {
  for (let s = 0; s < doc.sections.length; s++) {
    const sec = doc.sections[s];
    if (sec.id === id) { doc.sections[s] = updated; return true; }
    for (let r = 0; r < sec.rows.length; r++) {
      const row = sec.rows[r];
      if (row.id === id) { sec.rows[r] = updated; return true; }
      for (let c = 0; c < row.columns.length; c++) {
        const col = row.columns[c];
        if (col.id === id) { row.columns[c] = updated; return true; }
        for (let b = 0; b < col.blocks.length; b++) {
          if (col.blocks[b].id === id) { col.blocks[b] = updated; return true; }
        }
      }
    }
  }
  return false;
}
