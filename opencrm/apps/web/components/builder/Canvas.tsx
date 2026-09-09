"use client";
import { useEffect, useRef, useState } from "react";
import type { Block, PageDocument, Section } from "@opencrm/shared";
import { useBuilder, stylesAt } from "./store";
import { BlockView } from "./render";
import { Keymap } from "./Keymap";
import { DesignTokenStyle } from "./DesignTokenStyle";
import { SECTION_PRESETS } from "./presets";
import { cn } from "@/lib/utils";

export function Canvas() {
  const { doc, selectedId, breakpoint, select, addBlock, addSection, moveNode, removeSelected, duplicateSelected } = useBuilder();
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  useEffect(() => { setMenu(null); }, [selectedId]);

  function firstColumn(d: PageDocument): string {
    for (const s of d.sections) for (const r of s.rows) for (const c of r.columns) return c.id;
    return "";
  }

  function handleCanvasDrop(e: React.DragEvent) {
    e.preventDefault();
    const preset = e.dataTransfer.getData("preset-id");
    const moveId = e.dataTransfer.getData("move-node");
    if (preset) {
      const p = SECTION_PRESETS.find((x) => x.id === preset);
      if (!p) return;
      const d = JSON.parse(JSON.stringify(useBuilder.getState().doc));
      d.sections.push(p.build());
      useBuilder.getState().apply(d);
      return;
    }
    if (moveId) moveNode(moveId, firstColumn(doc), "inside");
  }

  function editText(id: string) { setEditingTextId(id); }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950" onContextMenu={(e) => {
      const el = e.target as HTMLElement;
      if (el?.closest("[data-section]")) return;
      if (!el?.tagName) return;
      if (el.tagName === "A" || el.tagName === "IMG" || el.tagName === "BUTTON") return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, id: selectedId ?? "" });
    }}>
      <DesignTokenStyle />
      <Keymap />
      <div
        className={cn("flex-1 overflow-auto thin-scroll p-5 mx-auto", breakpoint === "mobile" ? "w-[390px] max-w-[390px]" : breakpoint === "tablet" ? "max-w-[790px]" : "max-w-none")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleCanvasDrop}
      >
        {doc.sections.length === 0 && (
          <div className="grid grid-cols-2 gap-6 mt-8">
            <button onClick={() => addSection()} className="h-44 border-2 border-dashed border-ink-700 hover:border-blue-500 hover:text-blue-400 rounded-xl flex flex-col items-center justify-center gap-2 text-ink-400 hover:bg-ink-900/40 transition group">
              <span className="text-3xl transition-transform group-hover:scale-110">+</span>
              <span>Add section</span>
            </button>
            <div className="grid grid-cols-2 gap-2">
              {SECTION_PRESETS.slice(0, 6).map((p) => (
                <button key={p.id} draggable
                  onDragStart={(e) => e.dataTransfer.setData("preset-id", p.id)}
                  onClick={() => document.dispatchEvent(new CustomEvent("add-preset", { detail: p.id }))}
                  className="p-3 rounded-lg bg-ink-900 hover:bg-ink-800 border border-ink-700 text-left">
                  <div className="text-sm font-medium">{p.label}</div>
                  <div className="text-xs text-ink-500">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        {doc.sections.map((section, si) => (
          <SectionView
            key={section.id}
            section={section}
            si={si}
            selectedId={selectedId}
            breakpoint={breakpoint}
            select={select}
            editText={editText}
            onContextMenu={(e) => { e.preventDefault(); select(selectedId); setMenu({ x: e.clientX, y: e.clientY, id: selectedId ?? section.id }); }}
            editingTextId={editingTextId}
            setEditingTextId={setEditingTextId}
            onMoveNode={moveNode}
          />
        ))}
        {doc.sections.length > 0 && (
          <button onClick={() => addSection()} className="w-full h-20 my-4 border-2 border-dashed border-ink-700 rounded-xl text-ink-500 hover:border-blue-500 hover:text-blue-400 transition flex items-center justify-center gap-2">
            + Section
          </button>
        )}
      </div>
      {menu && <CtxMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} onDuplicate={() => duplicateSelected()} onDelete={() => removeSelected()} selectedId={selectedId} />}
    </div>
  );
}

function SectionView({
  section, si, selectedId, breakpoint, select, editText, onContextMenu, onMoveNode, editingTextId, setEditingTextId,
}: {
  section: Section; si: number; selectedId: string | null; breakpoint: any;
  select: (id: string | null) => void; editText: (id: string) => void;
  onContextMenu: (e: React.MouseEvent<any>) => void;
  onMoveNode: (id: string, targetId: string, position: any) => void;
  editingTextId: string | null; setEditingTextId: (v: string | null) => void;
}) {
  const { apply, removeSelected } = useBuilder();
  const styles = stylesAt(section.styles, breakpoint);
  const isSel = selectedId === section.id;
  return (
    <section
      data-section
      onContextMenu={(e) => {
        e.stopPropagation();
        onContextMenu(e);
      }}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).tagName === "A" || (e.target as HTMLElement).closest("a")) return;
        e.stopPropagation();
        select(section.id);
      }}
      className={cn("relative my-2 border rounded overflow-hidden transition", isSel ? "border-blue-500 ring-1 ring-blue-400" : "border-transparent hover:border-ink-600")}
      style={toSafe(styles, ["backgroundColor", "backgroundImage", "backgroundOverlay", "padding"])}
    >
      <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 rounded bg-ink-800 text-ink-400 pointer-events-none select-none hidden group-hover:block">
        {section.name} · #{si + 1}
      </span>
      <div
        className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        <button className="w-6 h-6 rounded bg-ink-900/80 border border-ink-700 text-[10px]" title="Move up" onClick={() => onMoveNode(section.id, section.id, "before")}>↑</button>
        <button className="w-6 h-6 rounded bg-ink-900/80 border border-ink-700 text-[10px]" title="Move down" onClick={() => onMoveNode(section.id, section.id, "after")}>↓</button>
        <button className="w-6 h-6 rounded bg-red-900/80 border border-red-700 text-[10px]" title="Delete" onClick={() => removeSelected()}>✕</button>
      </div>
      {section.rows.map((row) => (
        <RowView key={row.id} row={row} breakpoint={breakpoint} selectedId={selectedId} select={select} editText={editText} onContextMenu={onContextMenu} editingTextId={editingTextId} setEditingTextId={setEditingTextId} sectionId={section.id} onMoveNode={onMoveNode} />
      ))}
    </section>
  );
}

function RowView({ row, breakpoint, selectedId, select, editText, onContextMenu, editingTextId, setEditingTextId, sectionId, onMoveNode }: any) {
  const { apply } = useBuilder();
  const styles = stylesAt(row.styles, breakpoint);
  return (
    <div
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        e.stopPropagation();
        select(row.id);
      }}
      onContextMenu={onContextMenu}
      className="flex gap-3 px-3 relative group/row"
      style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch", ...toSafe(styles, ["padding"]) }}
    >
      {row.columns.map((col: any) => (
        <ColumnView
          key={col.id}
          col={col}
          breakpoint={breakpoint}
          selectedId={selectedId}
          select={select}
          onContextMenu={onContextMenu}
          editingTextId={editingTextId}
          setEditingTextId={setEditingTextId}
          editText={editText}
          rowStyles={styles}
        />
      ))}
    </div>
  );
}

function ColumnView({ col, breakpoint, selectedId, select, onContextMenu, editingTextId, setEditingTextId, editText, rowStyles }: any) {
  const { doc, moveNode, removeSelected, duplicateSelected } = useBuilder();
  const styles = stylesAt(col.styles, breakpoint);
  const isSel = selectedId === col.id;
  return (
    <div
      onMouseDown={(e) => {
        e.stopPropagation();
        select(col.id);
      }}
      onContextMenu={onContextMenu}
      className={cn("flex-grow transition-all relative py-2 px-2 rounded", isSel ? "outline outline-2 outline-dashed outline-blue-400 ring-2 ring-blue-500" : "hover:outline-blue-200 hover:outline-dashed")}
      style={{ width: col.widthPercent + "%", ...toSafe(styles, ["padding", "display"]) }}
    >
      {col.blocks.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="text-ink-600 text-xs bg-ink-900/70 border border-dashed border-ink-700 rounded px-2 py-0.5">Drop blocks or presets here</span>
        </div>
      )}
      {col.blocks.map((block: Block) => (
        <BlockViewWrap
          key={block.id}
          block={block}
          breakpoint={breakpoint}
          selectedId={selectedId}
          onContextMenu={onContextMenu}
          editText={editText}
          editing={editingTextId === block.id}
          setEditingTextId={setEditingTextId}
          moveNode={moveNode}
          select={select}
        />
      ))}
    </div>
  );
}

function BlockViewWrap({
  block, breakpoint, selectedId, onContextMenu, editText, editing, setEditingTextId, moveNode, select,
}: {
  block: Block; breakpoint: any; selectedId: string | null;
  onContextMenu: (e: React.MouseEvent<any>) => void;
  editText: (id: string) => void;
  editing: boolean; setEditingTextId: (v: string | null) => void;
  moveNode: (id: string, targetId: string, position: any) => void;
  select: (id: string) => void;
}) {
  const styles = stylesAt(block.styles, breakpoint);
  const isSel = selectedId === block.id;
  const [editingText, setEditingText] = useState("");

  // Sync with props on enter edit mode
  useEffect(() => {
    if (editing) setEditingText((block.props as any)?.text ?? (block.props as any)?.html ?? "");
  }, [editing]);

  function commitText() {
    const p = (block.props as any) ?? {};
    const patch = "html" in p ? { html: editingText } : ("text" in p ? { text: editingText } : {});
    useBuilder.getState().updateSelectedProps(patch);
    setEditingTextId(null);
  }

  return (
    <div
      data-block-id={block.id}
      onMouseDown={(e) => {
        if (editing) return;
        e.stopPropagation(); select(block.id);
      }}
      onContextMenu={(e) => { e.stopPropagation(); onContextMenu(e); }}
      onDoubleClick={(e) => { if (block.type === "heading" || block.type === "text") { e.preventDefault(); e.stopPropagation(); editText(block.id); } }}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("move-node", block.id); e.dataTransfer.effectAllowed = "move"; }}
      className={cn("relative leading-inherit rounded transition-shadow p-1 -mx-1 -my-1", isSel ? "ring-2 ring-blue-500 shadow-sm" : "hover:ring-1 hover:ring-blue-300", editing && "bg-ink-900/60 border-l-3 border-blue-500")}
    >
      {!editing ? (
        <BlockView block={block} styles={styles} />
      ) : (
        <textarea
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingTextId(null);
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commitText();
          }}
          autoFocus
          className="w-full bg-transparent border-0 outline-none resize-none p-1 text-inherit"
          style={{ minHeight: 48, color: "inherit", background: "transparent" }}
        />
      )}
      {isSel && (
        <span className="absolute -top-5 left-0 bg-blue-600 text-white px-1.5 py-0.5 rounded text-[9px] pointer-events-none">{block.type}</span>
      )}
      {editing && (
        <span className="absolute -bottom-5 left-0 text-[9px] text-blue-400 bg-inherit px-1">Ctrl+Enter = save · Esc = cancel</span>
      )}
    </div>
  );
}

function toSafe(styles: any, keys: string[] = []) {
  if (!styles) return {};
  const out: any = {};
  for (const [k, v] of Object.entries(styles)) {
    if (k === "tablet" || k === "mobile") continue;
    if (keys.includes("*") || keys.includes(k)) out[k] = v;
  }
  return out;
}

function CtxMenu({ x, y, onClose, onDuplicate, onDelete, selectedId }: { x: number; y: number; onClose: () => void; onDuplicate: () => void; onDelete: () => void; selectedId: string | null }) {
  return (
    <div style={{ position: "fixed", left: x, top: y, zIndex: 50 }} className="w-48">
      <div className="bg-ink-900 border border-ink-700 rounded-lg shadow-2xl overflow-hidden">
        <button className="block w-full text-left px-4 py-2 text-sm text-ink-200 hover:bg-ink-800" onClick={() => { onClose(); onDuplicate(); }}>Duplicate</button>
        <button className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-ink-800" onClick={() => { onClose(); onDelete(); }}>Delete</button>
      </div>
    </div>
  );
}