"use client";
import { create } from "zustand";
import type { PageDocument, BlockStyles, PageTheme } from "@opencrm/shared";
import { createBlock, createEmptyDocument, applySystemToTheme, DESIGN_SYSTEMS, type Block } from "@opencrm/shared";
import * as ops from "./ops";

export type Breakpoint = "desktop" | "tablet" | "mobile";

interface HistoryFrame {
  doc: PageDocument;
  selected: string | null;
}

interface BuilderState {
  doc: PageDocument;
  selectedId: string | null;
  breakpoint: Breakpoint;
  past: HistoryFrame[];
  future: HistoryFrame[];
  dirty: boolean;

  // lifecycle
  load: (doc: PageDocument, markDirty?: boolean) => void;
  markSaved: () => void;

  // selection
  select: (id: string | null) => void;

  // mutations
  apply: (next: PageDocument) => void;
  /** apply with debounced history commit (for continuous inputs like style sliders/text) */
  applyLive: (next: PageDocument) => void;
  addSection: () => void;
  addBlock: (type: Block["type"], columnId: string) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  updateSelectedProps: (patch: Record<string, unknown>) => void;
  updateSelectedStyles: (patch: Partial<BlockStyles>, mode?: "merge" | "replace") => void;
  updateNodeStyles: (id: string, patch: Partial<BlockStyles>, mode?: "merge" | "replace") => void;
  updateTheme: (patch: Partial<PageTheme>) => void;
  applySystem: (systemId: string) => void;
  setMode: (mode: "structured" | "html") => void;
  setRawHtml: (html: string) => void;
  moveNode: (id: string, targetId: string, position: "before" | "after" | "inside") => void;
  setBreakpoint: (bp: Breakpoint) => void;

  // history
  undo: () => void;
  redo: () => void;
  flushLive: () => void;

  // drag helpers
  draggingType: Block["type"] | null;
  setDraggingType: (t: Block["type"] | null) => void;
}

const LIMIT = 100;

export const useBuilder = create<BuilderState>((set, get) => ({
  doc: createEmptyDocument(),
  selectedId: null,
  breakpoint: "desktop",
  past: [],
  future: [],
  dirty: false,
  draggingType: null,

  load: (doc, markDirty) => set({ doc, selectedId: null, past: [], future: [], dirty: markDirty === true }),

  markSaved: () => set({ dirty: false }),

  select: (id) => set({ selectedId: id }),

  apply: (next) => {
    const { doc, selectedId } = get();
    if (next === doc) return;
    const frame = { doc, selected: selectedId };
    const past = [...get().past, frame];
    set({ doc: next, past: past.slice(-LIMIT), future: [], dirty: true });
  },

  applyLive: (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let baseline: { doc: PageDocument; selected: string | null } | null = null;
    const impl = (next: PageDocument) => {
      const { doc, selectedId } = get();
      if (!baseline) baseline = { doc, selected: selectedId };
      set({ doc: next, dirty: true });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (baseline) {
          set((st) => ({ past: [...st.past, baseline!].slice(-LIMIT), future: [] }));
          baseline = null;
        }
      }, 400);
    };
    (impl as any).flush = () => {
      if (timer) clearTimeout(timer);
      if (baseline) {
        set((st) => ({ past: [...st.past, baseline!].slice(-LIMIT), future: [] }));
        baseline = null;
      }
    };
    return impl;
  })(),

  flushLive: () => {
    (get().applyLive as any).flush();
  },

  addSection: () => {
    const { doc } = get();
    const res = ops.addSection(doc);
    get().apply(res.doc);
    set({ selectedId: res.id });
  },

  addBlock: (type, columnId) => {
    const { doc } = get();
    const block = createBlock(type);
    const res = ops.addBlock(doc, columnId, block);
    get().apply(res.doc);
    set({ selectedId: block.id });
  },

  removeSelected: () => {
    const { doc, selectedId } = get();
    if (!selectedId) return;
    const next = ops.removeNode(doc, selectedId);
    get().apply(next);
    set({ selectedId: null });
  },

  duplicateSelected: () => {
    const { doc, selectedId } = get();
    if (!selectedId) return;
    const res = ops.duplicateNode(doc, selectedId);
    get().apply(res.doc);
    set({ selectedId: res.id });
  },

  updateSelectedProps: (patch) => {
    const { doc, selectedId } = get();
    if (!selectedId) return;
    get().applyLive(ops.updateBlockProps(doc, selectedId, patch));
  },

  updateSelectedStyles: (patch, mode = "merge") => get().updateNodeStyles(get().selectedId!, patch, mode),

  updateNodeStyles: (id, patch, mode = "merge") => {
    const { doc, breakpoint } = get();
    if (!id) return;
    // If we're at a non-desktop breakpoint, write into the responsive override
    let effectivePatch = patch;
    if (breakpoint !== "desktop") {
      effectivePatch = { [breakpoint]: patch } as Partial<BlockStyles>;
    }
    const node = ops.getNode(doc, id) as any;
    const current = node?.styles ?? {};
    if (mode === "merge" && breakpoint !== "desktop") {
      const existingOverride = current[breakpoint] ?? {};
      const mergedOverride = { ...existingOverride, ...patch };
      effectivePatch = { [breakpoint]: mergedOverride } as Partial<BlockStyles>;
    }
    get().applyLive(ops.updateNodeStyles(doc, id, effectivePatch));
  },

  updateTheme: (patch) => {
    const { doc } = get();
    const next = JSON.parse(JSON.stringify(doc));
    next.theme = { ...next.theme, ...patch };
    get().apply(next);
  },

  applySystem: (systemId) => {
    const sys = DESIGN_SYSTEMS[systemId];
    if (!sys) return;
    const { doc } = get();
    const next = JSON.parse(JSON.stringify(doc));
    next.theme = applySystemToTheme(next.theme, sys, systemId);
    get().apply(next);
  },

  setMode: (mode) => {
    const { doc } = get();
    const next = JSON.parse(JSON.stringify(doc)) as PageDocument;
    next.mode = mode;
    get().apply(next);
  },

  setRawHtml: (html) => {
    const { doc } = get();
    const next = JSON.parse(JSON.stringify(doc)) as PageDocument;
    next.mode = "html";
    next.rawHtml = html;
    get().apply(next);
  },

  moveNode: (id, targetId, position) => {
    const { doc } = get();
    get().apply(ops.moveNode(doc, id, targetId, position));
  },

  setBreakpoint: (bp) => set({ breakpoint: bp }),

  undo: () => {
    const { doc, selectedId, past, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    const newPast = past.slice(0, -1);
    set({
      doc: prev.doc,
      selectedId: prev.selected,
      past: newPast,
      future: [{ doc, selected: selectedId }, ...future].slice(0, LIMIT),
      dirty: true,
    });
  },

  redo: () => {
    const { doc, selectedId, past, future } = get();
    if (future.length === 0) return;
    const [nextFrame, ...rest] = future;
    set({
      doc: nextFrame.doc,
      selectedId: nextFrame.selected,
      past: [...past, { doc, selected: selectedId }].slice(-LIMIT),
      future: rest,
      dirty: true,
    });
  },

  setDraggingType: (t) => set({ draggingType: t }),
}));

export function stylesAt(styles: BlockStyles | undefined | null, bp: Breakpoint): BlockStyles {
  if (!styles) return {};
  const base = { ...styles };
  const tablet = styles.tablet ?? {};
  const mobile = styles.mobile ?? {};
  let merged: BlockStyles = base;
  if (bp === "tablet") merged = { ...base, ...tablet };
  // Mobile inherits tablet first (real cascade), then its own overrides.
  if (bp === "mobile") merged = { ...base, ...tablet, ...mobile };
  delete (merged as any).tablet;
  delete (merged as any).mobile;
  return merged;
}