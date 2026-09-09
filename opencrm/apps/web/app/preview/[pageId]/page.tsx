"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { PageRenderer } from "@/components/builder/PageRenderer";
import { api } from "@/lib/api";
import type { PageDocument } from "@opencrm/shared";

export default function PreviewPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const [doc, setDoc] = useState<PageDocument | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ document: PageDocument; title?: string; seo?: { description?: string } }>(`/funnels/public-page/${pageId}`)
      .then((r) => {
        setDoc(r.document);
        if (r.title) document.title = r.title;
        const desc = r.seo?.description;
        if (desc) {
          let tag = document.querySelector('meta[name="description"]');
          if (!tag) {
            tag = document.createElement("meta");
            tag.setAttribute("name", "description");
            document.head.appendChild(tag);
          }
          tag.setAttribute("content", desc);
        }
      })
      .catch((e) => setErr(e.message));
  }, [pageId]);

  if (err) return <div className="min-h-screen grid place-items-center text-slate-600">Preview unavailable: {err}</div>;
  if (!doc) return <div className="min-h-screen grid place-items-center text-slate-400">Loading…</div>;
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <PageRenderer doc={doc} pageId={pageId} />
    </div>
  );
}