#!/usr/bin/env node
// model:preview — headless preview of ONE manifold-js model snippet.
//
//   npm run model:preview -- <file.js> [--png <out.png>] [--json] [--size N]
//                              [--palette-file p.json] [--no-palette] [-p key=value ...]
//
// Runs <file.js> against the REAL manifold-js engine in Node (via vite SSR —
// no dev server, no browser, ~1-2s), prints a rich JSON stat block to stdout,
// and writes a 4-view PNG (front / right / top / iso).
//
// COLOR: in-code colors (api.paint.* / colored api.label) render by default.
// Figures that declare UNCOLORED labels (`.label('skin')`) and get their colors
// from a bake-time palette also render in color when a palette is found —
// `--palette-file <json>`, else a sibling `<base>.palette.json`, else
// `public/catalog/palettes/<base-without-figure_>.json`. `--no-palette` disables.
//
// PHOTO MATCH: `--match-photo ref.png [--match-crop x,y,w,h] [--match-bg #hex]
// [--match-bg-tol N] [--match-exclude base] [--match-fit box] [--match-pixel-aspect R]
// [--match-overlay o.png]` renders the model flat from the first --view angle
// (default: front) and adds a text-only likeness score under
// `stats.photoMatch` (silhouette IoU, per-band widths, per-region fit, worst[]).
// Same scorer as the browser's partwright.photoMatch (src/tools/photoMatch.ts).
//
// This is a thin back-compat wrapper: the implementation now lives in
// scripts/cli/preview.mjs and is also exposed as `partwright preview`
// (bin/partwright.mjs). See docs/headless-cli.md.
import { resolve, dirname, basename, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runPreview, createPreviewSession, composePng, explainComponents, checkExpectComponents, checkRequireLabels, resolveViews, defaultPreviewPng } from './cli/preview.mjs';
import { runPhotoMatch, parseCrop } from './cli/photoMatch.mjs';
import { NAMED_VIEWS } from './cli/views.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Resolve a label→"#rrggbb" palette so figures whose source declares UNCOLORED
// labels (`.label('skin')`) — colored from a bake-time palette — preview in
// color by default. Priority: explicit --palette-file → sibling
// `<base>.palette.json` → `public/catalog/palettes/<base-without-figure_>.json`.
// Returns the parsed object, or null (render uses in-code colors / neutral).
function resolvePalette(file, explicit, disabled) {
  if (disabled) return null;
  const load = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  if (explicit) { const p = load(resolve(explicit)); if (!p) console.error(`[palette] could not read --palette-file ${explicit}`); return p; }
  const base = basename(file).replace(/\.[^.]+$/, '');
  const sibling = join(dirname(file), `${base}.palette.json`);
  if (existsSync(sibling)) return load(sibling);
  const catalog = join(ROOT, 'public/catalog/palettes', `${base.replace(/^figure_/, '')}.json`);
  if (existsSync(catalog)) return load(catalog);
  return null;
}

function parseArgs(argv) {
  // Per-tile pixel size. Defaults high (768) for quality-control inspection —
  // defects like a jagged opening, an interpenetration, or paint/colour bleed
  // are invisible at small sizes. Bump higher (--size 1200+) when scrutinising
  // fine features (faces, eyes, lettering) and crop the PNG natively rather than
  // upscaling a small crop (which only blurs).
  const a = { params: {}, size: 768, json: false, png: null, file: null, lang: 'manifold-js', explain: false, expect: null, view: null, views: null, requireLabels: null, paletteFile: null, noPalette: false, matchPhoto: null, matchCrop: null, matchBg: null, matchBgTol: null, matchExclude: null, matchFit: null, matchOverlay: null, matchPixelAspect: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--size') a.size = parseInt(argv[++i], 10);
    else if (t === '--png') a.png = argv[++i];
    else if (t === '--lang') a.lang = argv[++i];
    else if (t === '--view') a.view = argv[++i];
    else if (t === '--views') a.views = argv[++i];
    else if (t === '--explain-components') a.explain = true;
    else if (t === '--expect-components') a.expect = argv[++i];
    else if (t === '--require-labels') a.requireLabels = argv[++i];
    else if (t === '--palette-file') a.paletteFile = argv[++i];
    else if (t === '--no-palette') a.noPalette = true;
    else if (t === '--match-photo') a.matchPhoto = argv[++i];
    else if (t === '--match-crop') a.matchCrop = argv[++i];
    else if (t === '--match-bg') a.matchBg = argv[++i];
    else if (t === '--match-bg-tol') a.matchBgTol = Number(argv[++i]);
    else if (t === '--match-exclude') a.matchExclude = argv[++i];
    else if (t === '--match-fit') a.matchFit = argv[++i];
    else if (t === '--match-overlay') a.matchOverlay = argv[++i];
    else if (t === '--match-pixel-aspect') a.matchPixelAspect = Number(argv[++i]);
    else if (t === '-p' || t === '--param') { const [k, ...v] = argv[++i].split('='); a.params[k] = coerce(v.join('=')); }
    else if (!a.file && !t.startsWith('-')) a.file = t;
  }
  return a;
}
function coerce(s) { if (s === 'true') return true; if (s === 'false') return false; const n = Number(s); return Number.isNaN(n) ? s : n; }

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.file) { console.error('Usage: npm run model:preview -- <file.js> [--png out.png] [--json] [--size N] [--view "az,el[;az,el…]"] [--views front,iso,…] [--explain-components] [--expect-components N] [--require-labels a,b,c] [--palette-file p.json] [--no-palette] [-p k=v] [--match-photo ref.png [--match-crop x,y,w,h] [--match-bg #rrggbb] [--match-bg-tol N] [--match-exclude base,…] [--match-fit height|box] [--match-pixel-aspect R] [--match-overlay out.png]]'); process.exit(2); }
  const file = resolve(a.file);
  const { views, error: viewErr } = resolveViews(a.view, a.views);
  if (viewErr) { console.error(viewErr); process.exit(2); }
  const palette = resolvePalette(file, a.paletteFile, a.noPalette);
  const { crop: matchCrop, error: cropErr } = parseCrop(a.matchCrop);
  if (cropErr) { console.error(cropErr); process.exit(2); }
  if (a.matchBgTol !== null && !Number.isFinite(a.matchBgTol)) { console.error('--match-bg-tol expects a number.'); process.exit(2); }
  if (a.matchPixelAspect !== null && !(a.matchPixelAspect > 0)) { console.error('--match-pixel-aspect expects a positive number.'); process.exit(2); }
  if (a.matchFit !== null && a.matchFit !== 'height' && a.matchFit !== 'box') { console.error('--match-fit expects "height" or "box".'); process.exit(2); }
  let result;
  if (a.matchPhoto) {
    // Keep the SSR session open past the preview so the photo-match scorer can
    // load through it (one server boot for both).
    const session = await createPreviewSession();
    try {
      result = await session.preview(readFileSync(file, 'utf8'), { params: a.params, lang: a.lang, palette });
      if (result.ok && result.render) {
        // Camera: the first --view/--views angle, else the named front view.
        const view = views ? views[0] : { name: 'front', ...NAMED_VIEWS.front };
        result.stats.photoMatch = await runPhotoMatch(session, result.render, {
          photo: resolve(a.matchPhoto), crop: matchCrop, bg: a.matchBg, bgTolerance: a.matchBgTol,
          exclude: a.matchExclude ? a.matchExclude.split(',').map((s) => s.trim()).filter(Boolean) : [],
          view, fit: a.matchFit, pixelAspect: a.matchPixelAspect, debugPng: a.matchOverlay ? resolve(a.matchOverlay) : null,
        });
      }
    } finally {
      await session.close();
    }
  } else {
    result = await runPreview(file, { params: a.params, lang: a.lang, palette });
  }

  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, error: result.error, diagnostics: result.diagnostics }, null, 2));
    process.exit(1);
  }

  let pngPath = null;
  // Render the PNG unless --json was passed WITHOUT an explicit --png. (An
  // explicit --png always wins, so `--json --png out.png` writes both — agents
  // kept losing the image when they wanted stats and a picture together.)
  if (result.render && (!a.json || a.png)) {
    pngPath = a.png ? resolve(a.png) : defaultPreviewPng(file);
    const img = composePng(result.render.positions, result.render.triVerts, result.render.triColors, result.render.bbox, a.size, views || undefined);
    await img.toFile(pngPath);
  }
  console.log(JSON.stringify({ ok: true, png: pngPath, stats: result.stats }, (_k, v) => (ArrayBuffer.isView(v) ? undefined : v), 2));

  if (a.explain) console.error(explainComponents(result.stats));
  const expectErr = checkExpectComponents(result.stats, a.expect);
  if (expectErr) { console.error(expectErr); process.exit(1); }
  const reqErr = checkRequireLabels(result.stats, a.requireLabels);
  if (reqErr) { console.error(reqErr); process.exit(1); }
}
main().catch((e) => { console.error('model:preview failed:', e?.stack || e?.message || e); process.exit(1); });
