// Rasterise a composition summary of each direction WITHOUT a browser.
// Not a pixel screenshot (no layout engine is installable here) — but every
// colour, font pairing, radius, hero geometry, feature geometry, headline and
// section order is READ FROM THE REAL GENERATED OUTPUT. An earlier version drew
// one fixed card for all six, which flattered the result by hiding exactly the
// structural differences being claimed.
import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { parseHTML } from 'linkedom';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'CYCLE2_evidence', 'six_directions');
const DIRS = ['signal-industrial', 'editorial-minimal', 'cinematic-immersive', 'luxury-art', 'bold-experimental', 'swiss-structured'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cards = DIRS.map((d) => {
  const html = readFileSync(join(DIR, d + '.html'), 'utf8');
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  const v = (n) => { const m = new RegExp('--' + n + ':([^;]+)').exec(css); return m ? m[1].trim() : ''; };
  const doc = parseHTML(html).document;
  const heroKind = ((doc.querySelector('.c-hero') || {}).className || '').match(/c-hero-(\w+)/)?.[1] || 'split';
  const featKind = ((doc.querySelector('.c-feature') || {}).className || '').match(/c-feature-(\w+)/)?.[1] || 'grid';
  const cta = [...doc.querySelectorAll('.c-btn')].map((e) => e.textContent.trim()).filter(Boolean)[0] || 'Start';
  const secs = [...doc.querySelectorAll('main > *')].map((e) => e.getAttribute('id') || (e.className || '').split(/\s+/)[0].replace('c-', '')).filter(Boolean);
  return { d, bg: v('bg') || '#111', surf: v('surf') || '#222', text: v('text') || '#eee', muted: v('muted') || '#999',
    accent: v('accent') || '#f60', rad: parseFloat(v('rad-sm')) || 0, heroKind, featKind, cta,
    disp: v('disp').replace(/['"]/g, '').split(',')[0], body: v('font').replace(/['"]/g, '').split(',')[0],
    h1: ((doc.querySelector('h1') || {}).textContent || '').trim(), secs: secs.slice(0, 8) };
});
const CW = 470, CH = 460, GAP = 22, PAD = 30, W = PAD * 2 + CW * 3 + GAP * 2;
function btn(c, x, y) {
  const r = Math.min(c.rad, 17);
  return `<rect x="${x}" y="${y}" width="132" height="34" rx="${r}" fill="${c.accent}"/><text x="${x + 66}" y="${y + 22}" text-anchor="middle" font-family="${esc(c.body)},sans-serif" font-size="11" font-weight="700" fill="${c.bg}">${esc(c.cta.slice(0, 18))}</text>`;
}
function heroArt(c) {
  const T = c.text, M = c.muted, S = c.surf, A = c.accent, r = Math.min(c.rad, 18);
  const h1 = esc(c.h1.slice(0, 26));
  switch (c.heroKind) {
    case 'aurora': return `<circle cx="120" cy="92" r="88" fill="${A}" opacity=".20"/><circle cx="336" cy="62" r="66" fill="${A}" opacity=".12"/>
      <g opacity=".16">${[0,1,2,3,4].map(i=>`<line x1="${20+i*92}" y1="56" x2="${20+i*92}" y2="200" stroke="${T}" stroke-width=".8"/>`).join('')}</g>
      <text x="24" y="104" font-family="${esc(c.disp)},sans-serif" font-size="24" font-weight="700" fill="${T}">${h1}</text>
      <rect x="24" y="118" width="248" height="6" rx="3" fill="${M}" opacity=".5"/>${btn(c,24,140)}
      ${[['40+','Years'],['4','Counties']].map((s,i)=>`<text x="${24+i*112}" y="200" font-family="${esc(c.disp)}" font-size="19" font-weight="700" fill="${T}">${s[0]}</text><text x="${24+i*112}" y="214" font-family="monospace" font-size="8" fill="${M}">${s[1]}</text>`).join('')}`;
    case 'fullbleed': return `<rect x="0" y="44" width="${CW}" height="186" fill="${S}"/><rect x="0" y="44" width="${CW}" height="186" fill="${A}" opacity=".14"/>
      <text x="${CW/2}" y="128" text-anchor="middle" font-family="${esc(c.disp)},serif" font-size="24" font-weight="700" fill="${T}">${h1}</text>
      <rect x="${CW/2-110}" y="146" width="220" height="6" rx="3" fill="${M}" opacity=".55"/>${btn(c,CW/2-66,168)}`;
    case 'editorial': return `<text x="24" y="100" font-family="${esc(c.disp)},serif" font-size="24" font-weight="700" fill="${T}">${h1}</text>
      <line x1="24" y1="116" x2="${CW-24}" y2="116" stroke="${A}" stroke-width="2"/>
      <rect x="24" y="132" width="200" height="6" rx="3" fill="${M}" opacity=".5"/><rect x="24" y="146" width="158" height="6" rx="3" fill="${M}" opacity=".35"/>
      ${btn(c,24,166)}<rect x="${CW-172}" y="128" width="148" height="86" rx="${r}" fill="${S}" stroke="${A}" stroke-opacity=".3"/>`;
    case 'minimal': return `<text x="${CW/2}" y="118" text-anchor="middle" font-family="${esc(c.disp)},serif" font-size="25" font-weight="700" fill="${T}">${h1}</text>
      <rect x="${CW/2-100}" y="136" width="200" height="6" rx="3" fill="${M}" opacity=".45"/>${btn(c,CW/2-66,164)}`;
    case 'overlap': return `<rect x="${CW-190}" y="60" width="170" height="152" rx="${r}" fill="${A}" opacity=".92"/>
      <rect x="16" y="96" width="272" height="114" rx="${r}" fill="${S}" stroke="${T}" stroke-opacity=".18"/>
      <text x="32" y="132" font-family="${esc(c.disp)},sans-serif" font-size="21" font-weight="800" fill="${T}">${esc(c.h1.slice(0,20))}</text>
      <rect x="32" y="146" width="180" height="6" rx="3" fill="${M}" opacity=".5"/>${btn(c,32,166)}`;
    default: return `<text x="24" y="100" font-family="${esc(c.disp)},sans-serif" font-size="24" font-weight="700" fill="${T}">${h1}</text>
      <rect x="24" y="118" width="208" height="6" rx="3" fill="${M}" opacity=".5"/><rect x="24" y="132" width="168" height="6" rx="3" fill="${M}" opacity=".35"/>
      ${btn(c,24,156)}<rect x="${CW-188}" y="62" width="164" height="152" rx="${r}" fill="${S}" stroke="${T}" stroke-opacity=".16"/>`;
  }
}
function featArt(c) {
  const y = 244, A = c.accent, T = c.text, M = c.muted, S = c.surf, r = Math.min(c.rad, 14);
  const cell = (x, w, h, yy) => `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${r}" fill="${S}" stroke="${T}" stroke-opacity=".12"/><rect x="${x+12}" y="${yy+14}" width="24" height="4" rx="2" fill="${A}"/><rect x="${x+12}" y="${yy+28}" width="${w-44}" height="6" rx="3" fill="${T}" opacity=".75"/><rect x="${x+12}" y="${yy+42}" width="${w-64}" height="5" rx="2.5" fill="${M}" opacity=".45"/>`;
  switch (c.featKind) {
    case 'spec': return [0,1,2].map(i=>`<line x1="24" y1="${y+i*32}" x2="${CW-24}" y2="${y+i*32}" stroke="${T}" stroke-opacity=".14"/><text x="24" y="${y+22+i*32}" font-family="monospace" font-size="10" fill="${A}">0${i+1}</text><rect x="60" y="${y+14+i*32}" width="96" height="7" rx="3.5" fill="${T}" opacity=".8"/><rect x="176" y="${y+15+i*32}" width="${CW-210}" height="6" rx="3" fill="${M}" opacity=".45"/>`).join('') + `<line x1="24" y1="${y+96}" x2="${CW-24}" y2="${y+96}" stroke="${T}" stroke-opacity=".14"/>`;
    case 'bento': return cell(24,270,102,y)+cell(302,144,48,y)+cell(302,144,48,y+54);
    case 'edlist': return [0,1,2].map(i=>`<rect x="24" y="${y+i*34}" width="3" height="24" fill="${A}"/><rect x="38" y="${y+4+i*34}" width="120" height="7" rx="3.5" fill="${T}" opacity=".8"/><rect x="38" y="${y+16+i*34}" width="${CW-180}" height="5" rx="2.5" fill="${M}" opacity=".4"/>`).join('');
    case 'alternating': return [0,1].map(i=>`<rect x="${i ? 24 : CW-190}" y="${y+i*56}" width="166" height="46" rx="${r}" fill="${A}" opacity="${i?.75:.9}"/><rect x="${i?206:24}" y="${y+10+i*56}" width="140" height="7" rx="3.5" fill="${T}" opacity=".8"/><rect x="${i?206:24}" y="${y+24+i*56}" width="110" height="5" rx="2.5" fill="${M}" opacity=".4"/>`).join('');
    case 'ruled': return [0,1,2].map(i=>`<line x1="${24+i*((CW-48)/3)}" y1="${y}" x2="${24+i*((CW-48)/3)}" y2="${y+96}" stroke="${T}" stroke-opacity=".18"/><rect x="${36+i*((CW-48)/3)}" y="${y+14}" width="22" height="4" rx="2" fill="${A}"/><rect x="${36+i*((CW-48)/3)}" y="${y+30}" width="${(CW-48)/3-40}" height="6" rx="3" fill="${T}" opacity=".78"/><rect x="${36+i*((CW-48)/3)}" y="${y+44}" width="${(CW-48)/3-56}" height="5" rx="2.5" fill="${M}" opacity=".42"/>`).join('') + `<line x1="24" y1="${y}" x2="${CW-24}" y2="${y}" stroke="${T}" stroke-opacity=".22"/>`;
    default: return [0,1,2].map(i=>cell(24+i*((CW-48-24)/3+12),(CW-48-24)/3,96,y)).join('');
  }
}
let svg = '', x = PAD, yy = PAD, i = 0;
for (const c of cards) {
  if (i && i % 3 === 0) { yy += CH + GAP; x = PAD; }
  svg += `<g transform="translate(${x},${yy})"><rect width="${CW}" height="${CH}" rx="14" fill="${c.bg}" stroke="#242a35"/>
    <rect x="0" y="0" width="${CW}" height="44" fill="${c.surf}"/><rect x="0" y="0" width="${CW}" height="14" rx="14" fill="${c.surf}"/>
    <circle cx="20" cy="22" r="5" fill="${c.accent}"/>
    <text x="36" y="27" font-family="${esc(c.disp)},sans-serif" font-size="13" font-weight="700" fill="${c.text}">${esc(c.d)}</text>
    <text x="${CW-14}" y="27" text-anchor="end" font-family="monospace" font-size="9.5" fill="${c.muted}">${esc(c.heroKind)} · ${esc(c.featKind)}</text>
    ${heroArt(c)}${featArt(c)}
    <text x="24" y="${CH-52}" font-family="monospace" font-size="9" fill="${c.muted}">${esc(c.disp)} / ${esc(c.body)}</text>
    <text x="24" y="${CH-38}" font-family="monospace" font-size="8.5" fill="${c.muted}">${esc(c.secs.join(' → ').slice(0,68))}</text>
    <g transform="translate(24,${CH-30})">${[c.bg,c.surf,c.text,c.muted,c.accent].map((col,k)=>`<rect x="${k*26}" y="0" width="22" height="22" rx="5" fill="${col}" stroke="#3a3a3a" stroke-width=".6"/>`).join('')}</g></g>`;
  x += CW + GAP; i++;
}
const H = yy + CH + PAD;
const out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0a0c11"/>${svg}</svg>`;
writeFileSync(join(DIR, 'preview.png'), new Resvg(out, { fitTo: { mode: 'width', value: W } }).render().asPng());
console.log('wrote preview.png');
