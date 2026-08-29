#!/usr/bin/env python3
"""Batch 2 (cycles 13-24): hero styles, animation presets, card/nav styles, 3D levels."""
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

# ── 1. HERO_STYLES + ANIM_PRESETS + CARD_STYLES + NAV_STYLES + LEVELS (before DESIGN_EXTRAS) ──
rep("""const DESIGN_EXTRAS = {""",
r'''// ════════════════════════════════════════════════════════════
// COMPONENT STYLE CATALOGS (hero / animation / card / nav / 3D)
// ════════════════════════════════════════════════════════════
const HERO_STYLES = {
  split:        { name: 'Split (text + image)', css: '', prompt: '.nx-hero-inner two-column grid' },
  center:       { name: 'Centered', css: `.nx-hero{text-align:center}.nx-hero-inner{display:block}.nx-hero p.lead{margin-left:auto;margin-right:auto}.nx-hero-actions{justify-content:center}`, prompt: '.nx-hero-inner single column, centered' },
  glass:        { name: 'Glass panel', css: `.nx-hero-inner{background:rgba(255,255,255,.05);border:1px solid var(--line);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:calc(var(--radius) + 8px);padding:56px 48px;box-shadow:0 40px 90px -40px rgba(0,0,0,.6)}`, prompt: '.nx-hero-inner glass card panel' },
  mesh:         { name: 'Gradient mesh', css: `.nx-hero::before{content:"";position:absolute;inset:-20%;z-index:0;background:radial-gradient(40% 45% at 20% 30%,rgba(247,116,42,.28),transparent 60%),radial-gradient(35% 40% at 80% 20%,rgba(47,179,162,.25),transparent 60%),radial-gradient(45% 50% at 60% 85%,rgba(91,141,239,.22),transparent 60%);filter:blur(30px);animation:meshDrift 16s ease-in-out infinite alternate}.nx-hero>*{position:relative;z-index:2}@keyframes meshDrift{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(3%,-3%,0) scale(1.08)}}`, prompt: '.nx-hero-inner (gradient mesh blobs behind)' },
  tilt3d:       { name: '3D tilt card', css: `.nx-3d-wrap{perspective:1100px}.nx-3d-card{transform-style:preserve-3d;transition:transform .25s var(--ease);will-change:transform}.nx-3d-card>*{transform:translateZ(34px)}`, prompt: '.nx-hero-inner with a .nx-3d-wrap > .nx-3d-card around the hero image (if present)' },
  particles:    { name: 'Particle field', css: `#nx-particles{position:absolute;inset:0;z-index:0;pointer-events:none}.nx-hero>*{position:relative;z-index:2}`, prompt: '.nx-hero-inner (a canvas#nx-particles sits behind automatically)' },
  parallax:     { name: 'Layered parallax', css: `.nx-pl{position:absolute;inset:0;overflow:hidden;z-index:0;pointer-events:none}.nx-pl i{position:absolute;display:block;border-radius:50%;will-change:transform}.nx-hero>*{position:relative;z-index:2}`, prompt: '.nx-hero-inner (parallax layer divs .nx-pl with <i> orbs behind)' },
  marqueebg:    { name: 'Marquee background', css: `.nx-hero{overflow:hidden}.nx-hero-bg-marquee{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;pointer-events:none;z-index:0;opacity:.08;font-weight:900;white-space:nowrap;font-size:clamp(80px,16vw,220px);color:var(--accent)}.nx-hero-bg-marquee span{animation:heroMarquee 30s linear infinite}.nx-hero>*{position:relative;z-index:2}@keyframes heroMarquee{to{transform:translateX(-50%)}}`, prompt: '.nx-hero-bg-marquee div with the business name repeated, then .nx-hero-inner' },
  kinetic:      { name: 'Kinetic type', css: `.nx-kinetic{display:inline-block}.nx-kinetic b{display:inline-block;animation:kin 3.2s var(--ease) infinite;opacity:0}.nx-kinetic b:nth-child(2){animation-delay:.22s}.nx-kinetic b:nth-child(3){animation-delay:.44s}.nx-kinetic b:nth-child(4){animation-delay:.66s}.nx-kinetic b:nth-child(5){animation-delay:.88s}.nx-kinetic b:nth-child(6){animation-delay:1.1s}.nx-kinetic b:nth-child(7){animation-delay:1.32s}.nx-kinetic b:nth-child(8){animation-delay:1.54s}@keyframes kin{0%{opacity:0;transform:translateY(18px) rotate(4deg)}30%{opacity:1;transform:none}75%{opacity:1}100%{opacity:0}}`, prompt: 'hero h1 headline with .nx-kinetic wrapping each word in <b>' },
  splitimage:   { name: 'Split + framed image', css: `.nx-hero-img img{border:1px solid var(--line);border-radius:var(--radius);box-shadow:0 40px 90px -30px rgba(0,0,0,.5)}.nx-hero-img::after{content:"";position:absolute;inset:14px -14px -14px 14px;border:2px solid var(--accent);border-radius:var(--radius);opacity:.5;z-index:-1}`, prompt: '.nx-hero-inner with .nx-hero-img (image with decorative frame)' },
  badgehero:    { name: 'Badge compact', css: `.nx-hero{padding:80px 0 60px}.nx-hero-inner{grid-template-columns:1fr;text-align:center}.nx-hero p.lead{margin:0 auto 26px}.nx-hero-actions{justify-content:center}.nx-hero h1{font-size:clamp(34px,5vw,54px)}`, prompt: '.nx-hero-inner single column centered with .nx-badge' },
  minimal:      { name: 'Minimal', css: `.nx-hero{padding:120px 0 80px}.nx-hero-inner{display:block}.nx-hero h1{font-size:clamp(40px,7vw,76px);letter-spacing:-.04em;max-width:900px}.nx-hero p.lead{font-size:19px;max-width:560px}.nx-badge{display:none}`, prompt: '.nx-hero-inner single column, huge headline, no badge' },
};
const ANIM_PRESETS = {
  fadeup:   { name: 'Fade up', css: `[data-reveal]{transform:translateY(26px)}` },
  fade:     { name: 'Fade', css: `[data-reveal]{transform:none}` },
  slideleft:{ name: 'Slide left', css: `[data-reveal]{transform:translateX(-40px)}` },
  slideright:{ name: 'Slide right', css: `[data-reveal]{transform:translateX(40px)}` },
  zoom:     { name: 'Zoom in', css: `[data-reveal]{transform:scale(.9)}` },
  blur:     { name: 'Blur in', css: `[data-reveal]{transform:translateY(18px);filter:blur(8px)}[data-reveal].in{filter:blur(0)}` },
  flip:     { name: 'Flip up', css: `[data-reveal]{transform:perspective(900px) rotateX(24deg);transform-origin:bottom}` },
  rise:     { name: 'Rise + fade', css: `[data-reveal]{transform:translateY(60px);transition-duration:.9s}` },
  pop:      { name: 'Pop', css: `[data-reveal]{transform:scale(.82) translateY(20px)}` },
  drift:    { name: 'Drift', css: `[data-reveal]{transform:translate(18px,22px)}` },
  clip:     { name: 'Clip up', css: `[data-reveal]{clip-path:inset(0 0 100% 0);transform:none;transition:clip-path .8s var(--ease)}[data-reveal].in{clip-path:inset(0 0 0 0)}` },
  none:     { name: 'None (instant)', css: `[data-reveal]{opacity:1;transform:none;transition:none}` },
};
const CARD_STYLES = {
  standard: { name: 'Standard', css: '' },
  glass:    { name: 'Glass', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:rgba(255,255,255,.06);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line)}` },
  neo:      { name: 'Neumorphic', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:var(--bg2);border:none;box-shadow:8px 8px 18px rgba(0,0,0,.22),-8px -8px 18px rgba(255,255,255,.04)}` },
  border:   { name: 'Gradient border', css: `.nx-card,.nx-stat,.nx-step,.nx-review{border:1px solid transparent;background:linear-gradient(var(--card),var(--card)) padding-box,var(--grad) border-box}` },
  lift3d:   { name: '3D lift', css: `.nx-card,.nx-stat,.nx-step{transform-style:preserve-3d}.nx-card:hover,.nx-stat:hover,.nx-step:hover{transform:perspective(900px) translateZ(22px) translateY(-8px) rotateX(2deg) rotateY(-2deg)}` },
  minimal:  { name: 'Minimal', css: `.nx-card,.nx-stat,.nx-step,.nx-review{background:transparent;border:none;border-bottom:1px solid var(--line);border-radius:0}` },
};
const NAV_STYLES = {
  glass:  { name: 'Glass', css: `.nx-nav{background:rgba(11,14,20,.6);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}` },
  solid:  { name: 'Solid', css: `.nx-nav{background:var(--bg2);backdrop-filter:none}` },
  underline: { name: 'Underline', css: `.nx-nav-links a{position:relative}.nx-nav-links a::after{content:"";position:absolute;left:0;right:0;bottom:-4px;height:2px;background:var(--grad);transform:scaleX(0);transition:transform .25s var(--ease)}.nx-nav-links a:hover::after{transform:scaleX(1)}` },
  pill:   { name: 'Pill CTA', css: `.nx-nav-links .nx-nav-cta a,.nx-nav-links a[data-cta]{background:var(--grad);color:#fff;padding:8px 18px;border-radius:999px;font-weight:700}.nx-nav-links a[data-cta]:hover{color:#fff;transform:translateY(-2px)}` },
};
const THREE_D_LEVELS = {
  off:   { name: 'Off', css: '', js: '' },
  light: { name: 'Light (CSS 3D)', css: `.nx-hero-img img,.nx-3d-card,.nx-card,.nx-stat{transform-style:preserve-3d}`, js: '' },
  full:  { name: 'Full (3D hero + particles)', css: `#nx-particles{position:absolute;inset:0;z-index:0;pointer-events:none}.nx-hero>*{position:relative;z-index:2}.nx-orb-3d{position:absolute;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle at 30% 30%,var(--accent2),var(--accent) 60%,transparent);filter:blur(6px);opacity:.5;animation:orbSpin 14s linear infinite;will-change:transform;z-index:0}.nx-hero{overflow:hidden}@keyframes orbSpin{0%{transform:rotate(0) translateX(60px) rotate(0)}100%{transform:rotate(360deg) translateX(60px) rotate(-360deg)}}`, js: `
  // 3D particle field (canvas, no external libs)
  var pc=document.getElementById('nx-particles');
  if(pc&&!R&&pc.getContext){
    var ctx=pc.getContext('2d'),W,H,pts=[];
    function ps(){W=pc.width=pc.offsetWidth;H=pc.height=pc.offsetHeight;pts=[];var n=Math.min(70,Math.floor(W/18));for(var i=0;i<n;i++)pts.push({x:Math.random()*W,y:Math.random()*H,r:Math.random()*2+0.6,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4});}
    ps();addEventListener('resize',ps,{passive:true});
    (function loop(){ctx.clearRect(0,0,W,H);for(var i=0;i<pts.length;i++){var p=pts[i];p.x+=p.vx;p.y+=p.vy;if(p.x<0||p.x>W)p.vx*=-1;if(p.y<0||p.y>H)p.vy*=-1;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle='rgba(120,160,255,.5)';ctx.fill();}requestAnimationFrame(loop);})();
  }` },
};
// build the extra CSS for chosen component styles
function componentStylesCss(opts) {
  const parts = [];
  const hero = HERO_STYLES[opts.hero_style];
  if (hero && hero.css) parts.push('/* hero:' + opts.hero_style + ' */\\n' + hero.css);
  const anim = ANIM_PRESETS[opts.anim_preset];
  if (anim && anim.css) parts.push('/* anim:' + opts.anim_preset + ' */\\n' + anim.css);
  const card = CARD_STYLES[opts.card_style];
  if (card && card.css) parts.push('/* card:' + opts.card_style + ' */\\n' + card.css);
  const nav = NAV_STYLES[opts.nav_style];
  if (nav && nav.css) parts.push('/* nav:' + opts.nav_style + ' */\\n' + nav.css);
  const t3 = THREE_D_LEVELS[opts.three_d];
  if (t3 && t3.css) parts.push('/* 3d:' + opts.three_d + ' */\\n' + t3.css);
  return parts.join('\\n');
}
function componentScriptsJs(opts) {
  const t3 = THREE_D_LEVELS[opts.three_d];
  return (t3 && t3.js) || '';
}
const DESIGN_EXTRAS = {""",
'component catalogs')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 2 inserted.')
