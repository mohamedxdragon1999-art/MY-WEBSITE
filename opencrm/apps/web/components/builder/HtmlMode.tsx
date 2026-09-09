"use client";
import { useEffect, useState } from "react";
import { Code2, Eye, RefreshCw } from "lucide-react";
import { useBuilder } from "./store";
import { cn } from "@/lib/utils";

export function HtmlMode() {
  const { doc, setRawHtml } = useBuilder();
  const [value, setValue] = useState(doc.rawHtml ?? "");
  const [tab, setTab] = useState<"code" | "preview">("preview");
  const [dirty, setDirty] = useState(false);

  useEffect(() => { setValue(doc.rawHtml ?? ""); setDirty(false); }, [doc.rawHtml, doc.rawHtml]);

  function commit() {
    setRawHtml(value);
    setDirty(false);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-ink-800 bg-ink-900">
        <button onClick={() => setTab("preview")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded text-sm", tab === "preview" ? "bg-blue-600" : "bg-ink-800 hover:bg-ink-700")}>
          <Eye size={14} /> Preview
        </button>
        <button onClick={() => setTab("code")} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded text-sm", tab === "code" ? "bg-blue-600" : "bg-ink-800 hover:bg-ink-700")}>
          <Code2 size={14} /> Code
        </button>
        {dirty && (
          <button onClick={commit} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm bg-emerald-600 hover:bg-emerald-500">
            <RefreshCw size={14} /> Apply changes
          </button>
        )}
      </div>
      {tab === "preview" ? (
        <iframe title="HTML preview" srcDoc={doc.rawHtml ?? value} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" className="flex-1 w-full border-0 bg-white" />
      ) : (
        <textarea value={value} onChange={(e) => { setValue(e.target.value); setDirty(true); }} spellCheck={false}
          className="flex-1 w-full bg-ink-950 text-ink-200 font-mono text-xs p-4 resize-none outline-none thin-scroll" />
      )}
    </div>
  );
}