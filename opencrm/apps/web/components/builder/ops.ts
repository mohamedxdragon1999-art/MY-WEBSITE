import type { PageDocument, Section, Row, Column, Block, BlockStyles } from "@opencrm/shared";
import { newId } from "@opencrm/shared";

/** Immutable operations on a PageDocument. Each returns a NEW document (for undo/redo). */

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

export type NodeKind = "section" | "row" | "column" | "block";
export type NodePath = { section: number; row?: number; column?: number; block?: number };

export function findAddress(doc: PageDocument, id: string): { path: NodePath; kind: NodeKind } | null {
  for (let s = 0; s < doc.sections.length; s++) {
    const sec = doc.sections[s];
    if (sec.id === id) return { path: { section: s }, kind: "section" };
    for (let r = 0; r < sec.rows.length; r++) {
      const row = sec.rows[r];
      if (row.id === id) return { path: { section: s, row: r }, kind: "row" };
      for (let c = 0; c < row.columns.length; c++) {
        const col = row.columns[c];
        if (col.id === id) return { path: { section: s, row: r, column: c }, kind: "column" };
        for (let b = 0; b < col.blocks.length; b++) {
          if (col.blocks[b].id === id) return { path: { section: s, row: r, column: c, block: b }, kind: "block" };
        }
      }
    }
  }
  return null;
}

export function getNode(doc: PageDocument, id: string): Section | Row | Column | Block | null {
  const addr = findAddress(doc, id);
  if (!addr) return null;
  const { section: s, row: r, column: c, block: b } = addr.path;
  const sec = doc.sections[s];
  if (addr.kind === "section") return sec;
  const row = sec.rows[r!];
  if (addr.kind === "row") return row;
  const col = row.columns[c!];
  if (addr.kind === "column") return col;
  return col.blocks[b!];
}

// ─── Add ─────────────────────────────────────────────────────

export function addSection(doc: PageDocument, atIndex?: number): { doc: PageDocument; id: string } {
  const d = clone(doc);
  const section: Section = {
    id: newId("s"), name: "Section",
    styles: { padding: { top: 64, bottom: 64 } },
    fullWidth: false,
    rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks: [] }] }],
  };
  const idx = atIndex ?? d.sections.length;
  d.sections.splice(idx, 0, section);
  return { doc: d, id: section.id };
}

export function addRow(doc: PageDocument, sectionId: string, columns = 1): { doc: PageDocument; id: string } {
  const d = clone(doc);
  const sec = d.sections.find((s) => s.id === sectionId);
  if (!sec) return { doc, id: "" };
  const widths = columns === 1 ? [100] : columns === 2 ? [50, 50] : columns === 3 ? [33.3, 33.3, 33.4] : [25, 25, 25, 25];
  const row: Row = { id: newId("r"), styles: {}, columns: widths.map((w) => ({ id: newId("c"), widthPercent: w, styles: {}, blocks: [] })) };
  sec.rows.push(row);
  return { doc: d, id: row.id };
}

export function addBlock(doc: PageDocument, columnId: string, block: Block, atIndex?: number): { doc: PageDocument } {
  const d = clone(doc);
  const addr = findAddress(d, columnId);
  if (!addr || addr.kind !== "column") return { doc };
  const col = d.sections[addr.path.section].rows[addr.path.row!].columns[addr.path.column!];
  col.blocks.splice(atIndex ?? col.blocks.length, 0, block);
  return { doc: d };
}

// ─── Update ──────────────────────────────────────────────────

export function updateBlockStyles(doc: PageDocument, blockId: string, patch: Partial<BlockStyles>): PageDocument {
  const d = clone(doc);
  const node = getNode(d, blockId) as Block | null;
  if (node && "props" in node) node.styles = { ...node.styles, ...patch };
  return d;
}

export function updateBlockProps(doc: PageDocument, blockId: string, patch: Record<string, unknown>): PageDocument {
  const d = clone(doc);
  const node = getNode(d, blockId) as Block | null;
  if (node && "props" in node) (node as any).props = { ...(node as any).props, ...patch };
  return d;
}

export function updateNode(doc: PageDocument, id: string, patch: Record<string, unknown>): PageDocument {
  const d = clone(doc);
  const node = getNode(d, id) as any;
  if (node) Object.assign(node, patch);
  return d;
}

export function updateNodeStyles(doc: PageDocument, id: string, patch: Partial<BlockStyles>): PageDocument {
  const d = clone(doc);
  const node = getNode(d, id) as any;
  if (node) node.styles = { ...(node.styles ?? {}), ...patch };
  return d;
}

// ─── Move ────────────────────────────────────────────────────

/** Remove a node from wherever it is and return it. */
function extractNode(d: PageDocument, id: string): any {
  const addr = findAddress(d, id);
  if (!addr) return null;
  const { section: s, row: r, column: c, block: b } = addr.path;
  const sec = d.sections[s];
  if (addr.kind === "section") return d.sections.splice(s, 1)[0];
  const row = sec.rows[r!];
  if (addr.kind === "row") return sec.rows.splice(r!, 1)[0];
  const col = row.columns[c!];
  if (addr.kind === "column") return row.columns.splice(c!, 1)[0];
  return col.blocks.splice(b!, 1)[0];
}

/** Move node `id` to before/after `targetId`. */
export function moveNode(doc: PageDocument, id: string, targetId: string, position: "before" | "after" | "inside"): PageDocument {
  if (id === targetId) return doc;
  const d = clone(doc);
  const node = extractNode(d, id);
  if (!node) return doc;
  const addr = findAddress(d, targetId);
  if (!addr) return doc;
  const { section: s, row: r, column: c, block: b } = addr.path;
  const sec = d.sections[s];

  // Sections reorder at root only
  if (node.rows) {
    const idx = position === "before" ? s : s + 1;
    d.sections.splice(idx, 0, node);
    return d;
  }
  if (position === "inside" && addr.kind === "column") {
    // drop block into column
    const col = sec.rows[r!].columns[c!];
    col.blocks.push(node);
    return d;
  }
  // rows inside sections
  if (node.columns && addr.kind === "row") {
    const idx = position === "before" ? r! : r! + 1;
    sec.rows.splice(idx, 0, node);
    return d;
  }
  // blocks: insert relative to target block within its column
  if (node.props !== undefined && addr.kind === "block") {
    const col = sec.rows[r!].columns[c!];
    const idx = position === "before" ? b! : b! + 1;
    col.blocks.splice(idx, 0, node);
    return d;
  }
  if (node.props !== undefined && addr.kind === "column") {
    const col = sec.rows[r!].columns[c!];
    col.blocks.push(node);
    return d;
  }
  return doc;
}

// ─── Remove / duplicate ─────────────────────────────────────

export function removeNode(doc: PageDocument, id: string): PageDocument {
  const d = clone(doc);
  extractNode(d, id);
  return d;
}

export function duplicateNode(doc: PageDocument, id: string): { doc: PageDocument; id: string } {
  const d = clone(doc);
  const addr = findAddress(d, id);
  if (!addr) return { doc, id: "" };
  const d2 = clone(d);
  const addr2 = findAddress(d2, id)!;
  const { section: s, row: r, column: c, block: b } = addr2.path;

  function withNewIds(node: any): any {
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = newId(copy.id.split("_")[0] ?? "n");
    (copy.rows ?? []).forEach(withNewIds);
    (copy.columns ?? []).forEach(withNewIds);
    (copy.blocks ?? []).forEach(withNewIds);
    return copy;
  }

  if (addr2.kind === "section") {
    const copy = withNewIds(d2.sections[s]);
    d2.sections.splice(s + 1, 0, copy);
    return { doc: d2, id: copy.id };
  }
  if (addr2.kind === "row") {
    const sec = d2.sections[s];
    const copy = withNewIds(sec.rows[r!]);
    sec.rows.splice(r! + 1, 0, copy);
    return { doc: d2, id: copy.id };
  }
  if (addr2.kind === "column") {
    const row = d2.sections[s].rows[r!];
    const copy = withNewIds(row.columns[c!]);
    row.columns.splice(c! + 1, 0, copy);
    return { doc: d2, id: copy.id };
  }
  const col = d2.sections[s].rows[r!].columns[c!];
  const copy = withNewIds(col.blocks[b!]);
  col.blocks.splice(b! + 1, 0, copy);
  return { doc: d2, id: copy.id };
}

// ─── Column resize ──────────────────────────────────────────

export function setColumnWidths(doc: PageDocument, columnIds: string[], widths: number[]): PageDocument {
  const d = clone(doc);
  columnIds.forEach((id, i) => {
    const node = getNode(d, id) as Column | null;
    if (node && "blocks" in node && "widthPercent" in node) node.widthPercent = widths[i] ?? node.widthPercent;
  });
  return d;
}
