#!/usr/bin/env node
// model:preview — headless preview of ONE manifold-js model snippet.
//
//   npm run model:preview -- <file.js> [--png <out.png>] [--json] [--size N]
//                              [-p key=value ...]
//
// Runs <file.js> against the REAL manifold-js engine in Node (via vite SSR —
// no dev server, no browser, ~1-2s), prints a rich JSON stat block to stdout,
// and writes a 4-view PNG (front / right / top / iso) shaded by face normal +
// any model-declared label colors. Built for AI self-correction: it surfaces
// everything you need to judge a model — runs?/manifold?/componentCount/
// per-component volumes+bboxes/genus/labels — in one fast call.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import sharp from 'sharp';

function parseArgs(argv) {
  const a = { params: {}, size: 480, json: false, png: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--size') a.size = parseInt(argv[++i], 10);
    else if (t === '--png') a.png = argv[++i];
    else if (t === '-p' || t === '--param') { const [k, ...v] = argv[++i].split('='); a.params[k] = coerce(v.join('=')); }
    else if (!a.file && !t.startsWith('-')) a.file = t;
  }
  return a;
}
function coerce(s) { if (s === 'true') return true; if (s === 'false') return false; const n = Number(s); return Number.isNaN(n) ? s : n; }

// ---------- pure-JS rasterizer ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// Look-at basis for a camera orbiting the origin at (azimuth, elevation) degrees.
function basis(azDeg, elDeg) {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  const dir = norm([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]); // origin→camera
  const fwd = [-dir[0], -dir[1], -dir[2]];
  let right = cross(fwd, [0, 0, 1]);
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0]; // looking straight down
  right = norm(right);
  const up = norm(cross(right, fwd));
  return { right, up, fwd, light: dir };
}

// Rasterize one view into an RGBA tile.
function renderTile(positions, triVerts, triColors, center, scale, size, view, bg) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = 255; }
  const zbuf = new Float32Array(size * size).fill(Infinity);
  const half = size / 2;
  const nt = triVerts.length / 3;
  const project = (vi) => {
    const p = [positions[vi * 3] - center[0], positions[vi * 3 + 1] - center[1], positions[vi * 3 + 2] - center[2]];
    return { x: half + dot(p, view.right) * scale, y: half - dot(p, view.up) * scale, z: dot(p, view.fwd), w: p };
  };
  for (let t = 0; t < nt; t++) {
    const ia = triVerts[t * 3], ib = triVerts[t * 3 + 1], ic = triVerts[t * 3 + 2];
    const A = project(ia), B = project(ib), C = project(ic);
    const n = norm(cross(sub(B.w, A.w), sub(C.w, A.w)));
    let shade = dot(n, view.light);
    if (shade < 0) shade = -shade * 0.25; // dim backfaces rather than black
    shade = 0.32 + 0.68 * Math.min(1, Math.max(0, shade));
    const baseR = triColors ? triColors[t * 3] : 190, baseG = triColors ? triColors[t * 3 + 1] : 190, baseB = triColors ? triColors[t * 3 + 2] : 200;
    const cr = baseR * shade, cg = baseG * shade, cb = baseB * shade;
    const minX = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x))), maxX = Math.min(size - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const minY = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y))), maxY = Math.min(size - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((B.x - x) * (C.y - y) - (C.x - x) * (B.y - y)) / area;
        const w1 = ((C.x - x) * (A.y - y) - (A.x - x) * (C.y - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const z = w0 * A.z + w1 * B.z + w2 * C.z;
        const idx = y * size + x;
        if (z >= zbuf[idx]) continue; // nearer = smaller fwd-depth
        zbuf[idx] = z;
        const o = idx * 4; px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = 255;
      }
    }
  }
  return px;
}

async function compose(positions, triVerts, triColors, bbox, size) {
  const center = bbox ? [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2] : [0, 0, 0];
  const diag = bbox ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]) : 1;
  const scale = (size * 0.42) / (diag / 2 || 1);
  const views = [
    { name: 'front', az: -90, el: 0 },
    { name: 'right', az: 0, el: 0 },
    { name: 'top', az: -90, el: 90 },
    { name: 'iso', az: -50, el: 28 },
  ];
  const bg = [244, 244, 246];
  const tiles = views.map((v) => ({ name: v.name, px: renderTile(positions, triVerts, triColors, center, scale, size, basis(v.az, v.el), bg) }));
  // 2x2 grid with a thin gutter
  const g = 2, W = size * 2 + g, H = size * 2 + g;
  const out = Buffer.alloc(W * H * 3, 220);
  const place = (px, ox, oy) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = ((oy + y) * W + (ox + x)) * 3;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2];
    }
  };
  place(tiles[0].px, 0, 0); place(tiles[1].px, size + g, 0);
  place(tiles[2].px, 0, size + g); place(tiles[3].px, size + g, size + g);
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png();
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.file) { console.error('Usage: npm run model:preview -- <file.js> [--png out.png] [--json] [--size N] [-p k=v]'); process.exit(2); }
  const file = resolve(a.file);
  const code = readFileSync(file, 'utf8');
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  let result;
  try {
    const mod = await server.ssrLoadModule('/src/tools/previewModel.ts');
    result = await mod.previewModel(code, { params: a.params });
  } finally {
    await server.close();
  }

  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, error: result.error, diagnostics: result.diagnostics }, null, 2));
    process.exit(1);
  }

  let pngPath = null;
  if (!a.json && result.render) {
    pngPath = a.png ? resolve(a.png) : join(dirname(file), basename(file).replace(/\.[^.]+$/, '') + '.preview.png');
    const img = await compose(result.render.positions, result.render.triVerts, result.render.triColors, result.render.bbox, a.size);
    await img.toFile(pngPath);
  }
  console.log(JSON.stringify({ ok: true, png: pngPath, stats: result.stats }, (_k, v) => (ArrayBuffer.isView(v) ? undefined : v), 2));
}
main().catch((e) => { console.error('model:preview failed:', e?.stack || e?.message || e); process.exit(1); });
