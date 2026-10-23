// `model:preview --match-photo ref.png` — the headless twin of the browser's
// `partwright.photoMatch()`. Renders the previewed model FLAT (region index per
// pixel, no lighting) from the requested camera with the same orthographic
// (az, el) conventions as the preview PNG, then scores it against the photo
// with the SAME pure module the browser uses (src/tools/photoMatch.ts, loaded
// through the preview session's Vite SSR server). Output is text-only JSON so
// an agent can check likeness without spending image tokens.
import sharp from 'sharp';
import { renderRegionImage } from './preview.mjs';

/** Parse `--match-crop x,y,w,h` → {x,y,w,h} | {error}. */
export function parseCrop(s) {
  if (s == null || s === '') return { crop: null };
  const p = String(s).split(',').map((v) => Number(v.trim()));
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n)) || p[2] <= 0 || p[3] <= 0) {
    return { error: `--match-crop expects "x,y,w,h" (pixels, w/h > 0), got "${s}".` };
  }
  return { crop: { x: p[0], y: p[1], w: p[2], h: p[3] } };
}

/**
 * @param session   a createPreviewSession() handle (its `load` gives SSR access)
 * @param render    PreviewResult.render (positions/triVerts/triColors/triLabel/labelNames)
 * @param opts      { photo: path, crop?, bg?, bgTolerance?, exclude?: string[], view: {az, el},
 *                    fit?: 'height'|'box', pixelAspect?: number, debugPng?: path }
 */
export async function runPhotoMatch(session, render, opts) {
  const pm = await session.load('/src/tools/photoMatch.ts');
  const { getConfig } = await session.load('/src/config/appConfig.ts');
  const cfg = getConfig().import; // Node has no localStorage → the shipped defaults

  const { data, info } = await sharp(opts.photo).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const reference = { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };

  const numTri = render.triVerts.length / 3;
  const { regions, triRegion } = pm.buildTriangleRegions(numTri, render.triColors, render.triLabel ?? null, render.labelNames ?? [], opts.exclude ?? []);
  const size = cfg.photoMatchRenderSize;
  const img = renderRegionImage(render.positions, render.triVerts, triRegion, size, opts.view);

  // RGBA twin of the label buffer (region colours on a neutral backdrop); the
  // exact labels drive the score, the RGBA only documents the render.
  const rgba = new Uint8ClampedArray(size * size * 4);
  const cols = regions.map((r) => pm.parseColor(r.color) ?? [170, 170, 170]);
  for (let p = 0; p < size * size; p++) {
    const l = img.labels[p];
    const c = l >= 0 ? cols[l] : l === -1 ? [170, 170, 170] : [255, 0, 255];
    rgba[p * 4] = c[0]; rgba[p * 4 + 1] = c[1]; rgba[p * 4 + 2] = c[2]; rgba[p * 4 + 3] = 255;
  }

  const result = pm.photoMatch({
    reference,
    crop: opts.crop ?? null,
    bg: opts.bg ?? null,
    bgTolerance: opts.bgTolerance ?? null,
    model: { width: size, height: size, data: rgba },
    modelLabels: img.labels,
    // Colourless regions (uncoloured labels with no palette) still count toward
    // the silhouette; the scorer skips them for the colour/region analysis.
    regions,
    fit: opts.fit === 'box' ? 'box' : 'height',
    pixelAspect: opts.pixelAspect ?? null,
    debug: !!opts.debugPng,
    tuning: pm.photoMatchTuningFromConfig(cfg),
  });
  // Optional checkpoint image: photo regions | model regions | silhouette diff.
  if (opts.debugPng && result.debug) {
    const ov = pm.photoMatchOverlay(result.debug, regions.map((r) => r.color || null));
    await sharp(Buffer.from(ov.data.buffer, ov.data.byteOffset, ov.data.length), { raw: { width: ov.width, height: ov.height, channels: 4 } })
      .resize({ width: ov.width * 2, kernel: 'nearest' }).png().toFile(opts.debugPng);
  }
  delete result.debug;
  return {
    view: { az: opts.view.az, el: opts.view.el },
    ...(opts.crop ? { crop: opts.crop } : {}),
    excluded: opts.exclude ?? [],
    ...(opts.debugPng ? { overlayPng: opts.debugPng } : {}),
    regionNames: regions.map((r) => r.name),
    ...result,
  };
}
