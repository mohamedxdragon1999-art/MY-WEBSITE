"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Plus, Globe, Copy, Trash2, ExternalLink, Pencil } from "lucide-react";

export default function SitesPage() {
  const [funnels, setFunnels] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function load() {
    try {
      const r = await api<any>("/funnels");
      setFunnels(Array.isArray(r) ? r : r.items ?? []);
    } catch { /* stay empty */ }
  }
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const f = await api<any>("/funnels", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
    setName("");
    router.push(`/dashboard/sites/builder?page=${f.pages[0].id}`);
  }

  async function clone(id: string) {
    setBusyId(id); setError(null);
    try {
      await api(`/funnels/${id}/clone`, { method: "POST" });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusyId(null); }
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(`Delete "${label}" and all its pages? This cannot be undone.`)) return;
    setBusyId(id); setError(null);
    try {
      await api(`/funnels/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sites &amp; Funnels</h1>
          <p className="page-sub">{funnels.length} funnel{funnels.length === 1 ? "" : "s"} · click a card to keep building</p>
        </div>
      </div>

      <form onSubmit={create} className="oc-card mb-6 flex gap-3 p-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Funnel name (e.g. Black Friday 2026)" required maxLength={120} className="field flex-1" />
        <button className="oc-btn oc-btn-primary flex items-center gap-2"><Plus size={16} /> Create</button>
      </form>

      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      {funnels.length === 0 ? (
        <div className="empty">No funnels yet. Name one above — or let the AI build your first page from a sentence.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {funnels.map((f) => (
            <div key={f.id} className="oc-card lift group p-5">
              <div className="mb-4 flex items-start justify-between">
                <div className="tile tile-brand"><Globe size={18} /></div>
                <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => clone(f.id)} disabled={busyId === f.id} title="Clone funnel" className="rounded-lg p-2 text-ink-400 hover:bg-ink-800 hover:text-white"><Copy size={15} /></button>
                  <button onClick={() => remove(f.id, f.name)} disabled={busyId === f.id} title="Delete funnel" className="rounded-lg p-2 text-ink-400 hover:bg-red-500/15 hover:text-red-300"><Trash2 size={15} /></button>
                </div>
              </div>
              <Link href={`/dashboard/sites/builder?page=${f.pages?.[0]?.id ?? ""}`} className="block">
                <div className="truncate font-semibold hover:text-brand-hover">{f.name}</div>
                <div className="mt-1 text-xs text-ink-400">{f.pages?.length ?? 0} page(s) · {f.path}</div>
              </Link>
              <div className="mt-4 flex gap-2 border-t border-ink-800 pt-3 text-[13px]">
                <Link href={`/dashboard/sites/builder?page=${f.pages?.[0]?.id ?? ""}`} className="flex items-center gap-1 text-brand-hover hover:text-white"><Pencil size={13} /> Builder</Link>
                {f.pages?.[0]?.id && (
                  <a href={`/preview/${f.pages[0].id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-ink-300 hover:text-white">
                    <ExternalLink size={13} /> Preview
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
