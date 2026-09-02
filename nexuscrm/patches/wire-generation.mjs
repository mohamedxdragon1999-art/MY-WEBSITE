// One-shot wiring patch 2: scene preview text + local site generation with scenes.
import { readFileSync, writeFileSync } from 'node:fs';
const P = 'NexusCRM_V4_Hardened.html';
let h = readFileSync(P, 'utf8');

// ── 1) previewScene: bake the scene words into the preview iframe ──
// (inserted lines contain literal ${...} template syntax of the APP, so build
// them by concatenation, not with template literals)
const prevAnchor = `      function boot3(){var THREE=window.THREE;var scene=new THREE.Scene();var cam=new THREE.PerspectiveCamera(55,host.offsetWidth/Math.max(1,host.offsetHeight),0.1,2000);`;
if (!h.includes(prevAnchor)) { console.error('❌ preview boot anchor not found'); process.exit(1); }
const textLine = '      window.NX_SCENE_TEXT=${JSON.stringify((V(\'ws-scene-text\')?.value||\'\').slice(0,30))};';
h = h.replace(prevAnchor, textLine + '\n' + prevAnchor);

const bodyOld = '      ${code.body}\n      var t0=performance.now();';
if (!h.includes(bodyOld)) { console.error('❌ preview body anchor not found'); process.exit(1); }
const bodyNew = "      ${code.body.replace(/'__NXTX__'/g, JSON.stringify((V('ws-scene-text')?.value||'').slice(0,30)))}\n      var t0=performance.now();";
h = h.replace(bodyOld, bodyNew);

// ── 2) local site generation with a real embedded 3D scene ──
const localHtmlAnchor = 'const SITE_LOCAL_HTML = (name, desc) => `';
if (!h.includes(localHtmlAnchor)) { console.error('❌ SITE_LOCAL_HTML anchor not found'); process.exit(1); }

const sceneSiteFn = [
'// Local site WITH a real 3D scene behind the hero (works with zero backend —',
'// the same 50 Spline Community scenes the picker offers). Text scenes bake',
"// the owner's words in at generation time.",
'function nxLocalSceneSiteHtml(name, desc, sceneId, sceneText, accent) {',
'  const sc = SPLINE_SCENES[sceneId];',
'  const base = SITE_LOCAL_HTML(name, desc);',
'  if (!sc) return base;',
"  let body = sc.body.replace(/'__NXTX__'/g, JSON.stringify(String(sceneText||'').slice(0,30)));",
'  const sceneScript = [',
'"(function(){"',
'"var mm=function(q){try{return (typeof matchMedia!==\'undefined\')?matchMedia(q).matches:false;}catch(e){return false;}};"',
'"if(mm(\'(prefers-reduced-motion: reduce)\'))return;"',
'"var host=document.querySelector(\'.nx-scene-host\');if(!host)return;"',
'"try{var _c=document.createElement(\'canvas\');if(!(window.WebGLRenderingContext&&(_c.getContext(\'webgl\')||_c.getContext(\'experimental-webgl\')))){return;}}catch(e){return;}"',
'"function boot(){"',
'"var THREE=window.THREE;"',
'"var scene=new THREE.Scene();var cam=new THREE.PerspectiveCamera(55,host.offsetWidth/Math.max(1,host.offsetHeight),0.1,2000);"',
'"var renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));renderer.setSize(host.offsetWidth,host.offsetHeight);host.appendChild(renderer.domElement);renderer.domElement.style.cssText=\'position:absolute;inset:0;width:100%;height:100%\';"',
'"function resize(){renderer.setSize(host.offsetWidth,host.offsetHeight);cam.aspect=host.offsetWidth/Math.max(1,host.offsetHeight);cam.updateProjectionMatrix();}addEventListener(\'resize\',resize,{passive:true});"',
'"var ac=new THREE.Color(\'"+(accent||"#f7742a")+"\'),a2=new THREE.Color(\'#c4b5fd\'),t3=new THREE.Color(\'#22d3ee\');"',
'""+body+"',
'"var t0=performance.now();"',
'"(function anim(now){var t=(now-t0)/1000;"+sc.tick+"renderer.render(scene,cam);requestAnimationFrame(anim);})(t0);}"',
'"if(window.THREE)boot();else{var s=document.createElement(\'script\');s.src=\'https://unpkg.com/three@0.160.0/build/three.min.js\';s.onload=boot;document.head.appendChild(s);}"',
'"})();"',
'].join("\\n");',
'  return base',
'    .replace(\'<style>\', "<style>header{position:relative;background:#0b0e14!important;overflow:hidden}.nx-scene-host{position:absolute;inset:0;z-index:0;pointer-events:none}header h1,header p,header .btn{position:relative;z-index:2}")',
'    .replace(\'<header>\', \'<header><div class="nx-scene-host"></div>\')',
'    .replace(\'</body>\', \'<script>\' + sceneScript + \'</\' + \'script></body>\');',
'}',
'',
].join('\n');

h = h.replace(localHtmlAnchor, sceneSiteFn + localHtmlAnchor);

// ── 3) buildSiteWithAI: read the words input + send scene_text + scene fallback ──
const readAnchor = `  let sceneId = V('ws-scene')?.value || '';
  if (sceneId === '__spline') sceneId = '';`;
if (!h.includes(readAnchor)) { console.error('❌ sceneId anchor not found'); process.exit(1); }
h = h.replace(readAnchor, readAnchor + `
  const sceneText = (V('ws-scene-text')?.value || '').trim().slice(0,30);`);

const postAnchor = `theme_id:themeId, hero_style:heroStyle, anim_preset:animPreset, card_style:cardStyle, nav_style:navStyle, three_d:threeD,
        scene_id:sceneId, spline_url:splineUrl, concept_id:conceptId});`;
if (!h.includes(postAnchor)) { console.error('❌ POST body anchor not found'); process.exit(1); }
h = h.replace(postAnchor, `theme_id:themeId, hero_style:heroStyle, anim_preset:animPreset, card_style:cardStyle, nav_style:navStyle, three_d:threeD,
        scene_id:sceneId, spline_url:splineUrl, concept_id:conceptId, scene_text:sceneText});`);

const fallbackAnchor = `      site = { id: 0, slug: 'local-' + Math.random().toString(36).slice(2,8), html: SITE_LOCAL_HTML(name, desc), published: false, name };
      toast('AI unavailable — saved a starter template instead. Connect the backend + an AI key for AI-built sites.','warning',7000);`;
if (!h.includes(fallbackAnchor)) { console.error('❌ fallback anchor not found'); process.exit(1); }
h = h.replace(fallbackAnchor, `      site = { id: 0, slug: 'local-' + Math.random().toString(36).slice(2,8), html: nxLocalSceneSiteHtml(name, desc, sceneId, sceneText, accent), published: false, name };
      toast(sceneId ? 'Website saved — with your chosen 3D scene behind the hero. (Connect the backend + an AI key for AI-written content.)' : 'AI unavailable — saved a starter template instead. Connect the backend + an AI key for AI-built sites.','warning',7000);`);

writeFileSync(P, h);
console.log('✓ preview words + local scene-site generation wired');
