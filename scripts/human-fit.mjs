#!/usr/bin/env node
// Fit api.human's body sliders (and arm/leg spread) to a photo's silhouette.
//
//   npm run human:fit -- --photo person.png [--photo side.png@0,0] \
//       [--base base.json] [--fit gender,weight,…] [--budget 60] \
//       [--out fitted.js] [--png fitted.png] [--match-bg #rrggbb] [--match-mask m.png]
//
// --base: a JSON file of api.human options to start from and keep (hair, wear,
//   style, …) — fit only changes the sliders it searches.
// --fit: which dimensions to search (default: what a front photo constrains;
//   see FIT_DIMS in src/human/humanFit.ts for every name).
// A photo is matched from the front unless it carries a camera (`@az,el` or
// `@front|back|left|right`), exactly like model:preview's --match-photo.
//
// Prints JSON: the score, the fitted values, the evaluation count, and the
// code path; writes the fitted model source to --out and a 4-view PNG to --png.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPreviewSession, composePng } from './cli/preview.mjs';
import { parsePhotoSpec } from './cli/photoMatch.mjs';
import { renderRegionImage } from './cli/preview.mjs';
import sharp from 'sharp';
import { NAMED_VIEWS } from './cli/views.mjs';

/** Largest horizontal re-alignment tried, as a fraction of the canvas width. */
const FIT_MAX_SHIFT = 0.12;

async function loadRgba(path) {
  const { data, info } = await sharp(path).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

function parseArgs(argv) {
  const a = { photos: [], base: null, fit: null, budget: 120, out: null, png: null, bg: null, mask: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--photo') a.photos.push(argv[++i]);
    else if (t === '--base') a.base = argv[++i];
    else if (t === '--fit') a.fit = argv[++i];
    else if (t === '--budget') a.budget = Number(argv[++i]);
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--png') a.png = argv[++i];
    else if (t === '--match-bg') a.bg = argv[++i];
    else if (t === '--match-mask') a.mask = argv[++i];
    else { console.error(`unknown argument ${t}`); process.exit(2); }
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.photos.length) {
    console.error('Usage: npm run human:fit -- --photo person.png [--photo side.png@0,0] [--base base.json] [--fit gender,weight,…] [--budget 60] [--out fitted.js] [--png fitted.png] [--match-bg #hex] [--match-mask mask.png]');
    process.exit(2);
  }
  if (!(a.budget >= 2 && a.budget <= 1000)) { console.error('--budget expects 2–1000 evaluations.'); process.exit(2); }
  const views = a.photos.map((p, i) => {
    const spec = parsePhotoSpec(p);
    if (spec.error) { console.error(spec.error); process.exit(2); }
    return { photo: resolve(spec.path), view: spec.view ?? { name: 'front', ...NAMED_VIEWS.front }, crop: null, bg: a.bg, mask: i === 0 && a.mask ? resolve(a.mask) : null, pixelAspect: null, debugPng: null };
  });
  const base = a.base ? JSON.parse(readFileSync(resolve(a.base), 'utf8')) : {};

  const session = await createPreviewSession();
  try {
    const fit = await session.load('/src/human/humanFit.ts');
    const names = a.fit ? a.fit.split(',').map((s) => s.trim()).filter(Boolean) : fit.DEFAULT_FIT;
    const unknown = names.filter((n) => !fit.FIT_DIMS[n]);
    if (unknown.length) { console.error(`unknown --fit dimension(s): ${unknown.join(', ')}. Known: ${Object.keys(fit.FIT_DIMS).join(', ')}`); process.exit(2); }
    const dims = names.map((n) => fit.FIT_DIMS[n]);
    let lastRender = null;
    // The photo-match scorer segments each photo and normalises both
    // silhouettes; the fit scores them by IoU re-aligned over a small shift.
    const pm = await session.load('/src/tools/photoMatch.ts');
    const { getConfig } = await session.load('/src/config/appConfig.ts');
    const cfg = getConfig().import;
    const tuning = pm.photoMatchTuningFromConfig(cfg);
    const size = cfg.photoMatchRenderSize;
    const photos = await Promise.all(views.map(async (v) => ({ ...v, reference: await loadRgba(v.photo), maskImg: v.mask ? await loadRgba(v.mask) : null })));
    const evaluate = async (values) => {
      const code = fit.humanCode(fit.applyDims(base, dims, values));
      const r = await session.preview(code);
      if (!r.ok || !r.render) return -1;
      const numTri = r.render.triVerts.length / 3;
      let total = 0;
      for (const v of photos) {
        const img = renderRegionImage(r.render.positions, r.render.triVerts, new Int32Array(numTri), size, v.view);
        const rgba = new Uint8ClampedArray(size * size * 4);
        for (let p = 0; p < size * size; p++) { const c = img.labels[p] >= 0 ? 90 : 255; rgba[p * 4] = c; rgba[p * 4 + 1] = c; rgba[p * 4 + 2] = c; rgba[p * 4 + 3] = 255; }
        const res = pm.photoMatch({
          reference: v.reference, crop: null, bg: v.bg ?? null, bgTolerance: null, mask: v.maskImg, bgMode: 'auto',
          model: { width: size, height: size, data: rgba }, modelLabels: img.labels,
          regions: [{ name: 'body', color: '#5a5a5a' }], merge: [], ignore: [], fit: 'height', pixelAspect: null, debug: true, tuning,
        });
        const d = res.debug;
        total += fit.shiftedIoU(d.photo, d.model, d.width, d.height, Math.round(d.width * FIT_MAX_SHIFT));
      }
      return total / photos.length;
    };
    const t0 = Date.now();
    const result = await fit.fitCoordinateDescent(dims, fit.startValues(base, dims), evaluate, {
      budget: a.budget,
      onStep: (s) => console.error(`score ${s.score.toFixed(4)}  ${dims.map((d, i) => `${d.key}=${s.values[i]}`).join(' ')}`),
    });
    const options = fit.applyDims(base, dims, result.values);
    const code = fit.humanCode(options);
    const outPath = resolve(a.out ?? 'human-fit.js');
    writeFileSync(outPath, code);
    let pngPath = null;
    if (a.png) {
      const r = await session.preview(code);
      lastRender = r.render;
      pngPath = resolve(a.png);
      await composePng(lastRender.positions, lastRender.triVerts, lastRender.triColors, lastRender.bbox, 768).toFile(pngPath);
    }
    console.log(JSON.stringify({
      ok: true, score: Number(result.score.toFixed(4)), evaluations: result.evaluations,
      seconds: Math.round((Date.now() - t0) / 1000),
      fitted: Object.fromEntries(dims.map((d, i) => [d.key, result.values[i]])),
      code: outPath, png: pngPath,
    }, null, 2));
  } finally {
    await session.close();
  }
}
main().catch((e) => { console.error('human:fit failed:', e?.stack || e?.message || e); process.exit(1); });
