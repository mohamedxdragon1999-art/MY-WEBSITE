"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Toolbar } from "@/components/builder/Toolbar";
import { BlockPalette } from "@/components/builder/BlockPalette";
import { Canvas } from "@/components/builder/Canvas";
import { Inspector } from "@/components/builder/Inspector";
import { AiModal } from "@/components/builder/AiModal";
import { TemplatesModal } from "@/components/builder/TemplatesModal";
import { VersionsPanel } from "@/components/builder/VersionsPanel";
import { HtmlMode } from "@/components/builder/HtmlMode";
import { Keymap } from "@/components/builder/Keymap";
import { useBuilder } from "@/components/builder/store";
import { api } from "@/lib/api";
import type { PageDocument } from "@opencrm/shared";

function BuilderInner() {
  const params = useSearchParams();
  const pageId = params.get("page");
  const { load } = useBuilder();
  const [ready, setReady] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!pageId) {
      setReady(true);
      return;
    }
    api(`/funnels/page/${pageId}`).then((p: any) => {
      const doc = p.document as PageDocument;
      if (doc && typeof doc === "object" && Array.isArray(doc.sections)) {
        load(doc);
      } else {
        // corrrupt/empty doc — initialize cleanly
        load({ version: 2, theme: doc?.theme ?? {}, sections: [], mode: "structured" } as PageDocument);
      }
      setReady(true);
    }).catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // wire save: "builder-save" event from Ctrl/Cmd+S or the save button
  useEffect(() => {
    function onSave() {
      const doc = useBuilder.getState().doc;
      if (!pageId) return;
      saveRef.current = async () => {
        await api(`/funnels/page/${pageId}/document`, { method: "PATCH", body: JSON.stringify({ document: doc }) });
        useBuilder.getState().markSaved();
      };
      saveRef.current().catch(() => {});
    }
    document.addEventListener("builder-save", onSave);
    return () => document.removeEventListener("builder-save", onSave);
  }, [pageId]);

  const isHtmlMode = useBuilder((s) => s.doc.mode === "html");

  if (!ready) return <div className="min-h-screen grid place-items-center text-ink-400">Loading…</div>;

  return (
    <div className="flex flex-col h-screen bg-ink-950">
      <Keymap />
      <Toolbar pageId={pageId} onOpenAi={() => setAiOpen(true)} onOpenTemplates={() => setTplOpen(true)} onOpenHistory={() => setHistOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        {!isHtmlMode && <BlockPalette />}
        {isHtmlMode ? <HtmlMode /> : <Canvas />}
        {!isHtmlMode && <Inspector />}
      </div>
      <AiModal open={aiOpen} onClose={() => setAiOpen(false)} />
      <TemplatesModal open={tplOpen} onClose={() => setTplOpen(false)} />
      <VersionsPanel pageId={pageId} open={histOpen} onClose={() => setHistOpen(false)} />
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<div className="h-screen grid place-items-center text-ink-400">Loading…</div>}>
      <BuilderInner />
    </Suspense>
  );
}