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
import { readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DEFAULT_VIEWS, resolveViews } from './views.mjs';
import { checkRequireLabels } from './gates.mjs';

// Re-export so existing importers (main.mjs, model-preview.mjs) can keep
// pulling resolveViews / checkRequireLabels from preview.mjs; the
// implementations live in the pure, unit-testable sibling modules.
export { resolveViews, checkRequireLabels };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Default preview-PNG path for a model file — UNIQUE per run (base36-ms
// timestamp suffix), because the agent Read tool caches images by path: a
// re-render written to the same `<file>.preview.png` gets served stale, and
// past sessions nearly concluded their edits "did nothing" because of it.
// Older default previews for the same model are removed first so the
// directory holds at most one at rest. An explicit --png path is the caller's
// own business and is used verbatim (no stamp, no cleanup).
export function defaultPreviewPng(file) {
  const dir = dirname(file);
  const stem = basename(file).replace(/\.[^.]+$/, '');
  const old = new RegExp(`^${escapeRe(stem)}\\.preview(-[a-z0-9]+)?\\.png$`);
  try {
    for (const f of readdirSync(dir)) if (old.test(f)) unlinkSync(join(dir, f));
  } catch { /* best-effort cleanup — a leftover stale file is only clutter */ }
  return join(dir, `${stem}.preview-${Date.now().toString(36)}.png`);
}

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

// Supersampling factor for antialiasing — render SS× and box-downsample. 2×
// (4 samples/px) removes the jaggies that made silhouettes look low-quality;
// rasterizing is a small fraction of a run (WASM meshing dominates), so the
// extra pixel work is cheap.
const SS = 2;

// Per-vertex normals = area-weighted sum of incident face normals, normalized
// (the same scheme Three.js `computeVertexNormals` uses). Computed ONCE per
// model and shared across views, so smooth (Gouraud) shading replaces the
// faceted flat shading. Welded seams (duplicate vertex indices) stay crisp.
function vertexNormals(positions, triVerts) {
  const nv = positions.length / 3;
  const vn = new Float32Array(nv * 3);
  const nt = triVerts.length / 3;
  for (let t = 0; t < nt; t++) {
    const ia = triVerts[t * 3], ib = triVerts[t * 3 + 1], ic = triVerts[t * 3 + 2];
    const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
    const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
    const fn = cross(sub(b, a), sub(c, a)); // length ∝ triangle area = the weight
    vn[ia * 3] += fn[0]; vn[ia * 3 + 1] += fn[1]; vn[ia * 3 + 2] += fn[2];
    vn[ib * 3] += fn[0]; vn[ib * 3 + 1] += fn[1]; vn[ib * 3 + 2] += fn[2];
    vn[ic * 3] += fn[0]; vn[ic * 3 + 1] += fn[1]; vn[ic * 3 + 2] += fn[2];
  }
  for (let i = 0; i < nv; i++) {
    const n = norm([vn[i * 3], vn[i * 3 + 1], vn[i * 3 + 2]]);
    vn[i * 3] = n[0]; vn[i * 3 + 1] = n[1]; vn[i * 3 + 2] = n[2];
  }
  return vn;
}

// Three-term lighting: a key light from the camera, a softer fill from the
// opposite-ish side (so unlit faces read as form rather than flat grey), and an
// ambient floor. Matches the browser's lit look far better than one hard light.
function shadeLights(n, view) {
  const key = Math.max(0, dot(n, view.light));
  const fillDir = norm([-view.light[0] + view.right[0] * 0.6, -view.light[1] + view.right[1] * 0.6, view.light[2] * 0.3 + 0.4]);
  const fill = Math.max(0, dot(n, fillDir)) * 0.35;
  return Math.min(1, 0.30 + key * 0.7 + fill);
}

// Rasterize one view into an RGBA `size`×`size` tile with smooth (per-vertex
// normal) shading + SS× supersampled antialiasing. `vnorms` is the shared
// vertex-normal array from vertexNormals(); colors stay per-triangle.
function renderTile(positions, triVerts, triColors, center, scale, size, view, bg, vnorms) {
  const S = size * SS, half = S / 2, sc = scale * SS;
  const col = new Float32Array(S * S * 3);
  const zbuf = new Float32Array(S * S).fill(Infinity);
  const cov = new Uint8Array(S * S);
  const nt = triVerts.length / 3;
  const project = (vi) => {
    const p = [positions[vi * 3] - center[0], positions[vi * 3 + 1] - center[1], positions[vi * 3 + 2] - center[2]];
    return { x: half + dot(p, view.right) * sc, y: half - dot(p, view.up) * sc, z: dot(p, view.fwd) };
  };
  for (let t = 0; t < nt; t++) {
    const ia = triVerts[t * 3], ib = triVerts[t * 3 + 1], ic = triVerts[t * 3 + 2];
    const A = project(ia), B = project(ib), C = project(ic);
    const na = [vnorms[ia * 3], vnorms[ia * 3 + 1], vnorms[ia * 3 + 2]];
    const nb = [vnorms[ib * 3], vnorms[ib * 3 + 1], vnorms[ib * 3 + 2]];
    const ncn = [vnorms[ic * 3], vnorms[ic * 3 + 1], vnorms[ic * 3 + 2]];
    const baseR = triColors ? triColors[t * 3] : 190, baseG = triColors ? triColors[t * 3 + 1] : 190, baseB = triColors ? triColors[t * 3 + 2] : 200;
    const minX = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x))), maxX = Math.min(S - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const minY = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y))), maxY = Math.min(S - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((B.x - x) * (C.y - y) - (C.x - x) * (B.y - y)) / area;
        const w1 = ((C.x - x) * (A.y - y) - (A.x - x) * (C.y - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const z = w0 * A.z + w1 * B.z + w2 * C.z;
        const idx = y * S + x;
        if (z >= zbuf[idx]) continue; // nearer = smaller fwd-depth
        zbuf[idx] = z;
        const nrm = norm([
          w0 * na[0] + w1 * nb[0] + w2 * ncn[0],
          w0 * na[1] + w1 * nb[1] + w2 * ncn[1],
          w0 * na[2] + w1 * nb[2] + w2 * ncn[2],
        ]);
        const sh = shadeLights(nrm, view);
        const o = idx * 3; col[o] = baseR * sh; col[o + 1] = baseG * sh; col[o + 2] = baseB * sh; cov[idx] = 1;
      }
    }
  }
  // Box-downsample SS×SS → size×size RGBA, compositing over the background.
  const px = new Uint8ClampedArray(size * size * 4);
  const inv = 1 / (SS * SS);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const si = (y * SS + dy) * S + (x * SS + dx);
          if (cov[si]) { r += col[si * 3]; g += col[si * 3 + 1]; b += col[si * 3 + 2]; }
          else { r += bg[0]; g += bg[1]; b += bg[2]; }
        }
      }
      const o = (y * size + x) * 4; px[o] = r * inv; px[o + 1] = g * inv; px[o + 2] = b * inv; px[o + 3] = 255;
    }
  }
  return px;
}

// Copy one RGBA `size`×`size` tile into the RGB `out` buffer of width `W` at
// pixel offset (ox, oy). Shared by composePng (4-view grid) and
// composeContactSheet (one tile per model).
function blit(out, W, tile, size, ox, oy) {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const s = (y * size + x) * 4, d = ((oy + y) * W + (ox + x)) * 3;
    out[d] = tile[s]; out[d + 1] = tile[s + 1]; out[d + 2] = tile[s + 2];
  }
}

// Center + uniform scale that fits a model's bbox into a `size`-px tile.
function fit(bbox, size) {
  const center = bbox ? [(bbox.min[0] + bbox.max[0]) / 2, (bbox.min[1] + bbox.max[1]) / 2, (bbox.min[2] + bbox.max[2]) / 2] : [0, 0, 0];
  const diag = bbox ? Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]) : 1;
  return { center, scale: (size * 0.42) / (diag / 2 || 1) };
}

const BG = [244, 244, 246];

// Lay a list of pre-rendered RGBA tiles into a near-square grid PNG (the same
// layout for the 4-view default, an N-view custom set, and the contact sheet).
function tileGrid(tiles, size) {
  const n = Math.max(1, tiles.length);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const g = 2;
  const W = cols * size + (cols - 1) * g;
  const H = rows * size + (rows - 1) * g;
  const out = Buffer.alloc(W * H * 3, 220);
  tiles.forEach((tile, i) => {
    const ox = (i % cols) * (size + g), oy = Math.floor(i / cols) * (size + g);
    blit(out, W, tile, size, ox, oy);
  });
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png();
}

// Compose the multi-view grid PNG. Defaults to front/right/top/iso; pass a
// custom `views` array (from resolveViews) to control the camera angles.
// Returns a sharp instance (caller writes/toBuffer).
export function composePng(positions, triVerts, triColors, bbox, size, views = DEFAULT_VIEWS) {
  const { center, scale } = fit(bbox, size);
  const vnorms = vertexNormals(positions, triVerts); // once, shared across views
  const tiles = views.map((v) => renderTile(positions, triVerts, triColors, center, scale, size, basis(v.az, v.el), BG, vnorms));
  return tileGrid(tiles, size);
}

// Compose a contact sheet — one tile per model, laid out in a near-square grid
// (left-to-right, top-to-bottom matching the input order). Each model is fit to
// its own bbox so all are visible regardless of relative size. Models that
// failed to run get a distinct pink tile so a broken variant stands out.
// `results` is an array of `{ render }` (render may be null on failure); `view`
// is the shared camera angle (default iso, overridable via --view).
export function composeContactSheet(results, size, view = { az: -50, el: 28 }) {
  const tiles = results.map((res) => {
    const r = res && res.render;
    if (r && r.positions && r.triVerts && r.triVerts.length) {
      const { center, scale } = fit(r.bbox, size);
      const vnorms = vertexNormals(r.positions, r.triVerts);
      return renderTile(r.positions, r.triVerts, r.triColors, center, scale, size, basis(view.az, view.el), BG, vnorms);
    }
    const tile = new Uint8ClampedArray(size * size * 4);
    for (let p = 0; p < tile.length; p += 4) { tile[p] = 250; tile[p + 1] = 224; tile[p + 2] = 224; tile[p + 3] = 255; }
    return tile;
  });
  return tileGrid(tiles, size);
}

// Human-readable per-island breakdown for `--explain-components` (printed to
// stderr so the stdout JSON contract stays clean). `stats.components` is capped
// at the top 16 by volume; the header notes when more islands exist.
export function explainComponents(stats) {
  if (!stats || !Array.isArray(stats.components) || stats.components.length === 0) {
    return `componentCount=${stats ? stats.componentCount : '?'} — no per-component data (render-only or single solid).`;
  }
  const capped = stats.components.length < stats.componentCount;
  const f = (a) => (Array.isArray(a) ? a.map((n) => (+n).toFixed(2)).join(', ') : '');
  const lines = [`componentCount=${stats.componentCount}${capped ? ` (showing top ${stats.components.length} by volume)` : ''}`];
  for (const c of stats.components) {
    lines.push(`  #${c.index}: vol=${(+c.volume).toFixed(2)} tris=${c.triangleCount} size=[${f(c.bbox && c.bbox.size)}] center=[${f(c.center)}]`);
  }
  return lines.join('\n');
}

// `--expect-components N` assertion. Returns null when the count matches (or N
// isn't a finite number), otherwise an error string. Compares against the
// uncapped `stats.componentCount`, NOT `components.length` (which tops out at 16).
export function checkExpectComponents(stats, expected) {
  if (expected === null || expected === undefined || expected === '') return null;
  const n = Number(expected);
  // The flag was given but the value isn't a number (typo / missing arg) — surface
  // it rather than silently treating the assertion as a no-op.
  if (!Number.isFinite(n)) return `--expect-components expects a number, got "${expected}".`;
  if (!stats || stats.componentCount !== n) {
    return `--expect-components ${n} failed: model has ${stats ? stats.componentCount : 'no'} component(s).`;
  }
  return null;
}

// Run a model file through the real engine via a throwaway in-process Vite SSR
// server. Returns the PreviewResult from src/tools/previewModel.ts.
export async function runPreview(file, { params = {}, lang = 'manifold-js', palette = undefined } = {}) {
  const code = readFileSync(file, 'utf8');
  const session = await createPreviewSession();
  try {
    return await session.preview(code, { params, lang, palette });
  } finally {
    await session.close();
  }
}

// Under Node SSR there is no dev server, so browser-style root-relative asset
// fetches (`fetch('/openscad-libs/fonts/…')` from api.text's font preload)
// have no origin to resolve against. Serve them straight from `public/` —
// the same files the dev server would return. Installed once, globally.
let fetchShimInstalled = false;
function installPublicFetchShim() {
  if (fetchShimInstalled) return;
  fetchShimInstalled = true;
  const realFetch = globalThis.fetch;
  const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
      const file = resolve(publicDir, '.' + url.replace(/[?#].*$/, ''));
      if (!file.startsWith(publicDir)) {
        throw new Error(`fetch shim: refusing path outside public/: ${url}`);
      }
      const data = await readFile(file);
      return new Response(data, { status: 200 });
    }
    return realFetch(input, init);
  };
}

// Long-lived variant for callers that run MANY previews (the parameter
// optimizer): boot the Vite SSR server + engine module once, then each
// preview() pays only the model build (~50-300ms) instead of ~2s of server
// startup. Caller must close().
export async function createPreviewSession() {
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
  installPublicFetchShim();
  const mod = await server.ssrLoadModule('/src/tools/previewModel.ts');
  return {
    preview: (code, { params = {}, lang = 'manifold-js', palette = undefined } = {}) =>
      mod.previewModel(code, { params, lang, palette }),
    close: () => server.close(),
  };
}
