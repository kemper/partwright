#!/usr/bin/env node
// sliceOverlay.mjs — 2D cross-section overlay of a target mesh vs a
// candidate mesh at a chosen axis-aligned slice: the single most
// LLM-readable inverse-CAD artifact, one flat picture instead of squinting
// at two 3D renders.
//
// Target contours stroke black, candidate contours stroke red, and the
// region where the two disagree (rasterized even-odd fill, XOR'd) is
// filled translucent orange, over a 1mm grid with 5mm labeled ruler ticks.
//
// Usage:
//   node scripts/inverse-cad/sliceOverlay.mjs <target.stl> <candidate.stl>
//     --slices z:1.0,z:2.75,y:0 --out sheet.png [--size 480]

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { sliceMesh } from './slice.mjs';
import { parseStl } from './stl.mjs';

const SUPERSAMPLE = 4; // for the even-odd disagreement mask
const LABEL_BAR_H = 26;
const MARGIN = { left: 46, right: 16, top: 12, bottom: 46 };
const TARGET_COLOR = '#111111';
const CAND_COLOR = '#e0221e';
const DIFF_RGB = [255, 140, 0]; // translucent orange = disagreement fill
const DIFF_ALPHA_MAX = 200; // 0..255 applied to the downsampled XOR coverage

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Net filled area of a slice: outer contours minus holes (closed only —
// `open` chains are non-watertight diagnostics, excluded from the fill).
function netArea(contours) {
  let a = 0;
  for (const c of contours) {
    if (c.open) continue;
    a += c.isHole ? -c.area : c.area;
  }
  return a;
}

function unionRange(contoursA, contoursB) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  let any = false;
  for (const contours of [contoursA, contoursB]) {
    for (const c of contours) {
      const { points } = c;
      for (let i = 0; i < points.length; i += 2) {
        any = true;
        const u = points[i], v = points[i + 1];
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
    }
  }
  return any ? { minU, maxU, minV, maxV } : null;
}

function contoursToEdges(contours, toPixel) {
  const edges = [];
  for (const c of contours) {
    if (c.open) continue;
    const { points } = c;
    const n = points.length / 2;
    if (n < 3) continue;
    const px = new Float64Array(n), py = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = toPixel(points[i * 2], points[i * 2 + 1]);
      px[i] = p.x; py[i] = p.y;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push([px[i], py[i], px[j], py[j]]);
    }
  }
  return edges;
}

// Classic even-odd scanline fill. Outer boundaries and hole boundaries are
// thrown into the same edge list — parity alone reproduces the subtraction
// sliceMesh's `isHole` flag encodes, no special-casing needed.
function rasterizeEvenOdd(edges, W, H) {
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = y + 0.5;
    const xs = [];
    for (let e = 0; e < edges.length; e++) {
      const [x0, y0, x1, y1] = edges[e];
      if ((y0 <= sy && y1 > sy) || (y1 <= sy && y0 > sy)) {
        const t = (sy - y0) / (y1 - y0);
        xs.push(x0 + t * (x1 - x0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) mask[y * W + x] = 1;
    }
  }
  return mask;
}

function downsampleAlpha(mask, W, H, ss) {
  const dw = W / ss, dh = H / ss;
  const out = new Float32Array(dw * dh);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let s = 0;
      for (let dy = 0; dy < ss; dy++) {
        const row = (y * ss + dy) * W + x * ss;
        for (let dx = 0; dx < ss; dx++) s += mask[row + dx];
      }
      out[y * dw + x] = s * inv;
    }
  }
  return out;
}

function allClosedPoints(contours) {
  let n = 0;
  for (const c of contours) if (!c.open) n += c.points.length / 2;
  const out = new Float64Array(n * 2);
  let o = 0;
  for (const c of contours) {
    if (c.open) continue;
    out.set(c.points, o);
    o += c.points.length;
  }
  return out;
}

// Brute-force max-over-points nearest-neighbor distance (2D, mm). Fine at
// contour-point counts (tens to low hundreds per slice).
function maxNearestDistance(fromPts, toPts) {
  const nf = fromPts.length / 2, nt = toPts.length / 2;
  if (nf === 0 || nt === 0) return null;
  let worst = 0;
  for (let i = 0; i < nf; i++) {
    const fu = fromPts[i * 2], fv = fromPts[i * 2 + 1];
    let best = Infinity;
    for (let j = 0; j < nt; j++) {
      const du = fu - toPts[j * 2], dv = fv - toPts[j * 2 + 1];
      const d2 = du * du + dv * dv;
      if (d2 < best) best = d2;
    }
    const d = Math.sqrt(best);
    if (d > worst) worst = d;
  }
  return worst;
}

/**
 * Render one axis-aligned slice of target vs candidate as a single labeled
 * 2D overlay PNG (target black, candidate red, disagreement translucent
 * orange, 1mm grid + 5mm ruler). Total canvas is `sizePx` wide by
 * `sizePx + 26` tall (a top label bar plus the square-ish plot area).
 *
 * Returns { png (Buffer), axis, at, targetArea, candArea, iou,
 *   targetContours, candContours, maxDeviation_mm }.
 */
export async function renderSliceOverlay({ target, candidate, axis, at, sizePx = 480, pad = 0.05 }) {
  const targetContours = sliceMesh(target, axis, at);
  const candContours = sliceMesh(candidate, axis, at);

  const targetArea = Math.abs(netArea(targetContours));
  const candArea = Math.abs(netArea(candContours));

  const targetPts = allClosedPoints(targetContours);
  const candPts = allClosedPoints(candContours);
  const dTC = maxNearestDistance(targetPts, candPts);
  const dCT = maxNearestDistance(candPts, targetPts);
  const maxDeviation_mm = dTC === null || dCT === null ? null : Math.max(dTC, dCT);

  const totalW = sizePx;
  const totalH = sizePx + LABEL_BAR_H;
  const range = unionRange(targetContours, candContours);

  if (!range) {
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">` +
      `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>` +
      `<text x="16" y="${totalH / 2}" font-family="sans-serif" font-size="15" fill="#900">` +
      `no contours from either mesh at ${axis}=${at}</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return { png, axis, at, targetArea: 0, candArea: 0, iou: 1, targetContours, candContours, maxDeviation_mm: null };
  }

  const drawW = sizePx - MARGIN.left - MARGIN.right;
  const drawH = sizePx - MARGIN.top - MARGIN.bottom;

  const rawW = Math.max(range.maxU - range.minU, 1e-6);
  const rawH = Math.max(range.maxV - range.minV, 1e-6);
  const padU = rawW * pad, padV = rawH * pad;
  const uMin = range.minU - padU, uMax = range.maxU + padU;
  const vMin = range.minV - padV, vMax = range.maxV + padV;
  const spanU = uMax - uMin, spanV = vMax - vMin;
  const scale = Math.min(drawW / spanU, drawH / spanV);
  const contentW = spanU * scale, contentH = spanV * scale;
  const offX = MARGIN.left + (drawW - contentW) / 2;
  const offY = LABEL_BAR_H + MARGIN.top + (drawH - contentH) / 2;

  const toPixel = (u, v) => ({ x: offX + (u - uMin) * scale, y: offY + contentH - (v - vMin) * scale });

  // ---- disagreement mask: even-odd rasterize both contour sets at 4x
  // supersample, XOR the boolean masks, downsample to an alpha layer ----
  const ss = SUPERSAMPLE;
  const dw = Math.max(1, Math.round(contentW));
  const dh = Math.max(1, Math.round(contentH));
  const mW = dw * ss, mH = dh * ss;
  const toPixelSS = (u, v) => {
    const p = toPixel(u, v);
    return { x: (p.x - offX) * ss, y: (p.y - offY) * ss };
  };
  const targetEdges = contoursToEdges(targetContours, toPixelSS);
  const candEdges = contoursToEdges(candContours, toPixelSS);
  const targetMask = rasterizeEvenOdd(targetEdges, mW, mH);
  const candMask = rasterizeEvenOdd(candEdges, mW, mH);

  let inter = 0, uni = 0;
  const xorMask = new Uint8Array(mW * mH);
  for (let i = 0; i < mW * mH; i++) {
    const t = targetMask[i], c = candMask[i];
    if (t || c) uni++;
    if (t && c) inter++;
    if (t !== c) xorMask[i] = 1;
  }
  const iou = uni ? inter / uni : 1;

  const alpha = downsampleAlpha(xorMask, mW, mH, ss);
  const fillBuf = Buffer.alloc(dw * dh * 4);
  for (let i = 0; i < dw * dh; i++) {
    fillBuf[i * 4] = DIFF_RGB[0];
    fillBuf[i * 4 + 1] = DIFF_RGB[1];
    fillBuf[i * 4 + 2] = DIFF_RGB[2];
    fillBuf[i * 4 + 3] = Math.round(alpha[i] * DIFF_ALPHA_MAX);
  }
  const fillPng = await sharp(fillBuf, { raw: { width: dw, height: dh, channels: 4 } }).png().toBuffer();

  // ---- grid + ruler + contour strokes (SVG, crisp on top of the fill) ----
  const gridParts = [];
  const startU = Math.ceil(uMin), startV = Math.ceil(vMin);
  for (let u = startU; u <= uMax; u++) {
    const p0 = toPixel(u, vMin), p1 = toPixel(u, vMax);
    const major = u % 5 === 0;
    gridParts.push(`<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" stroke="${major ? '#aaaaaa' : '#e5e5e5'}" stroke-width="${major ? 1 : 0.5}"/>`);
    if (major) {
      const lbl = toPixel(u, vMin);
      gridParts.push(`<text x="${lbl.x.toFixed(1)}" y="${(lbl.y + 14).toFixed(1)}" font-family="sans-serif" font-size="10" fill="#555" text-anchor="middle">${u}</text>`);
    }
  }
  for (let v = startV; v <= vMax; v++) {
    const p0 = toPixel(uMin, v), p1 = toPixel(uMax, v);
    const major = v % 5 === 0;
    gridParts.push(`<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" stroke="${major ? '#aaaaaa' : '#e5e5e5'}" stroke-width="${major ? 1 : 0.5}"/>`);
    if (major) {
      const lbl = toPixel(uMin, v);
      gridParts.push(`<text x="${(lbl.x - 6).toFixed(1)}" y="${(lbl.y + 3).toFixed(1)}" font-family="sans-serif" font-size="10" fill="#555" text-anchor="end">${v}</text>`);
    }
  }

  const contourPolys = (contours, color) => contours.filter((c) => !c.open).map((c) => {
    const { points } = c;
    const n = points.length / 2;
    const poly = [];
    for (let i = 0; i < n; i++) {
      const p = toPixel(points[i * 2], points[i * 2 + 1]);
      poly.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    return `<polygon points="${poly.join(' ')}" fill="none" stroke="${color}" stroke-width="2"/>`;
  }).join('');

  const labelText = `${axis}=${at.toFixed(2)} | targetArea=${targetArea.toFixed(1)} candArea=${candArea.toFixed(1)} IoU=${iou.toFixed(2)}`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}">` +
    `<rect x="0" y="0" width="${totalW}" height="${LABEL_BAR_H}" fill="#f4f4f6"/>` +
    `<text x="8" y="${LABEL_BAR_H - 7}" font-family="sans-serif" font-size="14" fill="#111">${escapeXml(labelText)}</text>` +
    `<rect x="${offX.toFixed(1)}" y="${offY.toFixed(1)}" width="${contentW.toFixed(1)}" height="${contentH.toFixed(1)}" fill="none" stroke="#888888" stroke-width="1"/>` +
    gridParts.join('') +
    contourPolys(targetContours, TARGET_COLOR) +
    contourPolys(candContours, CAND_COLOR) +
    `</svg>`;

  const png = await sharp({ create: { width: totalW, height: totalH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([
      { input: fillPng, top: Math.round(offY), left: Math.round(offX) },
      { input: Buffer.from(svg), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();

  return { png, axis, at, targetArea, candArea, iou, targetContours, candContours, maxDeviation_mm };
}

/**
 * Render several slices and lay them into one labeled contact sheet (the
 * montage.mjs grid+label-bar pattern, inlined here since montage.mjs is a
 * CLI-only script with no exported composer to import). Writes `out` when
 * given. Returns the numerics array (one entry per slice, PNG buffers
 * dropped — the sheet PNG is the visual artifact, this is the readable
 * summary for a chat/log message).
 */
export async function composeSliceSheet({ target, candidate, slices, sizePx = 480, out }) {
  const results = [];
  for (const spec of slices) {
    const at = typeof spec.at === 'number' ? spec.at : Number(spec.at);
    const r = await renderSliceOverlay({ target, candidate, axis: spec.axis, at, sizePx });
    results.push({ ...r, why: spec.why ?? null });
  }

  const cols = Math.ceil(Math.sqrt(results.length));
  const rows = Math.ceil(results.length / cols);
  const metas = await Promise.all(results.map((r) => sharp(r.png).metadata()));
  const tileW = Math.max(...metas.map((m) => m.width));
  const tileH = Math.max(...metas.map((m) => m.height));
  const gap = 6;
  const whyH = 18;
  const W = cols * tileW + (cols - 1) * gap;
  const H = rows * (tileH + whyH) + (rows - 1) * gap;

  const overlays = [];
  results.forEach((r, i) => {
    const cx = (i % cols) * (tileW + gap);
    const cy = Math.floor(i / cols) * (tileH + whyH + gap);
    if (r.why) {
      overlays.push({
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${whyH}">` +
          `<rect width="${tileW}" height="${whyH}" fill="#eef0fa"/>` +
          `<text x="6" y="${whyH - 5}" font-family="sans-serif" font-size="12" fill="#223">${escapeXml(r.why)}</text>` +
          `</svg>`,
        ),
        top: cy,
        left: cx,
      });
    }
    overlays.push({ input: r.png, top: cy + whyH, left: cx });
  });

  const sheet = sharp({ create: { width: W, height: H, channels: 3, background: { r: 230, g: 230, b: 230 } } }).composite(overlays).png();
  if (out) await sheet.toFile(out);

  return results.map(({ png, targetContours, candContours, ...rest }) => rest);
}

// ---------------------------------------------------------------- CLI ----

function parseSlicesArg(s) {
  return s.split(',').map((seg) => {
    const [axis, val] = seg.split(':');
    if (!axis || val === undefined) throw new Error(`--slices: bad segment "${seg}", expected axis:value`);
    return { axis: axis.trim(), at: Number(val) };
  });
}

function parseArgs(argv) {
  const args = { target: null, candidate: null, out: null, slices: null, size: 480 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--slices') args.slices = argv[++i];
    else if (a === '--size') args.size = parseInt(argv[++i], 10);
    else if (!args.target) args.target = a;
    else if (!args.candidate) args.candidate = a;
    else throw new Error('sliceOverlay: unexpected argument ' + a);
  }
  if (!args.target || !args.candidate || !args.out || !args.slices) {
    console.error('Usage: node scripts/inverse-cad/sliceOverlay.mjs <target.stl> <candidate.stl> --slices z:1.0,z:2.75,y:0 --out sheet.png [--size 480]');
    process.exit(2);
  }
  return args;
}

function readStl(path) {
  const buf = readFileSync(path);
  return parseStl(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
}

async function main() {
  const args = parseArgs(process.argv);
  const target = readStl(args.target);
  const candidate = readStl(args.candidate);
  const slices = parseSlicesArg(args.slices);
  const numerics = await composeSliceSheet({ target, candidate, slices, sizePx: args.size, out: args.out });
  console.log(JSON.stringify({ out: args.out, slices: numerics }, null, 2));
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) main().catch((e) => { console.error('sliceOverlay failed:', e?.stack || e?.message || e); process.exit(1); });
