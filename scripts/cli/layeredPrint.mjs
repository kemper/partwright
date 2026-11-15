// `partwright layered-print` — photo → HueForge-style filament-layering print.
//
// Boots Vite SSR (no browser), decodes the photo with sharp, runs the pure
// solver (src/relief/layeredPrint/solver.ts), and writes:
//   <out>.3mf             Bambu Studio / Orca project, filament changes at layers
//                         (--swap ams: automatic AMS tool changes; pause: manual)
//   <out>.preview.png     photo | predicted print, side by side
//   <out>.swaps.txt       human swap instructions
//   stdout                JSON summary (filaments, swaps, ΔE, size)
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { createServer } from 'vite';

export async function loadLayeredPrintModules() {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  const solver = await server.ssrLoadModule('/src/relief/layeredPrint/solver.ts');
  const exp = await server.ssrLoadModule('/src/relief/layeredPrint/export3mf.ts');
  const plan = await server.ssrLoadModule('/src/relief/layeredPrint/plan.ts');
  return { solver, exp, plan, close: () => server.close() };
}

async function decode(file) {
  const { data, info } = await sharp(file).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Side-by-side photo | prediction PNG with a swatch strip of the filaments. */
async function writePreview(path, r) {
  const W = r.gridWidth, H = r.gridHeight;
  const gap = 8, strip = 28;
  const outW = W * 2 + gap, outH = H + strip + gap;
  const buf = Buffer.alloc(outW * outH * 4, 255);
  const blit = (src, ox) => {
    for (let y = 0; y < H; y++) src.subarray(y * W * 4, (y + 1) * W * 4).forEach((v, i) => { buf[((y * outW) + ox) * 4 + i] = v; });
  };
  blit(r.target, 0);
  blit(r.preview, W + gap);
  const n = r.blocks.length;
  const sw = Math.floor(outW / n);
  r.blocks.forEach((b, k) => {
    const h = b.filament.hex.replace('#', '');
    const c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    for (let y = H + gap; y < outH; y++) for (let x = k * sw + 2; x < (k + 1) * sw - 2; x++) {
      const o = (y * outW + x) * 4; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
    }
  });
  await sharp(buf, { raw: { width: outW, height: outH, channels: 4 } }).png().toFile(path);
}

/**
 * opts: { colors, width, pixel, layer, first, maxHeight, base, filamentsFile,
 *         baseFilament, chroma, smoothing, denoise, iterations, seed,
 *         swap: 'ams'|'pause'|'both', printer, nozzle, out, name }
 */
export async function runLayeredPrint(photo, opts) {
  const img = await decode(photo);
  const { solver, exp, plan, close } = await loadLayeredPrintModules();
  try {
    const num = (v) => (v === undefined ? undefined : Number(v));
    const filaments = opts.filamentsFile ? JSON.parse(readFileSync(opts.filamentsFile, 'utf8')) : undefined;
    const t0 = Date.now();
    const r = solver.solveLayeredPrint(img, {
      numColors: num(opts.colors),
      widthMm: num(opts.width),
      pixelSizeMm: num(opts.pixel),
      layerHeight: num(opts.layer),
      firstLayerHeight: num(opts.first),
      maxHeightMm: num(opts.maxHeight),
      baseHeightMm: num(opts.base),
      chromaWeight: num(opts.chroma),
      smoothing: num(opts.smoothing),
      denoise: num(opts.denoise),
      iterations: num(opts.iterations),
      seed: num(opts.seed),
      filaments,
      baseFilament: opts.baseFilament,
    });
    const solveMs = Date.now() - t0;
    const out = opts.out ?? photo.replace(/\.[^.]+$/, '') + '-layered-print';
    const name = opts.name ?? 'layered-print';
    const modes = opts.swap === 'both' ? ['ams', 'pause'] : [opts.swap ?? 'ams'];
    const files = [];
    for (const mode of modes) {
      const built = exp.buildLayeredPrint3MF(r, { swapMode: mode, printer: opts.printer, nozzle: opts.nozzle, name });
      const path = modes.length > 1 ? `${out}.${mode}.3mf` : `${out}.3mf`;
      writeFileSync(path, Buffer.from(await built.blob.arrayBuffer()));
      files.push(path);
    }
    await writePreview(`${out}.preview.png`, r);
    writeFileSync(`${out}.swaps.txt`, plan.planSwapText(plan.layeredPrintRecord(r)) + '\n');
    return { ...solver.layeredPrintSummary(r), solveMs, files, preview: `${out}.preview.png`, swapsText: `${out}.swaps.txt` };
  } finally {
    await close();
  }
}
