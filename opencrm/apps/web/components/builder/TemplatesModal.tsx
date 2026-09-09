"use client";
import { X } from "lucide-react";
import { TEMPLATES } from "./templates";
import { useBuilder } from "./store";

export function TemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { load } = useBuilder();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" onMouseDown={onClose}>
      <div className="w-full max-w-2xl bg-ink-900 border border-ink-700 rounded-xl p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Templates</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-ink-800"><X size={16} /></button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {TEMPLATES.map((t) => (
            <button key={t.name} onClick={() => { load(JSON.parse(JSON.stringify(t.doc)), true); onClose(); }}
              className="text-left bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded-lg p-4 transition">
              <div className="w-full h-20 bg-gradient-to-br from-blue-600/30 to-purple-600/30 rounded mb-3" />
              <div className="font-medium text-sm">{t.name}</div>
              <div className="text-xs text-ink-400 mt-1">{t.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}