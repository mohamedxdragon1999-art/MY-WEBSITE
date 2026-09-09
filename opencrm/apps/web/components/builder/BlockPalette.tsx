"use client";
import { useState } from "react";
import type { Block } from "@opencrm/shared";
import { Heading1, AlignLeft, MousePointerClick, Image, Video, Minus, MoveVertical, Star, ListOrdered, TextCursorInput, Code2, Timer, Quote, Table2, HelpCircle, BellRing } from "lucide-react";
import { useBuilder } from "./store";

const BLOCKS: { type: Block["type"]; label: string; icon: any; category: string }[] = [
  { type: "heading", label: "Heading", icon: Heading1, category: "Basic" },
  { type: "text", label: "Text", icon: AlignLeft, category: "Basic" },
  { type: "button", label: "Button", icon: MousePointerClick, category: "Basic" },
  { type: "image", label: "Image", icon: Image, category: "Basic" },
  { type: "video", label: "Video", icon: Video, category: "Basic" },
  { type: "icon", label: "Icon", icon: Star, category: "Basic" },
  { type: "divider", label: "Divider", icon: Minus, category: "Basic" },
  { type: "spacer", label: "Spacer", icon: MoveVertical, category: "Basic" },
  { type: "list", label: "List", icon: ListOrdered, category: "Basic" },
  { type: "html", label: "Custom HTML", icon: Code2, category: "Advanced" },
  { type: "form", label: "Form", icon: TextCursorInput, category: "Marketing" },
  { type: "countdown", label: "Countdown", icon: Timer, category: "Marketing" },
  { type: "testimonial", label: "Testimonial", icon: Quote, category: "Marketing" },
  { type: "pricing-table", label: "Pricing", icon: Table2, category: "Marketing" },
  { type: "faq", label: "FAQ", icon: HelpCircle, category: "Marketing" },
  { type: "logo-cloud", label: "Logo Cloud", icon: BellRing, category: "Marketing" },
];

export function BlockPalette() {
  const { setDraggingType } = useBuilder();
  const [q, setQ] = useState("");
  const cats = ["Basic", "Marketing", "Advanced"];
  const filtered = BLOCKS.filter((b) => b.label.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="w-64 shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col">
      <div className="p-3 border-b border-ink-800">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search blocks…" className="w-full px-3 py-2 bg-ink-800 border border-ink-700 rounded text-sm" />
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-3">
        {cats.map((cat) => {
          const items = filtered.filter((b) => b.category === cat);
          if (items.length === 0) return null;
          return (
            <div key={cat} className="mb-4">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">{cat}</div>
              <div className="grid grid-cols-2 gap-2">
                {items.map((b) => (
                  <div key={b.type} title={`Drag or click to add ${b.label}`}
                    onClick={() => document.dispatchEvent(new CustomEvent("add-block", { detail: b.type }))}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("block-type", b.type); setDraggingType(b.type); }}
                    onDragEnd={() => setDraggingType(null)}
                    className="flex flex-col items-center gap-1.5 p-3 bg-ink-800 hover:bg-ink-700 rounded border border-ink-700 cursor-grab active:cursor-grabbing">
                    <b.icon size={18} className="text-ink-300" />
                    <span className="text-xs text-ink-300">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}