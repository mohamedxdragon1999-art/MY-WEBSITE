"use client";
import { useEffect, useState } from "react";
import { Loader2, Plug, Save, RefreshCw, KeyRound, Gauge, UserRound } from "lucide-react";
import { api } from "@/lib/api";

const PROVIDERS = [
  { id: "nvidia", label: "NVIDIA NIM", defaultBase: "https://integrate.api.nvidia.com/v1", defaultModel: "meta/llama-3.3-70b-instruct" },
  { id: "openai", label: "OpenAI", defaultBase: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { id: "deepseek", label: "DeepSeek", defaultBase: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  { id: "anthropic", label: "Anthropic", defaultBase: "https://api.anthropic.com", defaultModel: "claude-3-5-sonnet-20241022" },
  { id: "custom", label: "Any OpenAI-compatible (local/Ollama/vLLM)", defaultBase: "http://localhost:11434/v1", defaultModel: "" },
];

const HEALTH_DOT: Record<string, string> = { healthy: "bg-emerald-400", warning: "bg-amber-400", error: "bg-red-400" };

export default function SettingsPage() {
  const [provider, setProvider] = useState("nvidia");
  const [baseUrl, setBaseUrl] = useState(PROVIDERS[0].defaultBase);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(PROVIDERS[0].defaultModel);
  const [models, setModels] = useState<string[]>([]);
  const [saved, setSaved] = useState<Record<string, any>>({});
  const [keys, setKeys] = useState<any[]>([]);
  const [usage, setUsage] = useState<{ used: number; cap: number; remaining: number } | null>(null);
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  useEffect(() => {
    api<any[]>("/ai/config").then((rows) => {
      const map: Record<string, any> = {};
      rows.forEach((r) => { map[r.provider] = r; });
      setSaved(map);
      if (map.nvidia) {
        setBaseUrl(map.nvidia.baseURL || PROVIDERS[0].defaultBase);
        setModel(map.nvidia.model || PROVIDERS[0].defaultModel);
        setApiKey(map.nvidia.hasKey ? "•••••••• (saved)" : "");
      }
    }).catch(() => {});
    api<{ email: string }>("/auth/me").then((m) => setEmail(m.email)).catch(() => {});
    api<any>("/ai/usage").then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    api<any[]>(`/ai/config/keys/${provider}`).then(setKeys).catch(() => setKeys([]));
  }, [provider, saved]);

  function pickProvider(p: (typeof PROVIDERS)[number]) {
    setProvider(p.id);
    setBaseUrl(p.defaultBase);
    setModel(p.defaultModel);
    if (saved[p.id]?.hasKey) setApiKey("•••••••• (saved)");
    else setApiKey("");
    setModels([]);
  }

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const key = apiKey.includes("(saved)") || apiKey.includes("••") ? undefined : apiKey;
      await api("/ai/config", { method: "POST", body: JSON.stringify({ provider, baseUrl, apiKey: key, model }) });
      setMsg("Saved. Your key is encrypted and never shown again.");
      const rows = await api<any[]>("/ai/config");
      const map: Record<string, any> = {};
      rows.forEach((r) => { map[r.provider] = r; });
      setSaved(map);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function listModels() {
    setBusy(true); setErr(null);
    try {
      const r = await api<any>("/ai/models", { method: "POST", body: JSON.stringify({ provider, baseUrl, apiKey: apiKey.includes("••") ? undefined : apiKey }) });
      setModels(r.models ?? r.data ?? []);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function test() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api<any>("/ai/test", { method: "POST", body: JSON.stringify({ provider, baseUrl, apiKey: apiKey.includes("••") ? undefined : apiKey, model }) });
      setMsg(`Connected — ${r.model} replied: "${r.reply}"`);
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null); setPwErr(null);
    try {
      await api("/auth/change-password", { method: "POST", body: JSON.stringify(pw) });
      setPw({ currentPassword: "", newPassword: "" });
      setPwMsg("Password changed.");
    } catch (e: any) { setPwErr(e.message); }
  }

  return (
    <div className="page max-w-3xl">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub mb-6">AI providers, usage, and your account.</p>

      <section className="oc-card mb-4">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><KeyRound size={16} className="text-brand-hover" /> AI Model &amp; Provider</h2>
        <p className="mb-4 text-sm text-ink-400">Bring your own key — encrypted at rest, unlimited use within your daily cap.</p>
        <span className="lbl">Provider</span>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {PROVIDERS.map((p) => (
            <button key={p.id} onClick={() => pickProvider(p)}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${provider === p.id ? "border-brand bg-brand/10" : "border-ink-700 bg-ink-800 hover:border-ink-600"}`}>
              <span className="flex items-center gap-2 font-medium">
                {saved[p.id]?.hasKey && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="Key saved" />}
                {p.label}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="lbl">Base URL (auto-adds /v1)</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="field font-mono text-[13px]" placeholder="https://integrate.api.nvidia.com/v1" />
          </label>
          <label className="block">
            <span className="lbl">API key</span>
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" className="field font-mono text-[13px]" placeholder="nvapi-… or sk-…" autoComplete="off" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="lbl">Model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="field font-mono text-[13px]" placeholder="model id" />
            </label>
            <div className="flex items-end">
              <button onClick={listModels} disabled={busy} className="oc-btn oc-btn-secondary w-full text-sm">
                <RefreshCw size={13} /> List models
              </button>
            </div>
          </div>
          {models.length > 0 && (
            <div className="thin-scroll max-h-40 overflow-y-auto rounded-xl border border-ink-700 bg-ink-800 p-2">
              {models.slice(0, 50).map((m) => (
                <button key={m} onClick={() => setModel(m)} className="block w-full rounded-lg px-2 py-1 text-left font-mono text-xs text-ink-300 hover:bg-ink-700 hover:text-white">
                  {m}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={busy} className="oc-btn oc-btn-primary text-sm"><Save size={14} /> Save</button>
            <button onClick={test} disabled={busy} className="oc-btn oc-btn-secondary text-sm">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />} Test connection
            </button>
          </div>
          {msg && <p className="text-sm text-emerald-400">{msg}</p>}
          {err && <p className="text-sm text-red-400">{err}</p>}
        </div>
      </section>

      {keys.length > 0 && (
        <section className="oc-card mb-4">
          <h2 className="mb-3 font-semibold">Key health <span className="font-normal text-ink-400">— {provider}</span></h2>
          <ul className="space-y-2">
            {keys.map((k, i) => (
              <li key={i} className="flex items-center gap-3 rounded-xl bg-ink-800 px-3 py-2.5 text-sm">
                <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[k.health] ?? "bg-ink-500"}`} title={k.health} />
                <span className="font-medium">{k.label}</span>
                <span className="font-mono text-xs text-ink-400">{k.key}</span>
                {k.lastError && <span className="truncate text-xs text-red-300/80" title={k.lastError}>{k.lastError}</span>}
                <span className="ml-auto text-xs capitalize text-ink-400">{k.health}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="oc-card mb-4">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><Gauge size={16} className="text-brand-hover" /> Usage today</h2>
        <p className="mb-3 text-sm text-ink-400">{usage ? `${usage.used} of ${usage.cap} AI calls used` : "Loading…"}</p>
        <div className="meter"><div style={{ width: `${usage ? Math.min(100, (usage.used / usage.cap) * 100) : 0}%` }} /></div>
      </section>

      <section className="oc-card">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><UserRound size={16} className="text-brand-hover" /> Account</h2>
        <p className="mb-4 text-sm text-ink-400">{email || "Loading…"}</p>
        <form onSubmit={changePassword} className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="lbl">Current password</span>
            <input type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className="field" required />
          </label>
          <label className="block">
            <span className="lbl">New password (8+ chars)</span>
            <input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className="field" required minLength={8} />
          </label>
          <div className="col-span-2">
            <button className="oc-btn oc-btn-secondary text-sm">Change password</button>
          </div>
        </form>
        {pwMsg && <p className="mt-3 text-sm text-emerald-400">{pwMsg}</p>}
        {pwErr && <p className="mt-3 text-sm text-red-400">{pwErr}</p>}
      </section>
    </div>
  );
}
