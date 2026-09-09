"use client";
import { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import { api } from "@/lib/api";
import { useBuilder } from "./store";
import type { PageDocument } from "@opencrm/shared";

interface Row { id: string; createdAt: string; bytes: number; }

/** Server-side version history: restoring snapshots the current doc first, so nothing is ever lost. */
export function VersionsPanel({ pageId, open, onClose }: { pageId: string | null; open: boolean; onClose: () => void }) {
  const { load } = useBuilder();
  const [rows, setRows] = useState<Row[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !pageId) return;
    setError(null);
    api<Row[]>(`/funnels/page/${pageId}/versions`).then(setRows).catch((e) => setError(e.message));
  }, [open, pageId]);

  if (!open) return null;

  async function restore(id: string) {
    if (!pageId) return;
    if (!window.confirm("Restore this version? Your current page is auto-saved as a version first.")) return;
    setBusyId(id); setError(null);
    try {
      const r = await api<any>(`/funnels/page/${pageId}/restore/${id}`, { method: "POST" });
      load(r.document as PageDocument, true);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onMouseDown={onClose}>
      <div className="w-full max-w-md bg-ink-900 border border-ink-700 rounded-xl p-6 shadow-2xl max-h-[80vh] overflow-auto thin-scroll" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold flex items-center gap-2"><History size={18} className="text-emerald-400" /> Version history</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-ink-800"><X size={16} /></button>
        </div>
        <p className="text-xs text-ink-500 mb-4">Last 20 saves. Restoring keeps your current page as a new version.</p>
        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
        {rows.length === 0 && !error && <p className="text-sm text-ink-400">No versions yet — press Save to create the first snapshot.</p>}
        <ul className="space-y-2">
          {rows.map((v, i) => (
            <li key={v.id} className="flex items-center justify-between gap-3 bg-ink-800 rounded-lg px-3 py-2">
              <div>
                <div className="text-sm">{i === 0 ? "Latest snapshot" : new Date(v.createdAt).toLocaleString()}</div>
                <div className="text-[11px] text-ink-500">{(v.bytes / 1024).toFixed(1)} KB</div>
              </div>
              <button onClick={() => restore(v.id)} disabled={busyId !== null}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-medium disabled:opacity-50">
                {busyId === v.id ? "Restoring…" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
