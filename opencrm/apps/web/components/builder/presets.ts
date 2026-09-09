"use client";
import type { Section } from "@opencrm/shared";
import { createBlock, newId } from "@opencrm/shared";

/** Curated section presets — modern, token-aware, ready to drop into a page. */

function s(name: string, styles: any, rows: { width: number; blocks: any[] }[], opts: { full?: boolean } = {}): Section {
  return {
    id: newId("s"), name, styles, fullWidth: opts.full ?? false,
    rows: [{ id: newId("r"), styles: {}, columns: rows.map((r) => ({ id: newId("c"), widthPercent: r.width, styles: {}, blocks: r.blocks })) }],
  };
}

export const SECTION_PRESETS: { id: string; label: string; description: string; icon: string; build: () => Section }[] = [
  {
    id: "hero-centered", label: "Hero (centered)", description: "Headline + subtitle + 2 CTAs", icon: "Layout",
    build: () => s("Hero", { backgroundColor: "var(--bg, #0f172a)", padding: { top: 96, bottom: 96 } }, [
      { width: 100, blocks: [
        createBlock("heading", { text: "Headline that stops the scroll", level: "h1" }) as any,
        createBlock("text", { html: `<p style="color:var(--muted,#64748b);font-size:18px">Clearer, faster, better — the player you deserve.</p>` }) as any,
        createBlock("button", { text: "Get started free", href: "#", variant: "primary", size: "lg" }) as any,
        createBlock("button", { text: "Watch demo", href: "#", variant: "outline", size: "lg" }) as any,
      ] },
    ], { full: true }),
  },
  {
    id: "logo-cloud", label: "Logo cloud", description: "Trust bar with logos/text", icon: "TrendingUp",
    build: () => s("Logos", { backgroundColor: "var(--surface, #f8fafc)", padding: { top: 48, bottom: 48 } }, [
      { width: 100, blocks: [
        createBlock("heading", { text: "Trusted by teams", level: "h3" }) as any,
        createBlock("logo-cloud", { logos: [
          { src: "https://placehold.co/160x40?text=ACME", alt: "ACME" },
          { src: "https://placehold.co/160x40?text=Globex", alt: "Globex" },
          { src: "https://placehold.co/160x40?text=Wayne", alt: "Wayne" },
          { src: "https://placehold.co/160x40?text=Stark", alt: "Stark" },
        ] }) as any,
      ] },
    ]),
  },
  {
    id: "features-3col", label: "Features (3 cols)", description: "Icon + title + description grid", icon: "Grid",
    build: () => s("Features", { backgroundColor: "var(--bg, #fff)", padding: { top: 64, bottom: 64 } }, [
      { width: 100, blocks: [createBlock("heading", { text: "Why choose us", level: "h2" }) as any] },
      { width: 33.33, blocks: [
        createBlock("icon", { name: "zap", size: 28 }) as any,
        createBlock("heading", { text: "Lightning fast", level: "h3" }) as any,
        createBlock("text", { html: "<p>Ship pages in minutes, not days.</p>" }) as any,
      ] },
      { width: 33.33, blocks: [
        createBlock("icon", { name: "shield", size: 28 }) as any,
        createBlock("heading", { text: "Secure by design", level: "h3" }) as any,
        createBlock("text", { html: "<p>Data encrypted end-to-end.</p>" }) as any,
      ] },
      { width: 33.33, blocks: [
        createBlock("icon", { name: "trend", size: 28 }) as any,
        createBlock("heading", { text: "Scales with you", level: "h3" }) as any,
        createBlock("text", { html: "<p>Growth-ready architecture.</p>" }) as any,
      ] },
    ]),
  },
  {
    id: "stats", label: "Stats bar", description: "Big metrics in a row", icon: "Chart",
    build: () => s("Stats", { backgroundColor: "var(--surface, #f8fafc)", padding: { top: 48, bottom: 48 }, textAlign: "center" }, [
      { width: 25, blocks: [createBlock("heading", { text: "10,000+", level: "h2" }) as any, createBlock("text", { html: "<p>Users</p>" }) as any] },
      { width: 25, blocks: [createBlock("heading", { text: "99.9%", level: "h2" }) as any, createBlock("text", { html: "<p>Uptime</p>" }) as any] },
      { width: 25, blocks: [createBlock("heading", { text: "120+", level: "h2" }) as any, createBlock("text", { html: "<p>Countries</p>" }) as any] },
      { width: 25, blocks: [createBlock("heading", { text: "24/7", level: "h2" }) as any, createBlock("text", { html: "<p>Support</p>" }) as any] },
    ]),
  },
  {
    id: "testimonial", label: "Testimonial", description: "Social proof card", icon: "Quote",
    build: () => s("Testimonial", { backgroundColor: "var(--bg, #fff)", padding: { top: 64, bottom: 64 } }, [
      { width: 100, blocks: [
        createBlock("testimonial", { quote: "Best tool I've used this year.", author: "Jane Doe", role: "CEO, Acme", rating: 5 }) as any,
      ] },
    ]),
  },
  {
    id: "pricing", label: "Pricing", description: "2‑3 tiers with highlight", icon: "Tag",
    build: () => s("Pricing", { backgroundColor: "var(--surface, #f8fafc)", padding: { top: 64, bottom: 64 } }, [
      { width: 100, blocks: [
        createBlock("pricing-table", { tiers: [
          { name: "Starter", price: "$29", period: "/mo", features: ["Unlimited pages", "Basic support"], ctaText: "Start", ctaHref: "#" , highlighted: false},
          { name: "Pro", price: "$79", period: "/mo", features: ["Everything in Starter", "Priority support", "Advanced analytics"], ctaText: "Start", ctaHref: "#", highlighted: true },
          { name: "Enterprise", price: "Custom", period: "", features: ["SSO & audit logs", "Dedicated CSM"], ctaText: "Talk to us", ctaHref: "#", highlighted: false },
        ] }) as any,
      ] },
    ]),
  },
  {
    id: "faq", label: "FAQ", description: "Questions & answers", icon: "HelpCircle",
    build: () => s("FAQ", { backgroundColor: "var(--bg, #fff)", padding: { top: 64, bottom: 64 } }, [
      { width: 100, blocks: [
        createBlock("heading", { text: "Frequently asked questions", level: "h2" }) as any,
        createBlock("faq", { items: [
          { question: "How do I get started?", answer: "Sign up and start building in under 60 seconds." },
          { question: "Can I cancel anytime?", answer: "Yes — no lock-in." },
          { question: "Do you offer support?", answer: "24/7 via chat and email." },
        ] }) as any,
      ] },
    ]),
  },
  {
    id: "cta-banner", label: "CTA banner", description: "Bold call-to-action with button", icon: "Bell",
    build: () => s("CTA", { backgroundColor: "var(--accent, #2563eb)", padding: { top: 64, bottom: 64 }, textAlign: "center" }, [
      { width: 100, blocks: [
        createBlock("heading", { text: "Ready to start?", level: "h2" }) as any,
        createBlock("text", { html: `<p style="color:rgba(255,255,255,0.8)">Join thousands of happy customers.</p>` }) as any,
        createBlock("button", { text: "Get started now", href: "#", variant: "primary", size: "lg" }) as any,
      ] },
    ], { full: true }),
  },
  {
    id: "contact", label: "Contact form", description: "Get started with a form", icon: "Mail",
    build: () => s("Contact", { backgroundColor: "var(--bg, #fff)", padding: { top: 64, bottom: 64 } }, [
      { width: 100, blocks: [
        createBlock("heading", { text: "Let's talk", level: "h2" }) as any,
        createBlock("form", { fields: [
          { name: "name", label: "Name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "message", label: "Message", type: "textarea", required: true },
        ], submitLabel: "Send" }) as any,
      ] },
    ]),
  },
];