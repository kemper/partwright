// Phase 1 (stateless) preview — runs ONE manifold-js model snippet against the
// REAL engine in Node via Vite SSR (no browser, no dev server, ~1-2s) and
// returns the rich stat block + a software-rasterized 4-view PNG.
//
// This is the shared core behind both `partwright preview/run` (bin/partwright.mjs)
// and the legacy `npm run model:preview` (scripts/model-preview.mjs). The engine
// path is the exact same `manifoldJsEngine` the browser app uses, so the stats
// are faithful; the rasterizer is a pure-JS stand-in for the WebGL viewport
// (flat shading, model-declared label colors only — see docs/headless-cli.md).
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

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

// Compose the 4-view grid PNG. Returns a sharp instance (caller writes/toBuffer).
export function composePng(positions, triVerts, triColors, bbox, size) {
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
  const tiles = views.map((v) => renderTile(positions, triVerts, triColors, center, scale, size, basis(v.az, v.el), bg));
  const g = 2, W = size * 2 + g, H = size * 2 + g;
  const out = Buffer.alloc(W * H * 3, 220);
  const place = (px, ox, oy) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4, d = ((oy + y) * W + (ox + x)) * 3;
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2];
    }
  };
  place(tiles[0], 0, 0); place(tiles[1], size + g, 0);
  place(tiles[2], 0, size + g); place(tiles[3], size + g, size + g);
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png();
}

// Run a model file through the real engine via a throwaway in-process Vite SSR
// server. Returns the PreviewResult from src/tools/previewModel.ts.
export async function runPreview(file, { params = {}, lang = 'manifold-js' } = {}) {
  const code = readFileSync(file, 'utf8');
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  try {
    const mod = await server.ssrLoadModule('/src/tools/previewModel.ts');
    return await mod.previewModel(code, { params, lang });
  } finally {
    await server.close();
  }
}
