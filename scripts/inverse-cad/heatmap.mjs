#!/usr/bin/env node
// heatmap.mjs — per-triangle signed-distance heatmap between a target and a
// candidate mesh, in both directions, composed into one labeled PNG.
//
// Row 1: candidate mesh, each triangle colored by its signed distance to the
//        TARGET surface (blue = inside target / candidate missing material
//        there, red = outside target / candidate has excess material).
// Row 2: target mesh, each triangle colored by its signed distance to the
//        CANDIDATE surface — the only render of the two that can show a
//        MISSING feature (a target region the candidate doesn't cover at all
//        renders strongly blue on the target's own shape, something row 1
//        can never show since it only ever colors the candidate's triangles).
//
// Usage:
//   node scripts/inverse-cad/heatmap.mjs <target.stl> <candidate.stl>
//     --out x.png [--scale 0.5] [--size 400] [--views front,right,top,iso]

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseStl, meshBBox } from './stl.mjs';
import { weldVertices } from './mesh.mjs';
import { buildTriBvh, closestPointOnMesh, isInside } from './surfaceDistance.mjs';
import { composePng } from '../cli/preview.mjs';
import { DEFAULT_VIEWS, resolveViews } from '../cli/views.mjs';

// ---- diverging palette: blue (-scale) -> neutral gray (0) -> red (+scale) ----
const BLUE = [40, 90, 220];
const NEUTRAL = [235, 235, 235];
const RED = [220, 60, 40];

function lerp(a, b, t) { return a + (b - a) * t; }

function divergingColor(t) {
  // t clamped to [-1, 1]
  const [r, g, b] = t < 0
    ? [lerp(NEUTRAL[0], BLUE[0], -t), lerp(NEUTRAL[1], BLUE[1], -t), lerp(NEUTRAL[2], BLUE[2], -t)]
    : [lerp(NEUTRAL[0], RED[0], t), lerp(NEUTRAL[1], RED[1], t), lerp(NEUTRAL[2], RED[2], t)];
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))));
}

/**
 * Per-triangle signed-distance colors for `meshA` against `meshB`'s surface
 * (`bvhB` = buildTriBvh(meshB), passed in so callers building both
 * directions only build each BVH once). Signed distance is the centroid's
 * closest-point distance to B, negated when the centroid is inside B
 * (positive = outside B = excess for A-as-candidate; negative = inside B =
 * missing/overlapped material), matching the sign convention documented in
 * surfaceDistance.mjs's signedMeshDistance.
 *
 * Returns { triColors: Uint8Array (RGB per triangle, matching the shape
 * meshToRenderInputs/composePng expect), stats: {minSigned, maxSigned,
 * pctBeyondScale} }.
 */
export function heatmapColors(meshA, bvhB, meshB, opts = {}) {
  const scale = opts.scale_mm ?? 0.5;
  const { triangles } = meshA;
  const triCount = triangles.length / 9;
  const triColors = new Uint8Array(triCount * 3);
  let minSigned = Infinity;
  let maxSigned = -Infinity;
  let beyond = 0;

  for (let t = 0; t < triCount; t++) {
    const o = t * 9;
    const cx = (triangles[o] + triangles[o + 3] + triangles[o + 6]) / 3;
    const cy = (triangles[o + 1] + triangles[o + 4] + triangles[o + 7]) / 3;
    const cz = (triangles[o + 2] + triangles[o + 5] + triangles[o + 8]) / 3;
    const { dist } = closestPointOnMesh(bvhB, cx, cy, cz);
    const sign = isInside(bvhB, meshB, cx, cy, cz) ? -1 : 1;
    const signed = sign * dist;
    if (signed < minSigned) minSigned = signed;
    if (signed > maxSigned) maxSigned = signed;
    if (Math.abs(signed) > scale) beyond++;
    const tNorm = Math.max(-1, Math.min(1, scale > 0 ? signed / scale : 0));
    const [r, g, b] = divergingColor(tNorm);
    triColors[t * 3] = r;
    triColors[t * 3 + 1] = g;
    triColors[t * 3 + 2] = b;
  }

  return {
    triColors,
    stats: {
      minSigned: triCount ? minSigned : 0,
      maxSigned: triCount ? maxSigned : 0,
      pctBeyondScale: triCount ? beyond / triCount : 0,
    },
  };
}

// Weld a triangle-soup mesh into the indexed (positions/triVerts/bbox) shape
// composePng expects, but keep ALREADY-COMPUTED per-triangle colors instead
// of applying a uniform color (weldVertices preserves triangle order, so
// `triColors` indexed by original-soup triangle order lines up with the
// welded `triVerts` groups of 3).
function meshToRenderInputsWithColors(mesh, triColors) {
  const welded = weldVertices(mesh);
  const positions = new Float32Array(welded.vertices);
  const triVerts = new Uint32Array(welded.triangles);
  const bbox = meshBBox(mesh);
  return { positions, triVerts, triColors, bbox };
}

function unionBBox(a, b) {
  const min = [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])];
  const max = [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])];
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]], center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

// ---- small camera-math duplicates of preview.mjs's private basis()/fit() ----
// (preview.mjs only exports composePng/composeContactSheet — not these
// internals — so marker projection re-implements the same tiny formulas
// rather than editing that file. Keep in sync if the camera model changes.)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

function basis(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const dir = norm([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
  const fwd = [-dir[0], -dir[1], -dir[2]];
  let right = cross(fwd, [0, 0, 1]);
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0];
  right = norm(right);
  const up = norm(cross(right, fwd));
  return { right, up, fwd };
}

function fitBBox(bbox, size) {
  const center = [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2];
  const diag = Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
  return { center, scale: (size * 0.42) / (diag / 2 || 1) };
}

function projectPoint(x, y, z, center, scale, size, view) {
  const p = sub([x, y, z], center);
  return { x: size / 2 + dot(p, view.right) * scale, y: size / 2 - dot(p, view.up) * scale };
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Render one row's tiles (one PNG buffer per view), optionally overlaying
// labeled marker circles projected with the SAME camera model composePng
// uses internally.
async function renderRowTiles(inputs, views, size, markers) {
  return Promise.all(views.map(async (v) => {
    const tileBuf = await composePng(inputs.positions, inputs.triVerts, inputs.triColors, inputs.bbox, size, [v]).png().toBuffer();
    if (!markers || !markers.length) return tileBuf;
    const { center, scale } = fitBBox(inputs.bbox, size);
    const view = basis(v.az, v.el);
    const svgParts = markers.map((m) => {
      const p = projectPoint(m.x, m.y, m.z, center, scale, size, view);
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" fill="none" stroke="#00aa33" stroke-width="2"/>` +
        `<text x="${(p.x + 9).toFixed(1)}" y="${(p.y - 9).toFixed(1)}" font-family="sans-serif" font-size="12" fill="#00aa33" font-weight="bold">${escapeXml(m.id)}</text>`;
    }).join('');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${svgParts}</svg>`);
    return sharp(tileBuf).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
  }));
}

function labelBar(width, height, text) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(255,255,255,0.92)"/>` +
    `<text x="8" y="${height - 7}" font-family="sans-serif" font-size="13" fill="#111">${escapeXml(text)}</text>` +
    `</svg>`,
  );
}

function legendBar(width, height, scaleMm) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0%" stop-color="rgb(${BLUE.join(',')})"/>` +
    `<stop offset="50%" stop-color="rgb(${NEUTRAL.join(',')})"/>` +
    `<stop offset="100%" stop-color="rgb(${RED.join(',')})"/>` +
    `</linearGradient></defs>` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>` +
    `<rect x="12" y="4" width="${Math.max(0, width - 24)}" height="10" fill="url(#g1)" stroke="#999" stroke-width="1"/>` +
    `<text x="12" y="${height - 5}" font-family="sans-serif" font-size="12" fill="#111">-${scaleMm}mm (missing/inside)</text>` +
    `<text x="${width / 2}" y="${height - 5}" font-family="sans-serif" font-size="12" fill="#111" text-anchor="middle">0</text>` +
    `<text x="${width - 12}" y="${height - 5}" font-family="sans-serif" font-size="12" fill="#111" text-anchor="end">+${scaleMm}mm (excess/outside)</text>` +
    `</svg>`;
  return Buffer.from(svg);
}

/**
 * Compose the two-row heatmap comparison PNG. Returns a sharp instance (like
 * composeComparison in render.mjs) with a non-standard `.stats` property
 * attached ({ candidate, target, scale_mm }) so CLI/agent callers can read
 * the numeric summary without re-deriving it from pixels.
 */
export async function composeHeatmap({ target, candidate, size = 400, views, scale_mm = 0.5, markers } = {}) {
  const chosenViews = views && views.length ? views : DEFAULT_VIEWS;

  const bvhTarget = buildTriBvh(target);
  const bvhCandidate = buildTriBvh(candidate);

  const candResult = heatmapColors(candidate, bvhTarget, target, { scale_mm });
  const targetResult = heatmapColors(target, bvhCandidate, candidate, { scale_mm });

  const candInputs = meshToRenderInputsWithColors(candidate, candResult.triColors);
  const targetInputs = meshToRenderInputsWithColors(target, targetResult.triColors);

  // Shared bbox framing across both rows (and both meshes) — otherwise a
  // tighter mesh zooms in past the other, breaking the visual comparison.
  const shared = unionBBox(candInputs.bbox, targetInputs.bbox);
  candInputs.bbox = shared;
  targetInputs.bbox = shared;

  const candTiles = await renderRowTiles(candInputs, chosenViews, size, markers);
  const targetTiles = await renderRowTiles(targetInputs, chosenViews, size, markers);

  const gap = 4;
  const labelH = 24;
  const legendH = 40;
  const rowGap = 8;
  const rowW = chosenViews.length * size + (chosenViews.length - 1) * gap;
  const rowH = labelH + size;
  const totalW = rowW;
  const totalH = rowH * 2 + rowGap + legendH;

  const overlays = [];
  candTiles.forEach((buf, i) => overlays.push({ input: buf, top: labelH, left: i * (size + gap) }));
  overlays.push({ input: labelBar(rowW, labelH, 'row 1: candidate colored by signed dist. to TARGET (blue=inside target/missing, red=outside target/excess)'), top: 0, left: 0 });

  const row2Top = rowH + rowGap;
  targetTiles.forEach((buf, i) => overlays.push({ input: buf, top: row2Top + labelH, left: i * (size + gap) }));
  overlays.push({ input: labelBar(rowW, labelH, 'row 2: target colored by signed dist. to CANDIDATE (blue=candidate has extra here, red=candidate MISSING this feature)'), top: row2Top, left: 0 });

  const legendTop = row2Top + rowH;
  overlays.push({ input: legendBar(rowW, legendH, scale_mm), top: legendTop, left: 0 });

  const image = sharp({
    create: { width: totalW, height: totalH, channels: 3, background: { r: 220, g: 220, b: 220 } },
  }).composite(overlays).png();

  image.stats = { candidate: candResult.stats, target: targetResult.stats, scale_mm };
  return image;
}

// ---------------------------------------------------------------- CLI ----

function parseArgs(argv) {
  const args = { target: null, candidate: null, out: null, scale: 0.5, size: 400, views: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--scale') args.scale = Number(argv[++i]);
    else if (a === '--size') args.size = parseInt(argv[++i], 10);
    else if (a === '--views') args.views = argv[++i];
    else if (!args.target) args.target = a;
    else if (!args.candidate) args.candidate = a;
    else throw new Error('heatmap: unexpected argument ' + a);
  }
  if (!args.target || !args.candidate || !args.out) {
    console.error('Usage: node scripts/inverse-cad/heatmap.mjs <target.stl> <candidate.stl> --out x.png [--scale 0.5] [--size 400] [--views front,right,top,iso]');
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
  const { views, error } = resolveViews(null, args.views);
  if (error) { console.error(error); process.exit(2); }

  const image = await composeHeatmap({ target, candidate, size: args.size, views: views ?? undefined, scale_mm: args.scale });
  await image.toFile(args.out);
  console.log(JSON.stringify({
    out: args.out,
    target: basename(args.target),
    candidate: basename(args.candidate),
    scale_mm: args.scale,
    stats: image.stats,
  }, null, 2));
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) main().catch((e) => { console.error('heatmap failed:', e?.stack || e?.message || e); process.exit(1); });
