"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Users, Globe, Sparkles, ArrowRight, ArrowUpRight, FileClock } from "lucide-react";

export default function DashboardHome() {
  const [funnels, setFunnels] = useState<any[]>([]);
  const [contactsTotal, setContactsTotal] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number; remaining: number } | null>(null);

  useEffect(() => {
    api<any>("/funnels").then((f) => setFunnels(Array.isArray(f) ? f : f.items ?? [])).catch(() => {});
    api<{ total: number }>("/contacts?envelope=1").then((r) => setContactsTotal(r.total)).catch(() => {});
    api<any>("/ai/usage").then(setUsage).catch(() => {});
  }, []);

  const totalPages = funnels.reduce((a, f) => a + (f.pages?.length ?? 0), 0);
  const recent = [...funnels].sort((a, b) => +new Date(b.updatedAt ?? 0) - +new Date(a.updatedAt ?? 0)).slice(0, 5);

  const stats = [
    { label: "Contacts", value: contactsTotal ?? "—", icon: Users, href: "/dashboard/contacts" },
    { label: "Funnels", value: funnels.length, icon: Globe, href: "/dashboard/sites" },
    { label: "Pages", value: totalPages, icon: FileClock, href: "/dashboard/sites" },
    { label: "AI calls left", value: usage ? usage.remaining : "—", icon: Sparkles, href: "/dashboard/settings" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Good to see you</h1>
          <p className="page-sub">Everything across your sites, contacts and AI in one glance.</p>
        </div>
        <Link href="/dashboard/sites" className="oc-btn oc-btn-primary">+ New funnel</Link>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="oc-card lift group p-5">
            <div className="tile tile-brand mb-4"><s.icon size={18} /></div>
            <div className="text-3xl font-bold tracking-tight">{s.value}</div>
            <div className="mt-1 flex items-center gap-1 text-sm text-ink-400">
              {s.label}
              <ArrowUpRight size={13} className="opacity-0 transition group-hover:opacity-100" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="oc-card xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Recent funnels</h2>
            <Link href="/dashboard/sites" className="flex items-center gap-1 text-sm text-brand-hover hover:text-white">
              View all <ArrowRight size={14} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="empty">
              No funnels yet. Create one, or describe a business to the AI and watch it build.
              <div className="mt-4"><Link href="/dashboard/sites" className="oc-btn oc-btn-secondary text-sm">Go to Sites &amp; Funnels</Link></div>
            </div>
          ) : (
            <ul className="space-y-2">
              {recent.map((f) => (
                <li key={f.id}>
                  <Link href={`/dashboard/sites/builder?page=${f.pages?.[0]?.id ?? ""}`}
                    className="flex items-center justify-between rounded-xl border border-transparent bg-ink-800/60 p-3 transition hover:border-ink-700 hover:bg-ink-800">
                    <div>
                      <div className="font-medium">{f.name}</div>
                      <div className="text-xs text-ink-400">{f.path} · {f.pages?.length ?? 0} page(s)</div>
                    </div>
                    <span className="text-sm text-brand-hover">Open builder →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <div className="oc-card oc-card-elevated">
            <h2 className="mb-1 font-semibold">AI usage today</h2>
            <p className="mb-3 text-sm text-ink-400">{usage ? `${usage.used} of ${usage.cap} calls used` : "Loading…"}</p>
            <div className="meter"><div style={{ width: `${usage ? Math.min(100, (usage.used / usage.cap) * 100) : 0}%` }} /></div>
            <Link href="/dashboard/settings" className="mt-3 inline-block text-sm text-brand-hover hover:text-white">Manage provider keys →</Link>
          </div>
          <div className="oc-card">
            <h2 className="mb-3 font-semibold">Build something</h2>
            <div className="space-y-2 text-sm">
              <Link href="/dashboard/sites" className="block rounded-lg bg-ink-800 p-3 transition hover:bg-ink-700">
                <span className="font-medium">Describe a website</span>
                <span className="block text-xs text-ink-400">“Plumbing site for Springfield” → full page</span>
              </Link>
              <Link href="/dashboard/sites" className="block rounded-lg bg-ink-800 p-3 transition hover:bg-ink-700">
                <span className="font-medium">Import a URL</span>
                <span className="block text-xs text-ink-400">Rebuild any public site as editable blocks</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
