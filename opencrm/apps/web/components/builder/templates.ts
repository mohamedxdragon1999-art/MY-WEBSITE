"use client";
import type { PageDocument } from "@opencrm/shared";
import { createBlock, newId, applySystemToTheme, themeSchema } from "@opencrm/shared";
import { DESIGN_SYSTEMS } from "@opencrm/shared";

/** Curated starter templates. `doc` is a full editable PageDocument. */

function section(name: string, styles: any, blocks: any[], fullWidth = false) {
  return {
    id: newId("s"), name, styles, fullWidth,
    rows: [{ id: newId("r"), styles: {}, columns: [{ id: newId("c"), widthPercent: 100, styles: {}, blocks }] }],
  };
}

function themed(sysId: string) {
  const doc: PageDocument = { version: 2, theme: themeSchema.parse({}), sections: [], mode: "structured" };
  doc.theme = applySystemToTheme(doc.theme, DESIGN_SYSTEMS[sysId], sysId);
  return doc;
}

export const TEMPLATES: { name: string; description: string; doc: PageDocument }[] = [
  {
    name: "SaaS Landing (Stripe)",
    description: "Hero + 3 features + pricing + CTA",
    doc: (() => {
      const d = themed("stripe");
      const c = d.theme.colors;
      d.sections = [
        section("Hero", { backgroundColor: "#061b31", padding: { top: 96, bottom: 96 } }, [
          createBlock("heading", { text: "Payments infrastructure for the internet", level: "h1" }) as any,
          createBlock("text", { html: `<p style="color:#c5d4e8;font-size:18px;text-align:center;max-width:56ch;margin:0 auto">Millions of companies accept payments, send payouts, and manage their businesses online.</p>` }) as any,
          createBlock("button", { text: "Start now", href: "#", variant: "primary", size: "lg" }) as any,
        ], true),
        section("Features", { backgroundColor: c.background, padding: { top: 80, bottom: 80 } }, [
          createBlock("heading", { text: "Modular, fully composable", level: "h2" }) as any,
          createBlock("pricing-table", { tiers: [
            { name: "Standard", price: "2.9% + 30¢", period: "/txn", features: ["All major cards", "No setup fees", "24/7 support"], ctaText: "Start", ctaHref: "#", highlighted: false },
            { name: "Pro", price: "Custom", period: "", features: ["Volume pricing", "Advanced fraud tools", "Dedicated success manager"], ctaText: "Contact sales", ctaHref: "#", highlighted: true },
          ] }) as any,
        ]),
      ];
      return d;
    })(),
  },
  {
    name: "Minimal Product Page",
    description: "Clean hero + features + form",
    doc: (() => {
      const d = themed("minimal");
      const c = d.theme.colors;
      d.sections = [
        section("Hero", { backgroundColor: c.background, padding: { top: 112, bottom: 112 } }, [
          createBlock("heading", { text: "A calmer way to build", level: "h1" }) as any,
          createBlock("text", { html: `<p style="color:${c.textMuted};font-size:18px">Less noise. More signal. Everything you need, nothing you don't.</p>` }) as any,
          createBlock("button", { text: "Try it free", href: "#", variant: "primary", size: "lg" }) as any,
        ]),
        section("Features", { backgroundColor: c.surface, padding: { top: 72, bottom: 72 } }, [
          createBlock("heading", { text: "Designed to disappear", level: "h2" }) as any,
          createBlock("text", { html: "<p>Three focused capabilities, done well.</p>" }) as any,
        ]),
        section("CTA", { backgroundColor: c.background, padding: { top: 72, bottom: 72 } }, [
          createBlock("heading", { text: "Start in seconds", level: "h2" }) as any,
          createBlock("form", { fields: [
            { name: "email", label: "Email", type: "email", required: true },
          ], submitLabel: "Get access" }) as any,
        ]),
      ];
      return d;
    })(),
  },
  {
    name: "Luxury Waitlist",
    description: "Serif display + waitlist form",
    doc: (() => {
      const d = themed("luxury");
      const c = d.theme.colors;
      d.sections = [
        section("Coming soon", { backgroundColor: c.background, padding: { top: 128, bottom: 128 } }, [
          createBlock("heading", { text: "Something exceptional is coming", level: "h1" }) as any,
          createBlock("countdown", { targetDate: new Date(Date.now() + 86400000 * 21).toISOString(), expiredText: "Available now" }) as any,
          createBlock("form", { fields: [{ name: "email", label: "Email", type: "email", required: true }], submitLabel: "Request invite" }) as any,
        ]),
      ];
      return d;
    })(),
  },
];