"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Search, Trash2, UserPlus } from "lucide-react";

export default function ContactsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ email: "", phone: "", firstName: "", lastName: "" });
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load(query = q) {
    try {
      const r = await api<any>(`/contacts?envelope=1&take=100${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`);
      setItems(r.items ?? r);
      setTotal(r.total ?? (r.items ?? r).length);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(""); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/contacts", { method: "POST", body: JSON.stringify(form) });
      setForm({ email: "", phone: "", firstName: "", lastName: "" });
      await load();
    } catch (e: any) { setError(e.message); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this contact?")) return;
    setBusyId(id);
    try {
      await api(`/contacts/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusyId(null); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-sub">{total} contact{total === 1 ? "" : "s"} · captured by hand or by your published forms</p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value); }} placeholder="Search name, email, phone…"
            className="field w-64 pl-9" />
        </div>
      </div>

      <form onSubmit={add} className="oc-card mb-5 grid grid-cols-2 gap-3 p-4 xl:grid-cols-5">
        <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="field" maxLength={80} />
        <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="field" maxLength={80} />
        <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="field" maxLength={254} />
        <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="field" maxLength={32} />
        <button className="oc-btn oc-btn-primary col-span-2 flex items-center justify-center gap-2 xl:col-span-1"><UserPlus size={15} /> Add</button>
      </form>

      {error && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}

      <div className="oc-card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-800 text-left text-xs uppercase tracking-wider text-ink-400">
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-5 py-3 font-semibold">Email</th>
              <th className="px-5 py-3 font-semibold">Phone</th>
              <th className="px-5 py-3 font-semibold">Source</th>
              <th className="w-12 px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-ink-400">{q ? `Nobody matches "${q}".` : "No contacts yet — add one above or publish a form."}</td></tr>}
            {items.map((c) => (
              <tr key={c.id} className="group border-t border-ink-800/60 transition first:border-t-0 hover:bg-ink-800/40">
                <td className="px-5 py-3 font-medium">{[c.firstName, c.lastName].filter(Boolean).join(" ") || <span className="text-ink-500">Unnamed</span>}</td>
                <td className="px-5 py-3 text-ink-300">{c.email ?? "—"}</td>
                <td className="px-5 py-3 text-ink-300">{c.phone ?? "—"}</td>
                <td className="px-5 py-3 text-xs text-ink-400">{c.source?.startsWith("form:") ? "Website form" : c.source ?? "Manual"}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => remove(c.id)} disabled={busyId === c.id} title="Delete contact"
                    className="rounded-lg p-1.5 text-ink-500 opacity-0 transition hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
