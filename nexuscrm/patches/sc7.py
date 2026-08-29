#!/usr/bin/env python3
"""Super-cycle A (cycles 1-8): Website engine v2 — design system, scanner, rebuild, instructions, forms wiring."""
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

# ════════════════════════════════════════════════════════════
# WEBSITE ENGINE V2 — before the existing SITE_FALLBACK_HTML block
# ════════════════════════════════════════════════════════════
anchor = "const SITE_FALLBACK_HTML = (name, desc) => `<!DOCTYPE html>"
assert s.count(anchor) == 1
block = r'''// ════════════════════════════════════════════════════════════
// WEBSITE ENGINE V2 — design systems, scanner, rebuild, instructions
// Design DNA learned from a production template: TopBar → Nav → Hero →
// Marquee → Stats → Services → Why Us → About → Process → Parallax →
// Gallery → Reviews → Lead Magnet → FAQ → Contact → Footer, with
// scroll-reveal, count-up stats, cursor spotlight, card tilt, magnetic
// buttons, marquee, film grain, gradient hairlines and reduced-motion
// support. The AI writes ONLY the content HTML against a fixed design
// CSS + interactive JS, so every generated site looks professional and
// stays consistent — never a generic AI soup page.
// ════════════════════════════════════════════════════════════
const SITE_DESIGNS = {
  sentinel: {
    name: 'Bold & Interactive (Sentinel style)',
    css: `/* design: sentinel */
:root{--bg:#0b0e14;--bg2:#11151f;--card:#161b28;--line:#232a3d;--text:#e8ecf4;--muted:#93a0b8;--accent:#f7742a;--accent2:#ffb24d;--teal:#2fb3a2;--amber:#ffcf6e;--grad:linear-gradient(100deg,#f7742a 8%,#ffcf6e 45%,#2fb3a2 85%);--radius:16px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(60vw 60vw at 8% -5%,rgba(247,116,42,.09),transparent 60%),radial-gradient(55vw 55vw at 105% 108%,rgba(47,179,162,.10),transparent 60%)}
main,header,section,footer{position:relative;z-index:1}
a{color:var(--teal);text-decoration:none}
img{max-width:100%;height:auto;display:block}
.container{max-width:1120px;margin:0 auto;padding:0 22px}
.section{padding:88px 0}
.section+section::before{content:"";position:absolute;top:0;left:50%;transform:translateX(-50%);width:min(220px,40%);height:1px;background:linear-gradient(90deg,transparent,var(--teal),transparent);opacity:.5}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--teal);font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px}
.eyebrow::before{content:"";width:26px;height:2px;background:linear-gradient(90deg,var(--teal),transparent);border-radius:2px}
h1,h2,h3{line-height:1.15;letter-spacing:-.02em}
.sec-title{font-size:clamp(28px,4vw,42px);font-weight:800;margin-bottom:14px}
.grad-text{background:var(--grad);background-size:220% auto;-webkit-background-clip:text;background-clip:text;color:transparent;animation:sheen 8s linear infinite}
@keyframes sheen{to{background-position:220% 50%}}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border-radius:12px;font-weight:700;font-size:14px;border:none;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s,filter .25s;text-decoration:none}
.btn-primary{background:linear-gradient(135deg,#ffb24d,var(--accent) 55%,#c2551a);color:#1a120b;box-shadow:0 14px 34px -10px rgba(247,116,42,.55),inset 0 1px 0 rgba(255,255,255,.3)}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 22px 50px -12px rgba(247,116,42,.7),0 6px 20px -6px rgba(47,179,162,.5)}
.btn-ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
.btn-ghost:hover{border-color:var(--teal);background:rgba(47,179,162,.1);transform:translateY(-3px)}
/* nav */
.nx-nav{position:sticky;top:0;z-index:50;background:rgba(11,14,20,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line);transition:box-shadow .3s}
.nx-nav.scrolled{box-shadow:0 10px 40px -12px rgba(0,0,0,.6)}
.nx-nav-inner{display:flex;align-items:center;justify-content:space-between;padding:15px 0;gap:14px}
.nx-brand{font-size:19px;font-weight:800;letter-spacing:-.02em}
.nx-brand em{font-style:normal;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-nav-links{display:flex;gap:22px;list-style:none;align-items:center}
.nx-nav-links a{color:var(--muted);font-size:14px;font-weight:600;transition:color .2s}
.nx-nav-links a:hover{color:var(--teal)}
.nx-menu-btn{display:none;background:none;border:1px solid var(--line);color:var(--text);border-radius:10px;padding:8px 12px;font-size:18px;cursor:pointer}
/* hero */
.nx-hero{position:relative;padding:110px 0 90px;overflow:hidden}
#nx-spot{position:fixed;width:520px;height:520px;border-radius:50%;pointer-events:none;z-index:0;background:radial-gradient(circle,rgba(247,116,42,.10),transparent 65%);transform:translate(-50%,-50%);mix-blend-mode:screen;will-change:transform}
.nx-hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:50px;align-items:center;position:relative;z-index:2}
.nx-hero h1{font-size:clamp(36px,6vw,64px);font-weight:900;margin-bottom:18px}
.nx-hero p.lead{font-size:clamp(16px,2vw,19px);color:var(--muted);max-width:520px;margin-bottom:28px}
.nx-hero-actions{display:flex;gap:12px;flex-wrap:wrap}
.nx-hero-img{position:relative}
.nx-hero-img img{border-radius:var(--radius);box-shadow:0 40px 90px -30px rgba(0,0,0,.8);animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.nx-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(47,179,162,.12);border:1px solid rgba(47,179,162,.3);color:var(--teal);border-radius:30px;padding:7px 14px;font-size:12px;font-weight:700;margin-bottom:20px}
.nx-badge .dot{width:8px;height:8px;border-radius:50%;background:var(--teal);box-shadow:0 0 10px var(--teal);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
/* marquee */
.nx-marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px 0;background:var(--bg2)}
.nx-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:marquee 26s linear infinite;will-change:transform}
.nx-marquee span{font-size:15px;font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:44px}
.nx-marquee span::after{content:"✦";color:var(--accent)}
@keyframes marquee{to{transform:translateX(-50%)}}
/* stats */
.nx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px}
.nx-stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;text-align:center;position:relative;overflow:hidden;transition:transform .25s var(--ease),border-color .25s,box-shadow .25s}
.nx-stat::after{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--grad);opacity:0;transition:opacity .25s}
.nx-stat:hover{transform:translateY(-5px);border-color:rgba(47,179,162,.4);box-shadow:0 22px 44px -22px rgba(0,0,0,.7)}
.nx-stat:hover::after{opacity:1}
.nx-stat b{font-size:clamp(26px,3.4vw,38px);font-weight:900;display:block;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700}
/* cards */
.nx-grid{display:grid;gap:22px}
.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.nx-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:28px;position:relative;overflow:hidden;transition:transform .3s var(--ease),border-color .3s,box-shadow .3s;will-change:transform}
.nx-card::before{content:"";position:absolute;inset:0;border-radius:inherit;background:radial-gradient(420px circle at var(--gx,50%) var(--gy,50%),rgba(255,178,77,.14),transparent 60%);opacity:0;transition:opacity .3s;pointer-events:none}
.nx-card:hover{transform:translateY(-6px);border-color:rgba(247,116,42,.45);box-shadow:0 30px 60px -28px rgba(0,0,0,.85)}
.nx-card:hover::before{opacity:1}
.nx-card .ic{font-size:34px;margin-bottom:14px;transition:transform .45s var(--ease)}
.nx-card:hover .ic{transform:translateY(-4px) rotate(-6deg) scale(1.1)}
.nx-card h3{font-size:18px;margin-bottom:8px}
.nx-card p{color:var(--muted);font-size:14px}
.nx-num{position:absolute;top:16px;right:20px;font-size:44px;font-weight:900;color:rgba(255,255,255,.05)}
/* why / about split */
.nx-split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.nx-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--muted)}
.nx-check b{color:var(--text)}
.nx-check::before{content:"✓";flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(47,179,162,.16);color:var(--teal);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
/* process steps */
.nx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px;counter-reset:step}
.nx-step{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;position:relative;transition:transform .25s var(--ease),border-color .25s}
.nx-step:hover{transform:translateY(-5px);border-color:var(--teal)}
.nx-step .n{font-size:40px;font-weight:900;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:block;margin-bottom:10px}
/* parallax band */
.nx-parallax{background:linear-gradient(135deg,rgba(247,116,42,.14),rgba(47,179,162,.12)),var(--bg2);padding:80px 0;text-align:center;position:relative;overflow:hidden}
.nx-parallax h2{font-size:clamp(26px,4vw,40px);font-weight:900;margin-bottom:14px}
.nx-parallax p{color:var(--muted);max-width:640px;margin:0 auto 24px}
/* gallery */
.nx-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.nx-gallery img{aspect-ratio:4/3;object-fit:cover;border-radius:12px;border:1px solid var(--line);cursor:zoom-in;transition:transform .6s var(--ease),filter .4s;width:100%}
.nx-gallery img:hover{transform:scale(1.04);filter:saturate(1.15)}
/* reviews */
.nx-tstrip{display:flex;gap:18px;overflow-x:auto;padding:8px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:none}
.nx-tstrip::-webkit-scrollbar{display:none}
.nx-review{min-width:280px;flex:0 0 280px;scroll-snap-align:start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.nx-review .stars{color:var(--amber);margin-bottom:10px;letter-spacing:2px}
.nx-review p{font-size:14px;color:var(--muted);font-style:italic;margin-bottom:14px}
.nx-review .who{font-size:13px;font-weight:700}
.nx-review .who span{color:var(--text3,#64748b);font-weight:500}
/* lead magnet */
.nx-lead{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius) + 6px);padding:48px;text-align:center;position:relative;overflow:hidden}
.nx-lead::before{content:"";position:absolute;top:-60px;right:-60px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(247,116,42,.25),transparent 70%)}
.nx-lead h2{font-size:clamp(24px,3.4vw,36px);font-weight:900;margin-bottom:10px}
.nx-lead p{color:var(--muted);max-width:520px;margin:0 auto 22px}
/* faq */
.nx-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.nx-faq-q{width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;font-size:15px;font-weight:700;color:var(--text);cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .2s}
.nx-faq-q:hover{border-color:var(--teal)}
.nx-faq-q .arr{transition:transform .3s var(--ease);color:var(--teal)}
.nx-faq-item.open .arr{transform:rotate(45deg)}
.nx-faq-a{max-height:0;overflow:hidden;transition:max-height .35s var(--ease);color:var(--muted);font-size:14px}
.nx-faq-item.open .nx-faq-a{max-height:300px;padding:4px 20px 16px}
/* contact */
.nx-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.nx-cinfo{display:flex;flex-direction:column;gap:14px}
.nx-cinfo div{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.nx-cinfo b{display:block;font-size:13px;margin-bottom:2px}
.nx-cinfo span{color:var(--muted);font-size:14px}
.nx-form{display:flex;flex-direction:column;gap:14px}
.nx-form input,.nx-form textarea{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:13px 16px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
.nx-form input:focus,.nx-form textarea:focus{border-color:var(--teal);box-shadow:0 0 0 3px rgba(47,179,162,.2)}
.nx-form textarea{min-height:120px;resize:vertical}
.nx-form .ok{color:var(--teal);font-size:14px;font-weight:700;display:none}
/* footer */
.nx-footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--muted);font-size:13px;background:var(--bg2)}
.nx-footer a{color:var(--teal)}
/* reveal + back-to-top */
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
[data-reveal].in{opacity:1;transform:none}
[data-reveal][data-delay="1"]{transition-delay:.1s}[data-reveal][data-delay="2"]{transition-delay:.2s}[data-reveal][data-delay="3"]{transition-delay:.3s}
#nx-top{position:fixed;bottom:22px;right:22px;width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#c2551a);color:#fff;border:none;font-size:18px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .3s,transform .3s;z-index:60;box-shadow:0 10px 30px -8px rgba(247,116,42,.6)}
#nx-top.show{opacity:1;pointer-events:auto}
#nx-top:hover{transform:translateY(-3px)}
.nx-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:90;display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.nx-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px}
@media(max-width:820px){.nx-hero-inner,.nx-split,.nx-contact-grid{grid-template-columns:1fr}.nx-hero{padding:70px 0 56px}.nx-nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border-bottom:1px solid var(--line);flex-direction:column;padding:14px 22px;gap:14px}.nx-nav-links.open{display:flex}.nx-menu-btn{display:block}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}[data-reveal]{opacity:1;transform:none}#nx-spot{display:none}}`,
  },
  aurora: {
    name: 'Aurora (light, airy, gradient)',
    css: `/* design: aurora */
:root{--bg:#f7f9fc;--bg2:#eef2f9;--card:#ffffff;--line:#e2e8f0;--text:#0f172a;--muted:#5b6b84;--accent:#4f46e5;--accent2:#7c3aed;--teal:#06b6d4;--amber:#f59e0b;--grad:linear-gradient(100deg,#4f46e5,#7c3aed 50%,#06b6d4);--radius:16px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(50vw 50vw at 90% -10%,rgba(124,58,237,.10),transparent 60%),radial-gradient(45vw 45vw at 0% 105%,rgba(6,182,212,.10),transparent 60%)}
main,header,section,footer{position:relative;z-index:1}
a{color:var(--accent);text-decoration:none}img{max-width:100%;height:auto;display:block}
.container{max-width:1120px;margin:0 auto;padding:0 22px}.section{padding:88px 0}
.eyebrow{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px}
.sec-title{font-size:clamp(28px,4vw,42px);font-weight:900;margin-bottom:14px;letter-spacing:-.02em}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border-radius:999px;font-weight:700;font-size:14px;border:none;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s;text-decoration:none}
.btn-primary{background:var(--grad);color:#fff;box-shadow:0 14px 30px -10px rgba(79,70,229,.5)}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 20px 40px -12px rgba(79,70,229,.6)}
.btn-ghost{background:#fff;border:1px solid var(--line);color:var(--text);box-shadow:0 4px 14px -6px rgba(15,23,42,.08)}
.btn-ghost:hover{border-color:var(--accent);transform:translateY(-3px)}
.nx-nav{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.8);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nx-nav-inner{display:flex;align-items:center;justify-content:space-between;padding:15px 0;gap:14px}
.nx-brand{font-size:19px;font-weight:900;letter-spacing:-.02em}.nx-brand em{font-style:normal;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-nav-links{display:flex;gap:22px;list-style:none}.nx-nav-links a{color:var(--muted);font-size:14px;font-weight:600}
.nx-nav-links a:hover{color:var(--accent)}.nx-menu-btn{display:none;background:none;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:18px;cursor:pointer}
.nx-hero{padding:104px 0 84px;position:relative;overflow:hidden}
.nx-hero::before{content:"";position:absolute;top:-140px;left:50%;transform:translateX(-50%);width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.14),transparent 65%);filter:blur(10px)}
.nx-hero-inner{display:grid;grid-template-columns:1.1fr .9fr;gap:50px;align-items:center;position:relative;z-index:2}
.nx-hero h1{font-size:clamp(36px,6vw,60px);font-weight:900;margin-bottom:18px;letter-spacing:-.03em}
.nx-hero p.lead{color:var(--muted);font-size:18px;max-width:520px;margin-bottom:28px}
.nx-hero-actions{display:flex;gap:12px;flex-wrap:wrap}
.nx-hero-img img{border-radius:24px;box-shadow:0 40px 80px -30px rgba(79,70,229,.35);animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
.nx-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(79,70,229,.08);border:1px solid rgba(79,70,229,.25);color:var(--accent);border-radius:30px;padding:7px 14px;font-size:12px;font-weight:800;margin-bottom:20px}
.nx-marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0;background:#fff}
.nx-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:marquee 30s linear infinite}
.nx-marquee span{font-weight:700;color:var(--muted);display:inline-flex;align-items:center;gap:44px}
.nx-marquee span::after{content:"✦";color:var(--accent)}
@keyframes marquee{to{transform:translateX(-50%)}}
.nx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.nx-stat{background:#fff;border:1px solid var(--line);border-radius:20px;padding:26px;text-align:center;box-shadow:0 8px 24px -14px rgba(15,23,42,.12);transition:transform .25s var(--ease),box-shadow .25s}
.nx-stat:hover{transform:translateY(-5px);box-shadow:0 18px 40px -18px rgba(79,70,229,.25)}
.nx-stat b{font-size:clamp(26px,3.4vw,38px);font-weight:900;display:block;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.nx-stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;font-weight:700}
.nx-grid{display:grid;gap:20px}.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.nx-card{background:#fff;border:1px solid var(--line);border-radius:20px;padding:28px;transition:transform .3s var(--ease),box-shadow .3s,border-color .3s;will-change:transform}
.nx-card:hover{transform:translateY(-6px);box-shadow:0 26px 50px -22px rgba(79,70,229,.28);border-color:rgba(124,58,237,.3)}
.nx-card .ic{font-size:34px;margin-bottom:14px}.nx-card h3{font-size:18px;margin-bottom:8px}.nx-card p{color:var(--muted);font-size:14px}
.nx-split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.nx-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--muted)}
.nx-check::before{content:"✓";flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(79,70,229,.12);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
.nx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.nx-step{background:#fff;border:1px solid var(--line);border-radius:20px;padding:26px;transition:transform .25s var(--ease),box-shadow .25s}
.nx-step:hover{transform:translateY(-5px);box-shadow:0 18px 40px -18px rgba(79,70,229,.2)}
.nx-step .n{font-size:40px;font-weight:900;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent;display:block;margin-bottom:10px}
.nx-parallax{background:linear-gradient(135deg,rgba(79,70,229,.12),rgba(6,182,212,.12)),#fff;padding:80px 0;text-align:center}
.nx-parallax h2{font-size:clamp(26px,4vw,40px);font-weight:900;margin-bottom:14px}.nx-parallax p{color:var(--muted);max-width:640px;margin:0 auto 24px}
.nx-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.nx-gallery img{aspect-ratio:4/3;object-fit:cover;border-radius:16px;cursor:zoom-in;transition:transform .5s var(--ease)}
.nx-gallery img:hover{transform:scale(1.04)}
.nx-tstrip{display:flex;gap:16px;overflow-x:auto;padding:8px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:none}
.nx-tstrip::-webkit-scrollbar{display:none}
.nx-review{min-width:280px;flex:0 0 280px;scroll-snap-align:start;background:#fff;border:1px solid var(--line);border-radius:20px;padding:24px;box-shadow:0 8px 24px -14px rgba(15,23,42,.1)}
.nx-review .stars{color:var(--amber);margin-bottom:10px;letter-spacing:2px}.nx-review p{font-size:14px;color:var(--muted);font-style:italic;margin-bottom:14px}.nx-review .who{font-size:13px;font-weight:800}
.nx-lead{background:var(--grad);border-radius:28px;padding:52px;text-align:center;color:#fff;position:relative;overflow:hidden}
.nx-lead h2{font-size:clamp(24px,3.4vw,36px);font-weight:900;margin-bottom:10px}.nx-lead p{opacity:.9;max-width:520px;margin:0 auto 22px}
.nx-lead .btn-primary{background:#fff;color:var(--accent);box-shadow:0 14px 30px -10px rgba(0,0,0,.3)}
.nx-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.nx-faq-q{width:100%;text-align:left;background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;font-size:15px;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .2s}
.nx-faq-q:hover{border-color:var(--accent)}.nx-faq-q .arr{transition:transform .3s var(--ease);color:var(--accent)}
.nx-faq-item.open .arr{transform:rotate(45deg)}
.nx-faq-a{max-height:0;overflow:hidden;transition:max-height .35s var(--ease);color:var(--muted);font-size:14px}
.nx-faq-item.open .nx-faq-a{max-height:300px;padding:4px 20px 16px}
.nx-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.nx-cinfo{display:flex;flex-direction:column;gap:14px}
.nx-cinfo div{display:flex;gap:12px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.nx-cinfo b{display:block;font-size:13px;margin-bottom:2px}.nx-cinfo span{color:var(--muted);font-size:14px}
.nx-form{display:flex;flex-direction:column;gap:14px}
.nx-form input,.nx-form textarea{background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 16px;font-size:14px;font-family:inherit;outline:none;transition:border-color .2s,box-shadow .2s}
.nx-form input:focus,.nx-form textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(79,70,229,.15)}
.nx-form textarea{min-height:120px;resize:vertical}.nx-form .ok{color:var(--teal);font-size:14px;font-weight:800;display:none}
.nx-footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--muted);font-size:13px;background:#fff}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
[data-reveal].in{opacity:1;transform:none}
[data-reveal][data-delay="1"]{transition-delay:.1s}[data-reveal][data-delay="2"]{transition-delay:.2s}[data-reveal][data-delay="3"]{transition-delay:.3s}
#nx-top{position:fixed;bottom:22px;right:22px;width:44px;height:44px;border-radius:50%;background:var(--grad);color:#fff;border:none;font-size:18px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .3s;z-index:60}
#nx-top.show{opacity:1;pointer-events:auto}
.nx-lightbox{position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:90;display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.nx-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px}
@media(max-width:820px){.nx-hero-inner,.nx-split,.nx-contact-grid{grid-template-columns:1fr}.nx-hero{padding:70px 0 56px}.nx-nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border-bottom:1px solid var(--line);flex-direction:column;padding:14px 22px;gap:14px}.nx-nav-links.open{display:flex}.nx-menu-btn{display:block}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}[data-reveal]{opacity:1;transform:none}}`,
  },
  slate: {
    name: 'Slate (dark, minimal, elegant)',
    css: `/* design: slate */
:root{--bg:#0a0c10;--bg2:#101319;--card:#151a22;--line:#222a36;--text:#e6eaf2;--muted:#8b97ab;--accent:#5b8def;--accent2:#8fa8ff;--teal:#7ee2d0;--amber:#f2c14e;--grad:linear-gradient(100deg,#5b8def,#8fa8ff 55%,#7ee2d0);--radius:14px;--ease:cubic-bezier(.2,.7,.2,1)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;overflow-x:hidden}
main,header,section,footer{position:relative;z-index:1}
a{color:var(--accent);text-decoration:none}img{max-width:100%;height:auto;display:block}
.container{max-width:1120px;margin:0 auto;padding:0 22px}.section{padding:88px 0}
.eyebrow{color:var(--teal);font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;margin-bottom:12px;display:block}
.sec-title{font-size:clamp(28px,4vw,42px);font-weight:800;margin-bottom:14px;letter-spacing:-.02em}
.grad-text{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 26px;border-radius:10px;font-weight:700;font-size:14px;border:none;cursor:pointer;transition:transform .25s var(--ease),box-shadow .25s,background .25s;text-decoration:none}
.btn-primary{background:var(--accent);color:#0a0c10}
.btn-primary:hover{transform:translateY(-3px);box-shadow:0 18px 36px -14px rgba(91,141,239,.6)}
.btn-ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
.btn-ghost:hover{border-color:var(--accent);transform:translateY(-3px)}
.nx-nav{position:sticky;top:0;z-index:50;background:rgba(10,12,16,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.nx-nav-inner{display:flex;align-items:center;justify-content:space-between;padding:15px 0;gap:14px}
.nx-brand{font-size:19px;font-weight:800}.nx-brand em{font-style:normal;color:var(--accent)}
.nx-nav-links{display:flex;gap:22px;list-style:none}.nx-nav-links a{color:var(--muted);font-size:14px;font-weight:600}.nx-nav-links a:hover{color:var(--text)}
.nx-menu-btn{display:none;background:none;border:1px solid var(--line);border-radius:10px;padding:8px 12px;font-size:18px;cursor:pointer;color:var(--text)}
.nx-hero{padding:110px 0 90px;text-align:center;position:relative;overflow:hidden}
.nx-hero::before{content:"";position:absolute;top:-160px;left:50%;transform:translateX(-50%);width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,rgba(91,141,239,.16),transparent 65%)}
.nx-hero h1{font-size:clamp(36px,6vw,62px);font-weight:900;margin:0 auto 18px;max-width:800px;letter-spacing:-.03em}
.nx-hero p.lead{color:var(--muted);font-size:18px;max-width:560px;margin:0 auto 30px}
.nx-hero-actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.nx-badge{display:inline-flex;align-items:center;gap:8px;background:rgba(126,226,208,.1);border:1px solid rgba(126,226,208,.3);color:var(--teal);border-radius:30px;padding:7px 14px;font-size:12px;font-weight:700;margin-bottom:20px}
.nx-marquee{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:16px 0}
.nx-marquee-track{display:flex;gap:44px;white-space:nowrap;animation:marquee 34s linear infinite}
.nx-marquee span{color:var(--muted);font-weight:600;display:inline-flex;align-items:center;gap:44px}
.nx-marquee span::after{content:"—";color:var(--accent)}
@keyframes marquee{to{transform:translateX(-50%)}}
.nx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px}
.nx-stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;text-align:center;transition:transform .25s var(--ease),border-color .25s}
.nx-stat:hover{transform:translateY(-5px);border-color:rgba(91,141,239,.4)}
.nx-stat b{font-size:clamp(26px,3.4vw,38px);font-weight:900;display:block;color:var(--accent)}
.nx-stat span{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;font-weight:700}
.nx-grid{display:grid;gap:20px}.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}.g3{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.nx-card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:28px;transition:transform .3s var(--ease),border-color .3s}
.nx-card:hover{transform:translateY(-6px);border-color:rgba(91,141,239,.5)}
.nx-card .ic{font-size:34px;margin-bottom:14px}.nx-card h3{font-size:18px;margin-bottom:8px}.nx-card p{color:var(--muted);font-size:14px}
.nx-split{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.nx-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;color:var(--muted)}
.nx-check::before{content:"✓";flex-shrink:0;width:22px;height:22px;border-radius:50%;background:rgba(126,226,208,.14);color:var(--teal);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
.nx-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:20px}
.nx-step{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:26px;transition:transform .25s var(--ease),border-color .25s}
.nx-step:hover{transform:translateY(-5px);border-color:var(--accent)}
.nx-step .n{font-size:40px;font-weight:900;color:var(--accent);display:block;margin-bottom:10px}
.nx-parallax{background:linear-gradient(135deg,rgba(91,141,239,.14),rgba(126,226,208,.1)),var(--bg2);padding:80px 0;text-align:center}
.nx-parallax h2{font-size:clamp(26px,4vw,40px);font-weight:900;margin-bottom:14px}.nx-parallax p{color:var(--muted);max-width:640px;margin:0 auto 24px}
.nx-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}
.nx-gallery img{aspect-ratio:4/3;object-fit:cover;border-radius:12px;cursor:zoom-in;transition:transform .5s var(--ease)}
.nx-gallery img:hover{transform:scale(1.04)}
.nx-tstrip{display:flex;gap:16px;overflow-x:auto;padding:8px 2px 18px;scroll-snap-type:x mandatory;scrollbar-width:none}
.nx-tstrip::-webkit-scrollbar{display:none}
.nx-review{min-width:280px;flex:0 0 280px;scroll-snap-align:start;background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:24px}
.nx-review .stars{color:var(--amber);margin-bottom:10px;letter-spacing:2px}.nx-review p{font-size:14px;color:var(--muted);font-style:italic;margin-bottom:14px}.nx-review .who{font-size:13px;font-weight:700}
.nx-lead{background:var(--card);border:1px solid var(--line);border-radius:calc(var(--radius) + 6px);padding:48px;text-align:center}
.nx-lead h2{font-size:clamp(24px,3.4vw,36px);font-weight:900;margin-bottom:10px}.nx-lead p{color:var(--muted);max-width:520px;margin:0 auto 22px}
.nx-faq{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.nx-faq-q{width:100%;text-align:left;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px 20px;font-size:15px;font-weight:700;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;transition:border-color .2s}
.nx-faq-q:hover{border-color:var(--accent)}.nx-faq-q .arr{transition:transform .3s var(--ease);color:var(--accent)}
.nx-faq-item.open .arr{transform:rotate(45deg)}
.nx-faq-a{max-height:0;overflow:hidden;transition:max-height .35s var(--ease);color:var(--muted);font-size:14px}
.nx-faq-item.open .nx-faq-a{max-height:300px;padding:4px 20px 16px}
.nx-contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start}
.nx-cinfo{display:flex;flex-direction:column;gap:14px}
.nx-cinfo div{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.nx-cinfo b{display:block;font-size:13px;margin-bottom:2px}.nx-cinfo span{color:var(--muted);font-size:14px}
.nx-form{display:flex;flex-direction:column;gap:14px}
.nx-form input,.nx-form textarea{background:var(--bg2);border:1px solid var(--line);border-radius:12px;padding:13px 16px;color:var(--text);font-size:14px;font-family:inherit;outline:none;transition:border-color .2s}
.nx-form input:focus,.nx-form textarea:focus{border-color:var(--accent)}
.nx-form textarea{min-height:120px;resize:vertical}.nx-form .ok{color:var(--teal);font-size:14px;font-weight:800;display:none}
.nx-footer{border-top:1px solid var(--line);padding:34px 0;text-align:center;color:var(--muted);font-size:13px}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
[data-reveal].in{opacity:1;transform:none}
[data-reveal][data-delay="1"]{transition-delay:.1s}[data-reveal][data-delay="2"]{transition-delay:.2s}[data-reveal][data-delay="3"]{transition-delay:.3s}
#nx-top{position:fixed;bottom:22px;right:22px;width:44px;height:44px;border-radius:50%;background:var(--accent);color:#0a0c10;border:none;font-size:18px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .3s;z-index:60}
#nx-top.show{opacity:1;pointer-events:auto}
.nx-lightbox{position:fixed;inset:0;background:rgba(10,12,16,.88);z-index:90;display:none;align-items:center;justify-content:center;padding:30px;cursor:zoom-out}
.nx-lightbox img{max-width:92vw;max-height:88vh;border-radius:12px}
@media(max-width:820px){.nx-hero-inner,.nx-split,.nx-contact-grid{grid-template-columns:1fr}.nx-hero{padding:70px 0 56px}.nx-nav-links{display:none;position:absolute;top:100%;left:0;right:0;background:var(--bg2);border-bottom:1px solid var(--line);flex-direction:column;padding:14px 22px;gap:14px}.nx-nav-links.open{display:flex}.nx-menu-btn{display:block}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;transition-duration:.01ms!important}[data-reveal]{opacity:1;transform:none}}`,
  },
};
// Interactive engine injected into every generated site (compact; reduced-motion aware)
const SITE_JS = `(function(){
var R=matchMedia('(prefers-reduced-motion: reduce)').matches;
/* scroll reveal */
var els=document.querySelectorAll('[data-reveal]');
if(R){els.forEach(function(e){e.classList.add('in');});}
else if('IntersectionObserver' in window){
  var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}});},{threshold:.06,rootMargin:'70px 0px 70px 0px'});
  els.forEach(function(e){io.observe(e);});
}
/* count-up */
var cels=document.querySelectorAll('[data-count]');
if(cels.length){
  var cio=new IntersectionObserver(function(es){es.forEach(function(x){if(!x.isIntersecting)return;cio.unobserve(x.target);var el=x.target,t=+el.getAttribute('data-count');if(R){el.textContent=t;return;}var st=performance.now(),dur=760;function tick(n){var p=Math.min(1,(n-st)/dur);el.textContent=Math.round(t*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(tick);}requestAnimationFrame(tick);});},{threshold:.3});
  cels.forEach(function(e){cio.observe(e);});
}
/* sticky nav glass */
var nav=document.querySelector('.nx-nav');
if(nav){var onS=function(){nav.classList.toggle('scrolled',scrollY>30);};addEventListener('scroll',onS,{passive:true});onS();}
/* mobile menu */
var mb=document.querySelector('.nx-menu-btn'),nl=document.querySelector('.nx-nav-links');
if(mb&&nl){mb.addEventListener('click',function(){nl.classList.toggle('open');});
  nl.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){nl.classList.remove('open');});});}
/* smooth anchors */
document.querySelectorAll('a[href^="#"]').forEach(function(a){a.addEventListener('click',function(e){var id=a.getAttribute('href');if(id.length<2)return;var t=document.querySelector(id);if(t){e.preventDefault();t.scrollIntoView({behavior:R?'auto':'smooth'});}});});
/* FAQ accordion */
document.querySelectorAll('.nx-faq-q').forEach(function(q){q.addEventListener('click',function(){q.parentElement.classList.toggle('open');});});
/* gallery lightbox */
var gl=document.querySelectorAll('.nx-gallery img');
if(gl.length){var lb=document.createElement('div');lb.className='nx-lightbox';var li=document.createElement('img');lb.appendChild(li);document.body.appendChild(lb);
  gl.forEach(function(img){img.addEventListener('click',function(){li.src=img.getAttribute('src');lb.style.display='flex';});});
  lb.addEventListener('click',function(){lb.style.display='none';});}
/* back to top */
var bt=document.createElement('button');bt.id='nx-top';bt.textContent='↑';bt.setAttribute('aria-label','Back to top');document.body.appendChild(bt);
addEventListener('scroll',function(){bt.classList.toggle('show',scrollY>500);},{passive:true});
bt.addEventListener('click',function(){scrollTo({top:0,behavior:R?'auto':'smooth'});});
/* cursor spotlight (fine pointers only) */
if(!R&&matchMedia('(pointer:fine)').matches){
  var sp=document.createElement('div');sp.id='nx-spot';document.body.appendChild(sp);
  var x=innerWidth/2,y=innerHeight/2,cx=x,cy=y,raf=0;
  addEventListener('pointermove',function(e){x=e.clientX;y=e.clientY;if(!raf)raf=requestAnimationFrame(function(){raf=0;cx+=(x-cx)*.16;cy+=(y-cy)*.16;sp.style.left=cx+'px';sp.style.top=cy+'px';});},{passive:true});
}
/* card tilt + glare */
if(!R&&matchMedia('(pointer:fine)').matches){
  document.querySelectorAll('.nx-card,.nx-stat').forEach(function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--gx',((e.clientX-r.left)/r.width*100)+'%');c.style.setProperty('--gy',((e.clientY-r.top)/r.height*100)+'%');});});
}
/* testimonial auto-scroll (gentle, pauses on hover) */
var ts=document.querySelector('.nx-tstrip');
if(ts&&!R){var tmr=setInterval(function(){if(ts.matches(':hover'))return;if(ts.scrollLeft+ts.clientWidth>=ts.scrollWidth-10){ts.scrollTo({left:0,behavior:'smooth'});}else{ts.scrollBy({left:320,behavior:'smooth'});}},4200);}
/* contact form → workspace inbox + lead workflow */
var f=document.querySelector('.nx-form');
if(f){var ok=f.querySelector('.ok');f.addEventListener('submit',function(e){e.preventDefault();
  var btn=f.querySelector('button[type=submit]');if(btn)btn.disabled=true;
  var data={};f.querySelectorAll('input,textarea').forEach(function(i){if(i.name)data[i.name]=i.value;});
  data.event='site_lead';
  fetch('__WEBHOOK_URL__',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
  .then(function(r){return r.json();}).then(function(j){
    if(j.ok){f.style.display='none';if(ok)ok.style.display='block';}
    else{alert(j.error||'Could not send — try again.');if(btn)btn.disabled=false;}
  }).catch(function(){alert('Could not reach the server.');if(btn)btn.disabled=false;});
});}
})();`;

'''
s = s.replace(anchor, block + anchor)
print('  ✅ design system + site JS inserted')

open(P, 'w', encoding='utf-8').write(s)
print('SC-A part 1 done.')
