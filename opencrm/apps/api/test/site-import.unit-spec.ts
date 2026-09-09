/** site-import unit tests — extractor, SSRF guard, synthesis (no network). */
import {
  assertSafeHttpUrl,
  briefToPrompt,
  escapeHtml,
  extractSiteContent,
  synthesizeFromBrief,
  synthesizeHtmlFromBrief,
} from "../src/ai/site-import";
import { pageDocumentSchema } from "@opencrm/shared";

const FIXTURE = `<!doctype html><html><head><title>Acme Plumbing | Springfield</title>
<meta name="description" content="24/7 emergency plumbers in Springfield.">
<style>.hero{background:#0b3d5c;color:#fff}</style>
<script>steal(cookies)</script></head>
<body><nav><a href="/login">Login</a></nav><main>
<h1>Springfield's fastest emergency plumber</h1>
<h2>Drain cleaning</h2><h2>Water heaters</h2>
<p>For over twenty years our licensed team has fixed leaks, clogs and burst pipes across Springfield county with upfront pricing.</p>
<p>Call any time, day or night, and a real human picks up the phone within seconds of your call today.</p>
<ul><li>Licensed &amp; insured pros</li><li>Upfront flat-rate pricing</li></ul>
<img src="/img/van.jpg" alt="Service van"><img src="data:image/png;base64,xx">
<a href="tel:+15550130000">Call (555) 013-0000</a> <a href="/quote">Free quote</a>
</main></body></html>`;

describe("assertSafeHttpUrl", () => {
  it("allows public http(s)", () => {
    expect(assertSafeHttpUrl("https://example.com/a?b=c").hostname).toBe("example.com");
  });
  it("blocks private/local/credentialed/non-http without touching the network", () => {
    for (const u of [
      "http://localhost/x", "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.0.1/",
      "http://169.254.169.254/", "http://172.16.0.9/", "https://user:pw@example.com/",
      "file:///etc/passwd", "gopher://x/", "not a url",
    ]) {
      expect(() => assertSafeHttpUrl(u)).toThrow();
    }
  });
});

describe("extractSiteContent", () => {
  it("extracts title, headlines, copy, images, ctas, colors — strips scripts", () => {
    const b = extractSiteContent(FIXTURE, "https://acme.example/");
    expect(b.title).toMatch(/Acme Plumbing/);
    expect(b.description).toMatch(/24\/7/);
    expect(b.h1).toEqual(["Springfield's fastest emergency plumber"]);
    expect(b.headings).toEqual(expect.arrayContaining(["Drain cleaning", "Water heaters"]));
    expect(b.texts.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(b)).not.toMatch(/steal/);
    expect(b.images).toEqual([{ src: "https://acme.example/img/van.jpg", alt: "Service van" }]);
    expect(b.ctas).toEqual(expect.arrayContaining([
      { text: "Call (555) 013-0000", href: "tel:+15550130000" },
      expect.objectContaining({ text: "Free quote" }),
    ]));
    expect(b.colors).toContain("#0b3d5c");
  });
});

describe("briefToPrompt", () => {
  it("frames recreation as original work, bounded size", () => {
    const b = extractSiteContent(FIXTURE, "https://acme.example/");
    const p = briefToPrompt(b);
    expect(p).toMatch(/ORIGINAL/i);
    expect(p.length).toBeLessThanOrEqual(6000);
  });
});

describe("synthesizeFromBrief", () => {
  it("builds a valid multi-section doc from the brief", () => {
    const doc = synthesizeFromBrief(extractSiteContent(FIXTURE, "https://acme.example/"));
    expect(pageDocumentSchema.safeParse(doc).success).toBe(true);
    expect(doc.sections.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(doc)).toMatch(/Springfield/);
  });
  it("still builds a valid doc from an empty brief", () => {
    const doc = synthesizeFromBrief({ url: "https://x.example", title: "", description: "", h1: [], headings: [], texts: [], points: [], images: [], ctas: [], colors: [] });
    expect(pageDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe("synthesizeHtmlFromBrief", () => {
  it("escapes hostile input (no script breakout)", () => {
    const html = synthesizeHtmlFromBrief({
      url: "https://evil.example", title: `"><script>alert(1)</script>`, description: "",
      h1: [], headings: [], texts: [], points: [], images: [],
      ctas: [{ text: "<img src=x onerror=alert(1)>", href: "https://evil.example/" }], colors: [],
    });
    expect(html).not.toMatch(/<script>alert/);
    expect(html).toMatch(/&lt;script&gt;/);
    expect(escapeHtml(`"onmouseover="x`)).toBe("&quot;onmouseover=&quot;x");
  });
});
