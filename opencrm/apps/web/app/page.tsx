import { Logo } from "@/components/Logo";
import { Sparkles, Globe, History, MousePointerClick, Smartphone, Paintbrush, ArrowRight, Check } from "lucide-react";

const FEATURES = [
  { icon: Sparkles, title: "Describe it, get a website", text: "“Plumbing site for Springfield” becomes a full multi-section page — hero, services, reviews, booking form — in seconds." },
  { icon: Globe, title: "Import any URL", text: "Paste a link to a site you like. We read it and rebuild it as original, editable blocks." },
  { icon: Paintbrush, title: "152 design systems", text: "One click swaps the entire look — typography, palette and rhythm stay professionally coherent." },
  { icon: History, title: "Version history", text: "Every save snapshots. Preview any version and restore it without ever losing work." },
  { icon: MousePointerClick, title: "Forms that feed your CRM", text: "Published forms create contacts automatically — with spam guard built in." },
  { icon: Smartphone, title: "Perfect on phones", text: "Tablet and mobile styles with automatic stacking. What you ship looks designed everywhere." },
];

const STEPS = [
  { n: "01", title: "Add your AI key", text: "NVIDIA, OpenAI, DeepSeek, Anthropic or local Ollama. Encrypted, yours, unlimited." },
  { n: "02", title: "Describe or import", text: "A sentence about the business — or a URL to rebuild in your own voice." },
  { n: "03", title: "Refine & publish", text: "Edit inline, check history, publish a live link. Forms pour contacts into your CRM." },
];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#06060b] text-white antialiased">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-64 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-brand/20 blur-[130px]" />
        <div className="absolute bottom-0 right-0 h-96 w-96 rounded-full bg-brand-deep/20 blur-[100px]" />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_70%_55%_at_50%_35%,black,transparent)]" />
      </div>

      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm text-zinc-400 md:flex">
            <a href="#features" className="transition hover:text-white">Features</a>
            <a href="#how" className="transition hover:text-white">How it works</a>
            <a href="/login" className="transition hover:text-white">Sign in</a>
          </nav>
          <div className="flex items-center gap-3">
            <a href="/login" className="text-sm text-zinc-400 transition hover:text-white">Sign in</a>
            <a href="/signup" className="rounded-lg bg-gradient-to-r from-brand-deep to-brand px-4 py-2 text-sm font-medium text-white shadow-lg shadow-brand/25 transition hover:shadow-brand/40">
              Start building
            </a>
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center px-6 pb-16 pt-28">
        <div className="mb-6 inline-flex animate-in items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-zinc-300 backdrop-blur-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          152 design systems · 114 templates · yours to command
        </div>
        <h1 className="mx-auto max-w-4xl text-center font-display text-5xl font-bold leading-[1.02] tracking-tight md:text-7xl">
          <span className="block">Your AI website builder that</span>
          <span className="bg-gradient-to-r from-brand-hover via-[#b39dff] to-[#e0aaff] bg-clip-text text-transparent">
            actually designs
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-center text-lg leading-relaxed text-zinc-400">
          Pick a design system, describe your goal — or paste a URL — and get a polished,
          responsive, multi-section page. Edit inline, publish live, capture contacts.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <a href="/signup" className="group inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-white px-8 font-semibold text-black transition-all hover:scale-[1.02] hover:shadow-[0_20px_60px_-15px_rgba(124,108,255,0.6)]">
            Create your first page — free
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a href="/login" className="inline-flex h-14 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-8 font-medium text-white transition-colors hover:bg-white/10">
            Sign in
          </a>
        </div>
        <div className="mt-14 grid w-full max-w-3xl grid-cols-3 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
          {[
            { value: "152", label: "curated design systems" },
            { value: "114", label: "ready-made templates" },
            { value: "100%", label: "your keys, your data" },
          ].map((s) => (
            <div key={s.label} className="p-6 text-center">
              <div className="font-display text-3xl font-bold">{s.value}</div>
              <div className="mt-1 text-xs text-zinc-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center font-display text-3xl font-bold tracking-tight md:text-4xl">Everything a real site needs</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-zinc-400">Not a demo generator — a complete loop from idea to published page to paying contact.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm transition hover:border-brand/40 hover:bg-white/[0.07]">
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-deep text-white shadow-lg shadow-brand/25">
                <f.icon size={18} />
              </div>
              <div className="font-semibold">{f.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="relative z-10 mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center font-display text-3xl font-bold tracking-tight md:text-4xl">Live in three steps</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-white/10 bg-white/5 p-6">
              <div className="font-display text-sm font-bold tracking-widest text-brand-hover">{s.n}</div>
              <div className="mt-2 font-semibold">{s.title}</div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 rounded-2xl border border-brand/25 bg-brand/10 p-6">
          <ul className="grid gap-2 text-sm text-zinc-200 sm:grid-cols-2">
            {["No templates to wrestle", "No per-seat pricing", "Your API keys stay yours", "Export-quality responsive output"].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check size={15} className="text-emerald-400" /> {t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="font-display text-4xl font-bold tracking-tight">Your next customer is one<br />page away.</h2>
        <a href="/signup" className="mt-8 inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-deep to-brand px-10 font-semibold text-white shadow-xl shadow-brand/30 transition hover:scale-[1.02]">
          Start building free <ArrowRight size={16} />
        </a>
      </section>

      <footer className="relative z-10 border-t border-white/10 py-8 text-center text-xs text-zinc-600">
        OpenCRM — local-first, bring-your-own-key, unlimited creative freedom.
      </footer>
    </main>
  );
}
