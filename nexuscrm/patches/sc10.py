#!/usr/bin/env python3
"""Batch B (cycles 9-16): scanner hardening (SSRF guard, caps), SEO/JSON-LD, JS interactivity upgrades."""
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

# ── C9-10: SSRF guard + fetch caps in scanner ──
rep("""async function scanWebsite(env, ws, url) {
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\\/\\//i.test(cleanUrl) || cleanUrl.length > 500) throw new Error('Enter a valid http(s) URL');
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
  if (!html || html.length < 200) throw new Error('The website returned no readable content.');""",
"""// SSRF guard: never fetch private/loopback/link-local targets.
function isBlockedHost(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (/^127\\.|^10\\.|^192\\.168\\.|^172\\.(1[6-9]|2\\d|3[01])\\.|^169\\.254\\.|^0\\./.test(host)) return true;
    if (host === '[::1]' || host === '::1') return true;
    const ipv6 = host.replace(/^\\[/, '').replace(/\\]$/, '');
    if (/^fe80:/i.test(ipv6) || /^fc/i.test(ipv6) || /^fd/i.test(ipv6)) return true;
  } catch { return true; }
  return false;
}
async function scanWebsite(env, ws, url) {
  const cleanUrl = String(url || '').trim();
  if (!/^https?:\\/\\//i.test(cleanUrl) || cleanUrl.length > 500) throw new Error('Enter a valid http(s) URL');
  if (isBlockedHost(cleanUrl)) throw new Error('That URL points to a private/internal address — only public websites can be scanned.');
  const cached = SCAN_CACHE.get(cleanUrl);
  if (cached && (Date.now() - cached.ts) < SCAN_TTL_MS) return cached.data;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try { res = await fetch(cleanUrl, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' } }); }
  catch (e) { clearTimeout(t); throw new Error('Could not fetch that website: ' + e.message); }
  clearTimeout(t);
  if (!res.ok) throw new Error(`The website returned HTTP ${res.status} — check the URL.`);
  const html = await res.text().catch(() => '');
  if (!html || html.length < 200) throw new Error('The website returned no readable content.');
  if (html.length > 3_000_000) throw new Error('That website is too large to scan (over 3 MB of HTML).');""",
'scanner ssrf + caps')

# ── C11-12: SEO + JSON-LD + OG image in generateSiteHtml ──
rep("""  const ogTitle = escHtml(name);
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
}""",
"""  const ogTitle = escHtml(name);
  const metaDesc = escHtml(String((plan && plan.meta_desc) || desc || name)).slice(0, 200);
  const ogImage = escHtml(String((plan && plan.gallery_imgs && plan.gallery_imgs[0]) || '')) || '';
  // LocalBusiness JSON-LD (real structured data for SEO) when we have contact info
  const c = (plan && plan.contact) || {};
  const h = (plan && plan.working_hours) || [];
  let jsonLd = '';
  if (c.phone || c.email || c.address) {
    const hoursObj = {};
    h.forEach((line, i) => { hoursObj['day' + (i + 1)] = line; });
    jsonLd = `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@type': 'LocalBusiness',
      name, description: String(metaDesc).slice(0, 180),
      telephone: c.phone || '', email: c.email || '',
      address: c.address ? { '@type': 'PostalAddress', streetAddress: c.address } : undefined,
      openingHours: h.length ? h : undefined,
      image: ogImage || undefined,
    }).replace(/</g, '\\u003c')}<\\/script>`;
  }
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ogTitle}</title>
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${ogTitle}"><meta property="og:type" content="website">${ogImage ? `<meta property="og:image" content="${ogImage}">` : ''}
<meta name="theme-color" content="#0b0e14">
${jsonLd}
<style>${css}</style>
</head><body>
${body}
<script>${js}</script>
</body></html>`;
}""",
'seo + jsonld')

# ── C13-16: SITE_JS upgrades — countdown, typing, Esc lightbox, active nav, marquee pause ──
rep("""/* testimonial auto-scroll (gentle, pauses on hover) */""",
"""/* countdown timer: <span data-countdown="2026-01-01"> */
document.querySelectorAll('[data-countdown]').forEach(function(el){
  var end = new Date(el.getAttribute('data-countdown')).getTime();
  if (isNaN(end)) return;
  function tick(){var d=end-Date.now();if(d<=0){el.textContent='Offer ends soon!';return;}
    var days=Math.floor(d/864e5),hrs=Math.floor(d%864e5/36e5),min=Math.floor(d%36e5/6e4),sec=Math.floor(d%6e4/1e3);
    el.textContent=days+'d '+hrs+'h '+min+'m '+sec+'s';}
  tick();setInterval(tick,1000);
});
/* typing effect: <span data-type="Text to type"> */
document.querySelectorAll('[data-type]').forEach(function(el){
  var txt=el.getAttribute('data-type'),i=0;
  function type(){if(i<=txt.length){el.textContent=txt.slice(0,i++);setTimeout(type,R?1:42);}}
  type();
});
/* gallery lightbox: Esc closes */
document.addEventListener('keydown',function(e){if(e.key==='Escape'){var lb=document.querySelector('.nx-lightbox');if(lb)lb.style.display='none';}});
/* active nav link highlight */
var secs=document.querySelectorAll('section[id]');
if(secs.length){addEventListener('scroll',function(){
  var y=scrollY+120,cur='';
  secs.forEach(function(s){if(s.offsetTop<=y)cur=s.id;});
  document.querySelectorAll('.nx-nav-links a').forEach(function(a){var h=a.getAttribute('href');a.style.color=(h==='#'+cur)?'var(--accent)':'';});
},{passive:true});}
/* testimonial auto-scroll (gentle, pauses on hover) */""",
'site js upgrades')

open(P, 'w', encoding='utf-8').write(s)
print('Batch B done.')
