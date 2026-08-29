#!/usr/bin/env python3
"""Batch 3 (cycles 25-36): wire catalogs into generateSiteHtml + endpoint + persistence."""
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

# 1. generateSiteHtml: gather style opts + compose css + js + prompt hints
rep("""  const themeOpts = {
    accent: opts.accent, accent2: opts.accent2, radius: opts.radius,
    font: opts.font, animation_level: opts.animation_level,
  };""",
"""  const themeOpts = {
    accent: opts.accent, accent2: opts.accent2, radius: opts.radius,
    font: opts.font, animation_level: opts.animation_level,
  };
  const styleOpts = {
    theme_id: SITE_THEMES[opts.theme_id] ? opts.theme_id : '',
    hero_style: HERO_STYLES[opts.hero_style] ? opts.hero_style : '',
    anim_preset: ANIM_PRESETS[opts.anim_preset] ? opts.anim_preset : '',
    card_style: CARD_STYLES[opts.card_style] ? opts.card_style : '',
    nav_style: NAV_STYLES[opts.nav_style] ? opts.nav_style : '',
    three_d: THREE_D_LEVELS[opts.three_d] ? opts.three_d : 'off',
  };
  const heroHint = styleOpts.hero_style && HERO_STYLES[styleOpts.hero_style] ? ('\\nHero layout instruction: ' + HERO_STYLES[styleOpts.hero_style].prompt + '.') : '';
  const cardHint = styleOpts.card_style ? `\\nCard style: ${styleOpts.card_style} (use the standard .nx-card markup; the design applies the look).` : '';
  const navHint = styleOpts.nav_style ? `\\nNav style: ${styleOpts.nav_style} (standard .nx-nav markup; the design applies the look).` : '';
  const themeHint = styleOpts.theme_id ? `\\nTheme: ${SITE_THEMES[styleOpts.theme_id].name} (colors are automatic — do not hardcode colors).` : '';""",
'style opts')

rep("""  const css = resolveDesignCss(designId, themeOpts) + (customCss ? '\\n/* custom */\\n' + customCss : '');
  const js = SITE_JS.replace('__WEBHOOK_URL__', webhookUrl);""",
"""  const css = resolveDesignCss(designId, themeOpts)
    + (styleOpts.theme_id ? '\\n' + themeCss(styleOpts.theme_id) : '')
    + '\\n' + componentStylesCss(styleOpts)
    + (customCss ? '\\n/* custom */\\n' + customCss : '');
  const js = SITE_JS.replace('__WEBHOOK_URL__', webhookUrl)
    + componentScriptsJs(styleOpts);""",
'compose css+js')

rep("""${contentSpec}
${instructions ? 'OWNER INSTRUCTIONS (follow strictly): ' + instructions : ''}
Rules:""",
"""${contentSpec}
${instructions ? 'OWNER INSTRUCTIONS (follow strictly): ' + instructions : ''}${heroHint}${cardHint}${navHint}${themeHint}
Rules:""",
'prompt hints')

# 2. styles endpoint
rep("""  if (path === '/ai/site-designs' && req.method === 'GET') {""",
"""  if (path === '/ai/site-styles' && req.method === 'GET') {
    const cat = (obj) => Object.entries(obj).map(([id, v]) => ({ id, name: v.name }));
    return json({ themes: cat(SITE_THEMES), heroes: cat(HERO_STYLES), anims: cat(ANIM_PRESETS), cards: cat(CARD_STYLES), navs: cat(NAV_STYLES), three_d: cat(THREE_D_LEVELS), combo_count: Object.keys(SITE_THEMES).length * Object.keys(HERO_STYLES).length * Object.keys(ANIM_PRESETS).length * Object.keys(CARD_STYLES).length * Object.keys(NAV_STYLES).length * Object.keys(THREE_D_LEVELS).length }, 200, origin);
  }
  if (path === '/ai/site-designs' && req.method === 'GET') {""",
'styles endpoint')

# 3. POST site: pass style opts + persist in theme JSON
rep("""          accent: body.accent, accent2: body.accent2, font: body.font, radius: body.radius,
          animation_level: body.animation_level, sections: body.sections,
          custom_css: body.custom_css, favicon: body.favicon,
        });""",
"""          accent: body.accent, accent2: body.accent2, font: body.font, radius: body.radius,
          animation_level: body.animation_level, sections: body.sections,
          custom_css: body.custom_css, favicon: body.favicon,
          theme_id: body.theme_id, hero_style: body.hero_style, anim_preset: body.anim_preset,
          card_style: body.card_style, nav_style: body.nav_style, three_d: body.three_d,
        });""",
'POST style opts')

rep("""      const themeJson = JSON.stringify({
        accent: body.accent || '', accent2: body.accent2 || '', font: body.font || '',
        radius: body.radius || '', animation_level: body.animation_level || '',
        sections: Array.isArray(body.sections) ? body.sections : null,
        favicon: body.favicon || '',
      });""",
"""      const themeJson = JSON.stringify({
        accent: body.accent || '', accent2: body.accent2 || '', font: body.font || '',
        radius: body.radius || '', animation_level: body.animation_level || '',
        sections: Array.isArray(body.sections) ? body.sections : null,
        favicon: body.favicon || '',
        theme_id: body.theme_id || '', hero_style: body.hero_style || '', anim_preset: body.anim_preset || '',
        card_style: body.card_style || '', nav_style: body.nav_style || '', three_d: body.three_d || '',
      });""",
'POST theme persist')

# 4. PATCH regenerate: style opts
rep("""      const newTheme = { ...theme };
      ['accent', 'accent2', 'font', 'radius', 'animation_level', 'favicon'].forEach(k => { if (body[k] !== undefined) newTheme[k] = body[k]; });""",
"""      const newTheme = { ...theme };
      ['accent', 'accent2', 'font', 'radius', 'animation_level', 'favicon', 'theme_id', 'hero_style', 'anim_preset', 'card_style', 'nav_style', 'three_d'].forEach(k => { if (body[k] !== undefined) newTheme[k] = body[k]; });""",
'PATCH theme merge')

rep("""        accent: newTheme.accent, accent2: newTheme.accent2, font: newTheme.font, radius: newTheme.radius,
        animation_level: newTheme.animation_level, sections: newTheme.sections,
        custom_css: customCss, favicon: newTheme.favicon,
      });""",
"""        accent: newTheme.accent, accent2: newTheme.accent2, font: newTheme.font, radius: newTheme.radius,
        animation_level: newTheme.animation_level, sections: newTheme.sections,
        custom_css: customCss, favicon: newTheme.favicon,
        theme_id: newTheme.theme_id, hero_style: newTheme.hero_style, anim_preset: newTheme.anim_preset,
        card_style: newTheme.card_style, nav_style: newTheme.nav_style, three_d: newTheme.three_d,
      });""",
'PATCH style opts')

open(P, 'w', encoding='utf-8').write(s)
print('Batch 3 done.')
