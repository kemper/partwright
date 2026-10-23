// `model:preview --match-photo ref.png` — the headless twin of the browser's
// `partwright.photoMatch()`. Renders the previewed model FLAT (region index per
// pixel, no lighting) from the requested camera with the same orthographic
// (az, el) conventions as the preview PNG, then scores it against the photo
// with the SAME pure module the browser uses (src/tools/photoMatch.ts, loaded
// through the preview session's Vite SSR server). Output is text-only JSON so
// an agent can check likeness without spending image tokens.
//
// Several `--match-photo` flags score several views from ONE model build
// (`front.png@0,0 --match-photo back.png@180,0`).
import { existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import sharp from 'sharp';
import { renderRegionImage } from './preview.mjs';
import { NAMED_VIEWS } from './views.mjs';

/** Parse `--match-crop x,y,w,h` → {x,y,w,h} | {error}. */
export function parseCrop(s) {
  if (s == null || s === '') return { crop: null };
  const p = String(s).split(',').map((v) => Number(v.trim()));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) {
    return { error: `--match-crop expects "x,y,w,h" (pixels, w/h > 0), got "${s}".` };
  }
  return { crop: { x: p[0], y: p[1], w: p[2], h: p[3] } };
}

/** Parse one `--match-photo` value: `path`, `path@az,el` or `path@<named view>`
 *  (front/back/left/right/top/bottom/iso, CLI frame). The `@…` suffix only
 *  counts when it parses as a camera AND the whole string isn't itself an
 *  existing file — so `photo@2x.png` stays a path.
 *  → { path, view: {name, az, el} | null } | { error }. */
export function parsePhotoSpec(s, exists = existsSync) {
  const str = String(s);
  const at = str.lastIndexOf('@');
  if (at > 0 && !exists(str)) {
    const path = str.slice(0, at), cam = str.slice(at + 1).trim();
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(cam);
    if (m) return { path, view: { name: `${Number(m[1])},${Number(m[2])}`, az: Number(m[1]), el: Number(m[2]) } };
    if (NAMED_VIEWS[cam]) return { path, view: { name: cam, ...NAMED_VIEWS[cam] } };
    if (!/\.[a-z0-9]+$/i.test(cam)) return { error: `--match-photo "${str}": "@${cam}" is neither "az,el" nor a view name (${Object.keys(NAMED_VIEWS).join(', ')}).` };
  }
  return { path: str, view: null };
}

/** Parse `--match-merge` values (repeatable; each may hold several groups
 *  separated by ';', members by '+' or ',') → string[][]. */
export function parseMergeGroups(values) {
  const groups = [];
  for (const v of values ?? []) {
    for (const g of String(v).split(';')) {
      const members = g.split(/[+,]/).map((s) => s.trim()).filter(Boolean);
      if (members.length) groups.push(members);
    }
  }
  return groups;
}

/** Pair a per-view flag's values with the photos: none → null for each, one →
 *  broadcast (unless `broadcast` is false and there are several photos), N →
 *  paired by position. → { values } | { error }. */
export function pairPerView(values, n, flag, broadcast = true) {
  if (!values || !values.length) return { values: Array(n).fill(null) };
  if (values.length === n) return { values };
  if (values.length === 1 && (broadcast || n === 1)) return { values: Array(n).fill(values[0]) };
  return { error: `${flag} was given ${values.length}× for ${n} --match-photo — pass it once${broadcast ? ' (applies to every photo)' : ''} or once per photo, in the same order.` };
}

async function loadRgba(path) {
  const { data, info } = await sharp(path).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/**
 * Score the previewed model against one or more photos (one model build).
 * @param session   a createPreviewSession() handle (its `load` gives SSR access)
 * @param render    PreviewResult.render (positions/triVerts/triColors/triLabel/labelNames)
 * @param opts      { views: [{ photo, view: {name, az, el}, crop?, bg?, mask?, debugPng? }],
 *                    bgTolerance?, bgMode?, exclude?: string[], merge?: string[][], ignore?: string[],
 *                    bands?: number, fit?: 'height'|'box', pixelAspect?: number }
 * @returns { results: [...per-view], combined | null }
 */
export async function runPhotoMatch(session, render, opts) {
  const pm = await session.load('/src/tools/photoMatch.ts');
  const { getConfig } = await session.load('/src/config/appConfig.ts');
  const cfg = getConfig().import; // Node has no localStorage → the shipped defaults
  const tuning = { ...pm.photoMatchTuningFromConfig(cfg), ...(opts.bands ? { bands: opts.bands } : {}) };

  const numTri = render.triVerts.length / 3;
  const { regions, triRegion } = pm.buildTriangleRegions(numTri, render.triColors, render.triLabel ?? null, render.labelNames ?? [], opts.exclude ?? []);
  const size = cfg.photoMatchRenderSize;
  const cols = regions.map((r) => pm.parseColor(r.color) ?? [170, 170, 170]);
  const unknownExcl = (opts.exclude ?? []).filter((n) => !(render.labelNames ?? []).includes(n) && !regions.some((r) => r.name === n));

  const results = [];
  for (const v of opts.views) {
    const reference = await loadRgba(v.photo);
    const mask = v.mask ? await loadRgba(v.mask) : null;
    const img = renderRegionImage(render.positions, render.triVerts, triRegion, size, v.view);
    // RGBA twin of the label buffer (region colours on a neutral backdrop); the
    // exact labels drive the score, the RGBA only documents the render.
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let p = 0; p < size * size; p++) {
      const l = img.labels[p];
      const c = l >= 0 ? cols[l] : l === -1 ? [170, 170, 170] : [255, 0, 255];
      rgba[p * 4] = c[0]; rgba[p * 4 + 1] = c[1]; rgba[p * 4 + 2] = c[2]; rgba[p * 4 + 3] = 255;
    }
    const result = pm.photoMatch({
      reference,
      crop: v.crop ?? null,
      bg: v.bg ?? null,
      bgTolerance: opts.bgTolerance ?? null,
      mask,
      bgMode: opts.bgMode ?? 'auto',
      model: { width: size, height: size, data: rgba },
      modelLabels: img.labels,
      // Colourless regions (uncoloured labels with no palette) still count toward
      // the silhouette; the scorer skips them for the colour/region analysis.
      regions,
      merge: opts.merge ?? [],
      ignore: opts.ignore ?? [],
      fit: opts.fit === 'box' ? 'box' : 'height',
      pixelAspect: opts.pixelAspect ?? null,
      debug: !!v.debugPng,
      tuning,
    });
    // Optional checkpoint image: photo regions | model regions | silhouette diff.
    if (v.debugPng && result.debug) {
      const ov = pm.photoMatchOverlay(result.debug, regions.map((r) => r.color || null));
      await sharp(Buffer.from(ov.data.buffer, ov.data.byteOffset, ov.data.length), { raw: { width: ov.width, height: ov.height, channels: 4 } })
        .resize({ width: ov.width * 2, kernel: 'nearest' }).png().toFile(v.debugPng);
    }
    delete result.debug;
    if (unknownExcl.length) result.warnings.push(`exclude: no part named ${unknownExcl.join(', ')} (parts: ${(render.labelNames ?? []).join(', ') || 'none'}).`);
    results.push({
      label: `${basename(v.photo)}@${v.view.name}`,
      photo: v.photo,
      view: { az: v.view.az, el: v.view.el },
      ...(v.crop ? { crop: v.crop } : {}),
      ...(v.mask ? { mask: v.mask } : {}),
      excluded: opts.exclude ?? [],
      ...(v.debugPng ? { overlayPng: v.debugPng } : {}),
      regionNames: regions.map((r) => r.name),
      ...result,
    });
  }
  const combined = results.length > 1 ? pm.combinePhotoMatches(results.map((r) => ({ label: r.label, result: r }))) : null;
  return { results, combined };
}

/** `o.png` → `o-1.png` for the i-th of several overlays (i > 0). */
export function indexedPath(path, i) {
  if (!path || i === 0) return path;
  const ext = extname(path);
  return `${path.slice(0, path.length - ext.length)}-${i}${ext}`;
}
