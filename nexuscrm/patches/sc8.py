#!/usr/bin/env python3
"""Super-cycle A part 2: website scanner, rebuild-from-scan, site_meta, webhook site_lead auto-contact, routes."""
import sys
P = 'backend/src/index.js'
s = open(P, encoding='utf-8').read()

def rep(old, new, tag, count=1):
    global s
    n = s.count(old)
    if n != count:
        print(f'❌ [{tag}] found {n}'); print('OLD:', repr(old[:110])); sys.exit(1)
    s = s.replace(old, new)
    print(f'  ✅ [{tag}]')

def insertBefore(anchor, block, tag):
    global s
    n = s.count(anchor)
    if n != 1:
        print(f'❌ [{tag}] anchor count {n}'); sys.exit(1)
    s = s.replace(anchor, block + anchor)
    print(f'  ✅ [{tag}]')

# ── 1. Scanner engine ──
insertBefore("// ── AI WEBSITE ANALYZER (audit any public URL) ───────────────",
r'''// ════════════════════════════════════════════════════════════
// WEBSITE SCANNER — reads an existing website and extracts everything
// needed to rebuild it: title, headings, text, images, phone, email,
// working hours, address, services, socials, nav links.
// ════════════════════════════════════════════════════════════
const SCAN_CACHE = new Map();
const SCAN_TTL_MS = 10 * 60 * 1000;
function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
function absolutize(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}
function extractWorkingHours(text) {
  const out = [];
  const t = String(text || '');
  if (/24\/7|24 hours|open 24|always open/i.test(t)) out.push('Open 24/7');
  const dayRe = /((?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:day)?(?:s)?)\s*[-–—:]?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/gi;
  let m;
  while ((m = dayRe.exec(t)) && out.length < 8) {
    const cap = (s) => s ? s.replace(/\s+/g, '') : s;
    out.push(`${cap(m[1])} ${m[2]} - ${m[3]}`);
  }
  const range = t.match(/(?:open|hours?)[^.\n]{0,60}/i);
  if (!out.length && range) out.push(range[0].replace(/\s+/g, ' ').trim().slice(0, 80));
  return [...new Set(out)].slice(0, 8);
}
function extractPhones(text) {
  const out = [];
  const re = /(?:(?:\+?\d{1,3}[\s\-]?)?(?:\(\d{2,4}\)[\s\-]?)?\d{3,4}[\s\-]?\d{3,4}(?:[\s\-]?\d{2,4})?)/g;
  let m;
  while ((m = re.exec(text)) && out.length < 6) {
    const p = m[0].trim();
    if (p.length >= 7 && p.length <= 18 && !/^\d{3}$/.test(p)) out.push(p);
  }
  return [...new Set(out)];
}
function extractEmails(text) {
  const out = [];
  const re = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  let m;
  while ((m = re.exec(text)) && out.length < 6) out.push(m[0].toLowerCase());
  return [...new Set(out)];
}
async function scanWebsite(env, ws, url) {
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\/\//i.test(cleanUrl) || cleanUrl.length > 500) throw new Error('Enter a valid http(s) URL');
  const cached = SCAN_CACHE.get(cleanUrl);
  if (cached && (Date.now() - cached.ts) < SCAN_TTL_MS) return cached.data;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try { res = await fetch(cleanUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'NexusCRM-SiteScanner/1.0' } }); }
  catch (e) { clearTimeout(t); throw new Error('Could not fetch that website: ' + e.message); }
  clearTimeout(t);
  if (!res.ok) throw new Error(`The website returned HTTP ${res.status} — check the URL.`);
  const html = await res.text().catch(() => '');
  if (!html || html.length < 200) throw new Error('The website returned no readable content.');
  const text = stripTags(html);
  // structured extraction
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';
  const metaDesc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1]?.trim() || '';
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].slice(0, 3).map(m => stripTags(m[1]).slice(0, 150)).filter(Boolean);
  const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].slice(0, 12).map(m => stripTags(m[1]).slice(0, 150)).filter(Boolean);
  const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].slice(0, 12).map(m => stripTags(m[1]).slice(0, 150)).filter(Boolean);
  // paragraphs (dedupe, cap)
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => stripTags(m[1]).replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 40 && p.length <= 600)
    .slice(0, 20);
  const uniqueParas = [...new Set(paras)];
  // images (dedupe by URL, prefer larger-ish)
  const imgs = [];
  const seenImgs = new Set();
  for (const m of html.matchAll(/<img[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/src=["']([^"']+)["']/i) || [])[1];
    const alt = (tag.match(/alt=["']([^"']*)["']/i) || [])[1] || '';
    const abs = absolutize(src, cleanUrl);
    if (!abs || !/^https?:\/\//i.test(abs) || seenImgs.has(abs)) continue;
    if (/\.(svg|ico|png|jpg|jpeg|webp|gif|avif)(\?|$)/i.test(abs) || abs.includes('image')) {
      seenImgs.add(abs);
      imgs.push({ url: abs, alt: alt.slice(0, 120) });
      if (imgs.length >= 12) break;
    }
  }
  // links
  const links = [];
  const seenLinks = new Set();
  for (const m of html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const abs = absolutize(href, cleanUrl);
    const label = stripTags(m[2]).replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!abs || !/^https?:\/\//i.test(abs)) continue;
    const host = new URL(abs).hostname.replace(/^www\./, '');
    if (host && host !== new URL(cleanUrl).hostname.replace(/^www\./, '') && !seenLinks.has(abs)) {
      seenLinks.add(abs);
      links.push({ url: abs, label });
      if (links.length >= 10) break;
    }
  }
  const socials = links.filter(l => /facebook|instagram|twitter|x\.com|linkedin|tiktok|youtube|wa\.me|whatsapp/i.test(l.url)).slice(0, 6);
  const phones = extractPhones(text);
  const emails = extractEmails(text);
  const hours = extractWorkingHours(text);
  const address = (text.match(/(?:address|located at|find us|visit us)[:.\s]+([^.\n]{10,90})/i) || [])[1]?.trim() || '';
  const navLabels = [...html.matchAll(/<nav[\s\S]*?<\/nav>/gi)].slice(0, 1).map(n => stripTags(n[0])).join(' | ').slice(0, 200);
  const extracted = {
    url: cleanUrl, title, meta_desc: metaDesc,
    headings: { h1: h1s, h2: h2s, h3: h3s },
    paragraphs: uniqueParas.slice(0, 12),
    images: imgs, links, socials,
    phone: phones[0] || '', phones, email: emails[0] || '', emails,
    working_hours: hours, address, nav: navLabels,
  };
  // AI content plan — what the new site should contain, in the right order
  let plan = null;
  const w = await getWorkspace(env, ws);
  if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
    try {
      const r = await callProvider(w, [{
        role: 'user',
        content: `You are rebuilding a client's old, ugly website into a modern, high-converting one. From the extracted data below, produce a CONTENT PLAN as JSON only:
{"site_name":"...","tagline":"one punchy line","hero_headline":"...","hero_sub":"one sentence","cta_primary":"...","cta_secondary":"...","marquee_items":["3-5 short value phrases"],"stats":[{"value":number,"label":"..."} up to 4],"services":[{"icon":"emoji","title":"...","desc":"one sentence"} up to 6],"why_us":["3-5 bullet points"],"about":"2-3 sentences","process":[{"title":"...","desc":"..."} 4 steps],"gallery_imgs":["2-6 image urls from the images list"],"reviews":[{"name":"...","text":"...","stars":5} 0-3],"lead_title":"...","lead_text":"...","faqs":[{"q":"...","a":"..."} 3-5],"working_hours":["..."],"contact":{"phone":"...","email":"...","address":"..."},"footer_note":"..."}
Rules: use the EXTRACTED content (real working hours, real phone/email, real services, real text) — modernize the wording but never invent services or contact details not in the data. Use images only from the images list. If something is missing, use "" or []. EXTRACTED DATA: ${JSON.stringify(extracted).slice(0, 9000)}`,
      }], { max_tokens: 2200 });
      await trackAIUsage(env, ws, 'scan-plan', r.provider, r.usage);
      try { plan = JSON.parse(r.content.match(/\{[\s\S]*\}/)?.[0] || 'null'); } catch { plan = null; }
    } catch { plan = null; }
  }
  const data = { extracted, plan, scanned_at: new Date().toISOString() };
  SCAN_CACHE.set(cleanUrl, { data, ts: Date.now() });
  return data;
}

''',
'scanner engine')

# ── 2. Rebuild builder: generate site HTML from design + content plan + instructions ──
insertBefore("// ── WEBSITES (AI-built, published sites) ─────────────────────",
r'''// Build a full site: DESIGN CSS + AI-written content HTML (with the class
// vocabulary) + the interactive JS. Deterministic shell, AI fills content.
async function generateSiteHtml(env, ws, opts) {
  const w = await getWorkspace(env, ws);
  const design = SITE_DESIGNS[opts.design_id] || SITE_DESIGNS.sentinel;
  const name = String(opts.name || 'My Website').slice(0, 120);
  const plan = opts.plan || null;      // scanned + approved content plan
  const desc = String(opts.description || '').slice(0, 800);
  const instructions = String(opts.instructions || '').slice(0, 1500);
  // Build the content instruction payload
  let contentSpec;
  if (plan) {
    contentSpec = `CONTENT PLAN (approved by the owner — use it, keep facts exact): ${JSON.stringify(plan)}`;
  } else {
    contentSpec = `Business: "${name}". About: ${desc || 'A professional local business.'}`;
  }
  const webhookUrl = opts.webhook_url || '';
  const css = design.css;
  const js = SITE_JS.replace('__WEBHOOK_URL__', webhookUrl);
  let body = '';
  if (providerPriority(w).length && (await withinDailyCap(env, ws, w.ai_daily_call_cap))) {
    try {
      const r = await callProvider(w, [{
        role: 'user',
        content: `You are a senior web designer generating the BODY of a modern landing page. The site's complete CSS is provided — USE ONLY ITS CLASSES (do not invent classes; do not output any <style> or <script>; output ONLY the body inner HTML). The page's JavaScript already provides: scroll reveal via [data-reveal] (add it to major blocks, with optional data-delay="1|2|3"), count-up stats via <b data-count="N">, marquee via .nx-marquee > .nx-marquee-track > spans, card tilt/glare via .nx-card, FAQ accordion via .nx-faq-item > .nx-faq-q + .nx-faq-a, gallery lightbox via .nx-gallery img, testimonial strip via .nx-tstrip > .nx-review, contact form via .nx-form with inputs name/email/phone/message and a submit button, sticky nav via .nx-nav with .nx-menu-btn and .nx-nav-links (anchors #home #services #about #process #gallery #reviews #faq #contact).
SECTIONS IN THIS EXACT ORDER: nav (brand = ${JSON.stringify(name)}, links), hero (.nx-hero with badge, h1 (use grad-text on a keyword), lead paragraph, two buttons .btn-primary + .btn-ghost, optional .nx-hero-img), marquee (5-6 items), stats (3-4 .nx-stat with b data-count), services (.nx-grid.g3 of .nx-card with emoji .ic, h3, p), why us (.nx-split with .nx-check bullets), about (.nx-split with text), process (.nx-steps of 4 .nx-step), parallax band (.nx-parallax with CTA), gallery (.nx-gallery with real image URLs), reviews (.nx-tstrip of .nx-review with .stars "★★★★★"), lead magnet (.nx-lead with h2/p/button), faq (3-5 .nx-faq-item), contact (.nx-contact-grid: .nx-cinfo with phone/email/address/working hours + .nx-form), footer.
${contentSpec}
${instructions ? 'OWNER INSTRUCTIONS (follow strictly): ' + instructions : ''}
Rules: professional, specific, real-sounding content; keep paragraphs short; include the working hours and phone/email from the plan in the contact section; use images from the plan's gallery_imgs when present; no lorem ipsum. Output ONLY the body HTML.`,
      }], { max_tokens: 4500 });
      body = r.content || '';
      await trackAIUsage(env, ws, 'build-site', r.provider, r.usage);
    } catch { body = ''; }
  }
  if (!body || !body.includes('<')) {
    // deterministic fallback so a site ALWAYS builds
    body = `<nav class="nx-nav"><div class="container nx-nav-inner">
      <div class="nx-brand">${escHtml(name)}</div>
      <button class="nx-menu-btn">☰</button>
      <ul class="nx-nav-links"><li><a href="#home">Home</a></li><li><a href="#services">Services</a></li><li><a href="#about">About</a></li><li><a href="#contact">Contact</a></li></ul>
    </div></nav>
    <section class="nx-hero" id="home"><div class="container nx-hero-inner">
      <div data-reveal><span class="nx-badge"><span class="dot"></span> Trusted local service</span>
      <h1>Welcome to <span class="grad-text">${escHtml(name)}</span></h1>
      <p class="lead">${escHtml(desc || 'Professional service, done right.')}</p>
      <div class="nx-hero-actions"><a class="btn btn-primary" href="#contact">Get a free quote</a><a class="btn btn-ghost" href="#services">Our services</a></div></div>
    </div></section>
    <div class="nx-marquee"><div class="nx-marquee-track"><span>Quality you can trust</span><span>Fast response</span><span>Local experts</span><span>Fair pricing</span><span>Satisfaction guaranteed</span></div></div>
    <section class="section" id="services"><div class="container">
      <div data-reveal><span class="eyebrow">What we do</span><h2 class="sec-title">Our <span class="grad-text">services</span></h2></div>
      <div class="nx-grid g3"><div class="nx-card" data-reveal><div class="ic">🛠️</div><h3>Professional service</h3><p>Reliable, high-quality work every time.</p></div><div class="nx-card" data-reveal data-delay="1"><div class="ic">⚡</div><h3>Fast turnaround</h3><p>Quick response and on-time delivery.</p></div><div class="nx-card" data-reveal data-delay="2"><div class="ic">🤝</div><h3>Fair pricing</h3><p>Transparent quotes with no surprises.</p></div></div>
    </div></section>
    <section class="section" id="contact"><div class="container"><div class="nx-contact-grid">
      <div class="nx-cinfo" data-reveal>
        <div><div><b>Contact us</b><span>${(plan && plan.contact && plan.contact.phone) || ''} ${(plan && plan.contact && plan.contact.email) || ''}</span></div></div>
        <div><div><b>Working hours</b><span>${Array.isArray(plan && plan.working_hours) ? plan.working_hours.join(', ') : 'Mon - Fri 9am - 5pm'}</span></div></div>
      </div>
      <form class="nx-form"><input name="name" placeholder="Your name" required><input name="email" type="email" placeholder="Email" required><input name="phone" placeholder="Phone"><textarea name="message" placeholder="How can we help?" required></textarea><button class="btn btn-primary" type="submit">Send message</button><div class="ok">✅ Thanks! We'll get back to you shortly.</div></form>
    </div></div></section>
    <footer class="nx-footer"><div class="container">© ${new Date().getFullYear()} ${escHtml(name)}</div></footer>`;
  }
  // strip any stray style/script the model may have emitted
  body = body.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  const ogTitle = escHtml(name);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ogTitle}</title>
<meta name="description" content="${escHtml(String((plan && plan.meta_desc) || desc || name)).slice(0, 200)}">
<meta property="og:title" content="${ogTitle}"><meta property="og:type" content="website">
<style>${css}</style>
</head><body>
${body}
<script>${js}</script>
</body></html>`;
}
function escHtml(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

''',
'generateSiteHtml')

# ── 3. sites table: keep html column; meta via site_meta table; handleSites uses generateSiteHtml ──
rep("""  if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      let html = String(body.html || '');
      let slug = randomSlug(10);
      for (let i = 0; i < 5; i++) {
        const clash = await env.DB.prepare('SELECT id FROM sites WHERE slug=?').bind(slug).first();
        if (!clash) break;
        slug = randomSlug(10);
      }
      if (body.build_with_ai) {
        const built = await aiBuildSite(env, ws, body);
        html = built.html;
      }
      const site = await env.DB.prepare(
        `INSERT INTO sites (workspace_id,name,slug,html,published) VALUES (?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), slug, html, body.published ? 1 : 0).first();
      return json({ ...site, html }, 200, origin);
    }""",
"""  if (req.method === 'POST') {
      if (!body.name) return err('Name is required', 400, origin);
      let html = String(body.html || '');
      let slug = randomSlug(10);
      for (let i = 0; i < 5; i++) {
        const clash = await env.DB.prepare('SELECT id FROM sites WHERE slug=?').bind(slug).first();
        if (!clash) break;
        slug = randomSlug(10);
      }
      const designId = SITE_DESIGNS[body.design_id] ? body.design_id : 'sentinel';
      if (body.build_with_ai) {
        // Modern path: design system + optional scanned plan + instructions
        const w = await getWorkspace(env, ws);
        html = await generateSiteHtml(env, ws, {
          name: body.name,
          description: body.description || '',
          design_id: designId,
          plan: body.plan || null,
          instructions: body.instructions || '',
          webhook_url: `${new URL('http://x').protocol}//x` ? (`${'https://' + 'example.invalid'}`) : '',
        });
        // the real webhook URL needs the worker origin — patch it after we know it below
      } else {
        html = String(body.html || '');
      }
      const site = await env.DB.prepare(
        `INSERT INTO sites (workspace_id,name,slug,html,published) VALUES (?,?,?,?,?) RETURNING *`
      ).bind(ws, body.name.slice(0, 120), slug, html, body.published ? 1 : 0).first();
      // store design + instructions + content plan in site_meta (migration-safe)
      await env.DB.prepare(
        `INSERT INTO site_meta (site_id, design_id, instructions, content_plan) VALUES (?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET design_id=?, instructions=?, content_plan=?`
      ).bind(site.id, designId, String(body.instructions || '').slice(0, 2000), JSON.stringify(body.plan || {}), designId, String(body.instructions || '').slice(0, 2000), JSON.stringify(body.plan || {})).run();
      // fix the webhook URL inside the html (needs the request origin)
      const origin = (body.webhook_url) ? String(body.webhook_url) : '';
      if (origin) {
        const fixed = html.replace('__WEBHOOK_URL__', origin);
        if (fixed !== html) {
          await env.DB.prepare('UPDATE sites SET html=? WHERE id=? AND workspace_id=?').bind(fixed, site.id, ws).run();
          html = fixed;
        }
      }
      return json({ ...site, html }, 200, origin);
    }""",
'handleSites POST v2')

# PATCH regenerate path: replace the aiBuildSite call with generateSiteHtml
rep("""    const u = { ...existing, ...pick(body, ['name', 'published', 'html']) };
    if (body.build_with_ai) {
      const built = await aiBuildSite(env, ws, { name: u.name, description: body.description || '' });
      u.html = built.html;
    }""",
"""    const u = { ...existing, ...pick(body, ['name', 'published', 'html']) };
    if (body.build_with_ai) {
      const meta = await env.DB.prepare('SELECT design_id, instructions, content_plan FROM site_meta WHERE site_id=?').bind(id).first().catch(() => null);
      u.html = await generateSiteHtml(env, ws, {
        name: u.name,
        description: body.description || '',
        design_id: (meta && SITE_DESIGNS[meta.design_id]) ? meta.design_id : (body.design_id || 'sentinel'),
        plan: (() => { try { return meta && meta.content_plan ? JSON.parse(meta.content_plan) : null; } catch { return null; } })(),
        instructions: (meta && meta.instructions) || body.instructions || '',
      });
      if (body.instructions !== undefined || body.design_id) {
        const designId2 = SITE_DESIGNS[body.design_id] ? body.design_id : (meta ? meta.design_id : 'sentinel');
        await env.DB.prepare('UPDATE site_meta SET design_id=?, instructions=? WHERE site_id=?')
          .bind(designId2, String(body.instructions !== undefined ? body.instructions : (meta ? meta.instructions : '')).slice(0, 2000), id).run();
      }
    }""",
'handleSites PATCH v2')

# GET single site: attach meta
rep("""  if (req.method === 'GET' && parts[2] === 'html') {
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!site) return err('Site not found', 404, origin);
    return json({ html: site.html }, 200, origin);
  }""",
"""  if (req.method === 'GET' && parts[2] === 'html') {
    const site = await env.DB.prepare('SELECT * FROM sites WHERE id=? AND workspace_id=?').bind(id, ws).first();
    if (!site) return err('Site not found', 404, origin);
    const meta = await env.DB.prepare('SELECT design_id, instructions, content_plan FROM site_meta WHERE site_id=?').bind(id).first().catch(() => null);
    let plan = null; try { plan = meta && meta.content_plan ? JSON.parse(meta.content_plan) : null; } catch { }
    return json({ html: site.html, design_id: meta?.design_id || 'sentinel', instructions: meta?.instructions || '', plan }, 200, origin);
  }""",
'site GET html with meta')

# list sites: include design_id
rep("""      const { results } = await env.DB.prepare(
        'SELECT id,workspace_id,name,slug,published,created_at,updated_at, LENGTH(html) as html_size FROM sites WHERE workspace_id=? ORDER BY id DESC'
      ).bind(ws).all();
      return json({ sites: results }, 200, origin);""",
"""      const { results } = await env.DB.prepare(
        'SELECT id,workspace_id,name,slug,published,created_at,updated_at, LENGTH(html) as html_size FROM sites WHERE workspace_id=? ORDER BY id DESC'
      ).bind(ws).all();
      const metas = await env.DB.prepare('SELECT site_id, design_id FROM site_meta').all().catch(() => ({ results: [] }));
      const metaMap = {};
      metas.results.forEach(m => { metaMap[m.site_id] = m.design_id; });
      return json({ sites: results.map(x => ({ ...x, design_id: metaMap[x.id] || 'sentinel' })) }, 200, origin);""",
'sites list design')

# ── 4. Webhook: auto-create contact on site_lead ──
rep("""      ctx.waitUntil((async () => {
        await processEvent(env, ev.id).catch(() => {});
        const ev2 = await env.DB.prepare("SELECT id FROM events WHERE workspace_id=? AND type='webhook' ORDER BY id DESC LIMIT 1").bind(w.id).first();
        if (ev2) await processEvent(env, ev2.id).catch(() => {});
      })());
      return json({ ok: true, event }, 200, origin);""",
"""      // Site lead forms: auto-create a contact so leads land in the CRM.
      if (event === 'site_lead' || b.event === 'site_lead') {
        const name = String(b.name || '').slice(0, 120);
        const email = String(b.email || '').toLowerCase().slice(0, 254);
        const phone = String(b.phone || '').slice(0, 40);
        if (name || email) {
          let contact = null;
          if (email && isValidEmail(email)) contact = await env.DB.prepare('SELECT id FROM contacts WHERE workspace_id=? AND LOWER(email)=LOWER(?)').bind(w.id, email).first();
          if (!contact) {
            const c = await env.DB.prepare('INSERT INTO contacts (workspace_id,name,email,phone,source,notes) VALUES (?,?,?,?,?,\\'Website lead form\\') RETURNING id')
              .bind(w.id, name || (email ? email.split('@')[0] : 'Website Lead'), email, phone, 'website').first();
            contact = c;
          }
          await env.DB.prepare("INSERT INTO messages (workspace_id,contact_id,channel,subject,body,direction) VALUES (?,?,?,'Website form message',?,'inbound')")
            .bind(w.id, contact.id, 'webchat', String(b.message || '').slice(0, 1000)).run();
          await logEvent(env, ctx, w.id, 'new_contact', contact.id, { name: contact.name, source: 'website' });
        }
      }
      ctx.waitUntil((async () => {
        await processEvent(env, ev.id).catch(() => {});
        const ev2 = await env.DB.prepare("SELECT id FROM events WHERE workspace_id=? AND type='webhook' ORDER BY id DESC LIMIT 1").bind(w.id).first();
        if (ev2) await processEvent(env, ev2.id).catch(() => {});
      })());
      return json({ ok: true, event }, 200, origin);""",
'webhook site_lead contact')

# ── 5. Routes: scan + designs list ──
rep("""  if (path === '/ai/analyze-site' && req.method === 'POST') {
    try { return json(await aiAnalyzeSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }""",
"""  if (path === '/ai/analyze-site' && req.method === 'POST') {
    try { return json(await aiAnalyzeSite(env, auth.workspaceId, body), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/scan-site' && req.method === 'POST') {
    try { return json(await scanWebsite(env, auth.workspaceId, body.url), 200, origin); }
    catch (e) { return err(e.message, 502, origin); }
  }
  if (path === '/ai/site-designs' && req.method === 'GET') {
    return json({ designs: Object.entries(SITE_DESIGNS).map(([id, d]) => ({ id, name: d.name })) }, 200, origin);
  }""",
'scan + designs routes')

open(P, 'w', encoding='utf-8').write(s)
print('SC-A part 2 done.')
