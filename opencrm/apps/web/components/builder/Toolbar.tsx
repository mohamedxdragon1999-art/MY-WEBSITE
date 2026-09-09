"use client";
import { useState } from "react";
import { Undo2, Redo2, Monitor, Tablet, Smartphone, Save, Plus, ArrowLeft, ExternalLink, Sparkles, LayoutGrid, X, History } from "lucide-react";
import { useBuilder } from "./store";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

const VERSION = "0.0.0.19";

export function Toolbar({ pageId, onOpenAi, onOpenTemplates, onOpenHistory }: { pageId: string | null; onOpenAi: () => void; onOpenTemplates: () => void; onOpenHistory: () => void }) {
  const { breakpoint, setBreakpoint, undo, redo, past, future, addSection, selectedId, removeSelected, duplicateSelected, dirty, doc, markSaved } = useBuilder();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const router = useRouter();

  const bpList = [{ id: "desktop", icon: Monitor }, { id: "tablet", icon: Tablet }, { id: "mobile", icon: Smartphone }] as const;

  async function save() {
    if (!pageId) return;
    setSaving(true); setSaveError(null);
    try {
      await api(`/funnels/page/${pageId}/document`, { method: "PATCH", body: JSON.stringify({ document: doc }) });
      markSaved();
    } catch (e: any) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!pageId) return;
    await api(`/funnels/page/${pageId}/publish`, { method: "POST" });
    alert("Published. Open the public link from Sites & Funnels.");
  }

  return (
    <header className="h-14 bg-ink-900 border-b border-ink-800 flex items-center justify-between px-4 gap-3 shrink-0">
      <div className="flex items-center gap-2">
        <button onClick={() => router.push("/dashboard/sites")} className="p-2 rounded hover:bg-ink-800 text-ink-300" title="Back"><ArrowLeft size={16} /></button>
        <span className="text-sm text-ink-400 mr-1">OpenCRM <span className="text-ink-500 text-[10px]">v{VERSION}</span></span>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button onClick={undo} disabled={past.length === 0} className="px-2 py-1.5 rounded hover:bg-ink-800 disabled:opacity-30 text-ink-300" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
        <button onClick={redo} disabled={future.length === 0} className="px-2 py-1.5 rounded hover:bg-ink-800 disabled:opacity-30 text-ink-300" title="Redo (Ctrl+Y)"><Redo2 size={15} /></button>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button onClick={addSection} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-sm"><Plus size={14} /> Section</button>
        <button onClick={onOpenTemplates} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-sm"><LayoutGrid size={14} /> Templates</button>
        {selectedId && (
          <>
            <button onClick={duplicateSelected} className="px-2 py-1.5 rounded hover:bg-ink-800 text-ink-300" title="Duplicate (Ctrl+D)"><Undo2 size={14} className="rotate-45" /></button>
            <button onClick={removeSelected} className="px-2 py-1.5 rounded hover:bg-red-600/80 text-ink-300" title="Delete (Del)"><X size={14} /></button>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex bg-ink-800 rounded p-0.5">
          {bpList.map((b) => (
            <button key={b.id} onClick={() => setBreakpoint(b.id)} className={cn("p-1.5 rounded transition", breakpoint === b.id ? "bg-blue-600 text-white" : "text-ink-400 hover:text-white")} title={b.id}>
              <b.icon size={14} />
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button onClick={onOpenAi} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-gradient-to-r from-blue-600 to-purple-600 text-sm font-medium"><Sparkles size={14} /> AI Build</button>
        <button onClick={onOpenHistory} disabled={!pageId} className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-sm disabled:opacity-40" title="Version history"><History size={14} /> History</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-60" title={saveError ?? "Save (Ctrl+S)"}>
          <Save size={14} /> {saveError ? "Save failed" : dirty ? (saving ? "Saving…" : "Save *") : "Saved"}
        </button>
        <button onClick={publish} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-ink-800 hover:bg-ink-700 text-sm"><ExternalLink size={13} /> Publish</button>
        <a href={`/preview/${pageId ?? ""}`} target="_blank" rel="noreferrer" className="px-2 py-1.5 rounded hover:bg-ink-800 text-ink-300" title="Open preview"><ExternalLink size={14} /></a>
      </div>
    </header>
  );
}