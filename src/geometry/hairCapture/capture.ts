// Hair capture — turn a hair mesh (triangle soup) into a `HairCapturePreset`.
//
// Pure and dependency-free (runs in Node via `scripts/capture-hair.mjs` and in
// the unit tests). Two inputs:
//   - the HAIR triangles (world coordinates, 9 floats per triangle);
//   - the source head's LANDMARKS (`HeadLandmarks`): its face-front point at
//     eye height on the midline, facing axes, face half-width W and eye-to-chin
//     drop H — `landmarksFromParts` measures them from skin + eye triangles.
// It casts a ray from the capture centre through every grid cell and keeps the
// OUTERMOST hair hit (the radius grid), supersamples coverage 4×4 per cell and
// converts it to a signed angular distance to the coverage edge (the mask
// grid), inpaints the radius under the no-hair cells so it stays smooth across
// the edge, then quantizes both to bytes (see field.ts for the format).

import { bytesToB64, cellDir, dirVec, type HairCapturePreset, type V3 } from './field';

/** A head's landmark frame (world space). */
export interface HeadLandmarks {
  /** Face-front point at eye height on the midline. */
  origin: V3;
  /** Unit facing / figure's-left / up axes (right-handed: forward × left = up). */
  forward: V3;
  left: V3;
  up: V3;
  /** Face half-width at eye height (cheeks, ears excluded). */
  W: number;
  /** Eye-line to chin drop. */
  H: number;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** World point → landmark units ν = (forward/W, left/W, up/H) about the origin. */
export function toLandmark(lm: HeadLandmarks, p: V3): V3 {
  const q: V3 = [p[0] - lm.origin[0], p[1] - lm.origin[1], p[2] - lm.origin[2]];
  return [dot(q, lm.forward) / lm.W, dot(q, lm.left) / lm.W, dot(q, lm.up) / lm.H];
}

/** Measure a mesh head's landmarks from its SKIN and EYE triangles (world
 *  coords, 9 floats/tri) given its facing axes. Definitions (mirrored by the
 *  rig-side measurement in figureHairCapture.ts):
 *   - eye line / midline: the eye vertices (height: centroid; midline: halfway
 *     between the left and right eye centroids);
 *   - front: the forward-most skin at eye height near the midline;
 *   - H: drop from the eye line to the chin (the lowest skin slab that is still
 *     continuous with the face, scanning down a band behind the face front);
 *   - W: widest skin at eye height between 0.38·H and 0.93·H behind the front
 *     (cheeks — clear of the ears and the face front). */
export function landmarksFromParts(skin: Float32Array, eyes: Float32Array, forward: V3, up: V3): HeadLandmarks {
  const left: V3 = [up[1] * forward[2] - up[2] * forward[1], up[2] * forward[0] - up[0] * forward[2], up[0] * forward[1] - up[1] * forward[0]];
  const proj = (a: Float32Array, i: number): V3 => {
    const p: V3 = [a[i], a[i + 1], a[i + 2]];
    return [dot(p, forward), dot(p, left), dot(p, up)];
  };
  // Eyes: centroid + left/right split for the separation.
  let ec: V3 = [0, 0, 0];
  const ne = eyes.length / 3;
  for (let i = 0; i < eyes.length; i += 3) { const p = proj(eyes, i); ec = [ec[0] + p[0], ec[1] + p[1], ec[2] + p[2]]; }
  ec = [ec[0] / ne, ec[1] / ne, ec[2] / ne];
  let sl = 0, nl = 0, sr = 0, nr = 0;
  for (let i = 0; i < eyes.length; i += 3) { const p = proj(eyes, i); if (p[1] > ec[1]) { sl += p[1]; nl++; } else { sr += p[1]; nr++; } }
  const sep = Math.max(sl / Math.max(nl, 1) - sr / Math.max(nr, 1), 1e-6);
  ec[1] = (sl / Math.max(nl, 1) + sr / Math.max(nr, 1)) / 2;   // midline = between the two eyes
  // Work on TRIANGLES (not vertices) so a coarse mesh measures as well as a dense one.
  const T: V3[][] = [];
  for (let i = 0; i < skin.length; i += 9) T.push([proj(skin, i), proj(skin, i + 3), proj(skin, i + 6)]);
  /** (forward, left) points where the skin crosses the height `h` (edge crossings). */
  const slice = (h: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const t of T) for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3];
      if ((a[2] - h) * (b[2] - h) > 0 || a[2] === b[2]) continue;
      const k = (h - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
    return out;
  };
  const eyeSlice = slice(ec[2]);
  let front = -Infinity;
  for (const [fw, lt] of eyeSlice) if (Math.abs(lt - ec[1]) < 0.25 * sep) front = Math.max(front, fw);
  if (!Number.isFinite(front)) throw new Error('landmarksFromParts: no skin in front of the eyes');
  // Chin: walk down from the eye line while the band just behind the face front still has skin.
  const band = T.filter((t) => {
    const cf = (t[0][0] + t[1][0] + t[2][0]) / 3, cl = (t[0][1] + t[1][1] + t[2][1]) / 3;
    return cf > front - 0.6 * sep && Math.abs(cl - ec[1]) < 0.5 * sep && Math.min(t[0][2], t[1][2], t[2][2]) < ec[2];
  }).map((t) => [Math.min(t[0][2], t[1][2], t[2][2]), Math.max(t[0][2], t[1][2], t[2][2])]);
  let chin = ec[2];
  for (let z = ec[2]; z > ec[2] - 3 * sep; z -= sep / 128) {
    if (!band.some(([lo, hi]) => lo <= z && hi >= z)) break;
    chin = z;
  }
  const H = ec[2] - chin;
  // W: widest crossing at eye height between 0.38·H and 0.93·H behind the front.
  let W = 0;
  const b0 = front - 0.93 * H, b1 = front - 0.38 * H;
  for (const [fw, lt] of eyeSlice) if (fw >= b0 && fw <= b1) W = Math.max(W, Math.abs(lt - ec[1]));
  if (W <= 0) throw new Error('landmarksFromParts: could not measure the face width');
  const origin: V3 = [0, 1, 2].map((k) => forward[k] * front + left[k] * ec[1] + up[k] * ec[2]) as V3;
  return { origin, forward, left, up, W, H };
}

export interface CaptureOptions {
  name: string;
  source: string;
  nAz?: number;
  nEl?: number;
  elMin?: number;
  elMax?: number;
  /** Capture centre / shape radii (ν units); default = the hair's ν bounding box. */
  centre?: V3;
  shape?: V3;
  /** Coverage supersampling per cell axis (default 4). */
  superSample?: number;
  /** Coverage islands / holes smaller than this many supersamples are flipped (default 1.5 cells). */
  minIsland?: number;
}

/** Flip connected components (4-neighbour, azimuth wraps) of either state that
 *  are smaller than `minSize` samples — in place. */
export function removeSmallIslands(grid: Uint8Array, nAz: number, nEl: number, minSize: number): void {
  const seen = new Uint8Array(grid.length);
  const stack: number[] = [], comp: number[] = [];
  for (let start = 0; start < grid.length; start++) {
    if (seen[start]) continue;
    const s = grid[start];
    stack.push(start); seen[start] = 1; comp.length = 0;
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(k);
      const j = Math.floor(k / nAz), i = k - j * nAz;
      const nb = [j * nAz + (i + 1) % nAz, j * nAz + (i + nAz - 1) % nAz, j > 0 ? k - nAz : -1, j < nEl - 1 ? k + nAz : -1];
      for (const q of nb) if (q >= 0 && !seen[q] && grid[q] === s) { seen[q] = 1; stack.push(q); }
    }
    if (comp.length < minSize) for (const k of comp) grid[k] = 1 - s;
  }
}

/** Ray-cast acceleration: triangles binned by the (az, el) cells their
 *  angular footprint touches. */
class DirBins {
  readonly bins: number[][];
  readonly nAz: number;
  readonly nEl: number;
  readonly elMin: number;
  readonly elMax: number;
  constructor(nAz: number, nEl: number, elMin: number, elMax: number) {
    this.nAz = nAz; this.nEl = nEl; this.elMin = elMin; this.elMax = elMax;
    this.bins = Array.from({ length: nAz * nEl }, () => []);
  }
  col(az: number): number { return Math.floor(((az + 180) / 360) * this.nAz); }
  row(el: number): number { return Math.min(Math.max(Math.floor(((el - this.elMin) / (this.elMax - this.elMin)) * this.nEl), 0), this.nEl - 1); }
  at(az: number, el: number): number[] { return this.bins[this.row(el) * this.nAz + ((this.col(az) % this.nAz) + this.nAz) % this.nAz]; }
}

/** Capture a hair mesh into a preset. `tris` = 9 floats per hair triangle (world). */
export function captureHair(tris: Float32Array, lm: HeadLandmarks, opts: CaptureOptions): HairCapturePreset {
  const nAz = opts.nAz ?? 128, nEl = opts.nEl ?? 64;
  const elMin = opts.elMin ?? -90, elMax = opts.elMax ?? 90;
  const SS = opts.superSample ?? 4;
  const g = { nAz, nEl, elMin, elMax };
  const nv = tris.length / 3;
  // ν coordinates + bbox.
  const nu = new Float64Array(nv * 3);
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < nv; v++) {
    const q = toLandmark(lm, [tris[v * 3], tris[v * 3 + 1], tris[v * 3 + 2]]);
    for (let k = 0; k < 3; k++) { nu[v * 3 + k] = q[k]; lo[k] = Math.min(lo[k], q[k]); hi[k] = Math.max(hi[k], q[k]); }
  }
  const round3 = (x: number): number => Math.round(x * 1000) / 1000;
  const centre: V3 = opts.centre ?? [round3((lo[0] + hi[0]) / 2), 0, round3((lo[2] + hi[2]) / 2)];
  const shape: V3 = opts.shape ?? [round3((hi[0] - lo[0]) / 2), round3(Math.max(Math.abs(lo[1]), Math.abs(hi[1]))), round3((hi[2] - lo[2]) / 2)];
  // m-space vertices.
  const m = new Float64Array(nv * 3);
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) m[v * 3 + k] = (nu[v * 3 + k] - centre[k]) / shape[k];
  // Bin triangles by angular footprint (fine bins = the supersampled grid).
  const bins = new DirBins(nAz * SS, nEl * SS, elMin, elMax);
  const nt = nv / 3;
  const angOf = (v: number): [number, number] => {
    const x = m[v * 3], y = m[v * 3 + 1], z = m[v * 3 + 2];
    return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, z / (Math.hypot(x, y, z) || 1)))) * 180 / Math.PI];
  };
  for (let t = 0; t < nt; t++) {
    const a = [angOf(3 * t), angOf(3 * t + 1), angOf(3 * t + 2)];
    let az0 = Math.min(a[0][0], a[1][0], a[2][0]), az1 = Math.max(a[0][0], a[1][0], a[2][0]);
    const el0 = Math.min(a[0][1], a[1][1], a[2][1]), el1 = Math.max(a[0][1], a[1][1], a[2][1]);
    let full = false;
    if (az1 - az0 > 180) {
      // Straddles the ±180 seam (or wraps a pole): unwrap negatives.
      const un = a.map((x) => (x[0] < 0 ? x[0] + 360 : x[0]));
      az0 = Math.min(...un); az1 = Math.max(...un);
      if (az1 - az0 > 180) full = true;
    }
    const pad = 360 / bins.nAz;
    const r0 = bins.row(el0 - pad), r1 = bins.row(el1 + pad);
    const c0 = full ? 0 : bins.col(az0 - pad), c1 = full ? bins.nAz - 1 : bins.col(az1 + pad);
    for (let r = r0; r <= r1; r++) {
      const polar = full || r === 0 || r === bins.nEl - 1;
      const cs = polar ? 0 : c0, ce = polar ? bins.nAz - 1 : c1;
      for (let c = cs; c <= ce; c++) bins.bins[r * bins.nAz + (((c % bins.nAz) + bins.nAz) % bins.nAz)].push(t);
    }
  }
  /** Outermost hit distance along unit direction d from the origin (−1 = miss). */
  const cast = (az: number, el: number): number => {
    const d = dirVec(az, el);
    let best = -1;
    for (const t of bins.at(az, el)) {
      const i0 = 9 * t;
      const ax = m[i0], ay = m[i0 + 1], az_ = m[i0 + 2];
      const e1x = m[i0 + 3] - ax, e1y = m[i0 + 4] - ay, e1z = m[i0 + 5] - az_;
      const e2x = m[i0 + 6] - ax, e2y = m[i0 + 7] - ay, e2z = m[i0 + 8] - az_;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det;
      const tx = -ax, ty = -ay, tz = -az_;
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > best) best = tt;
    }
    return best;
  };
  // Fine (supersampled) coverage, cleaned of specks and pin-holes smaller than
  // ~1.5 cells (gaps where overlapping locks leave a sliver of skin showing
  // would otherwise punch pits through the hair).
  const n = nAz * nEl;
  const fAz = nAz * SS, fEl = nEl * SS;
  const fg = { nAz: fAz, nEl: fEl, elMin, elMax };
  const fcov = new Uint8Array(fAz * fEl), fR = new Float64Array(fAz * fEl);
  for (let j = 0; j < fEl; j++) for (let i = 0; i < fAz; i++) {
    const [az, el] = cellDir(fg, i, j);
    const t = cast(az, el);
    fcov[j * fAz + i] = t > 0 ? 1 : 0;
    fR[j * fAz + i] = t;
  }
  removeSmallIslands(fcov, fAz, fEl, opts.minIsland ?? Math.round(SS * SS * 1.5));
  // Coarse coverage = majority of each cell's fine block; radius = the MEAN
  // outermost hit over the block's hair rays (a box filter: a lock edge crossing
  // the cell becomes a sub-cell-positioned ramp instead of a staircase).
  // Cells with no hair rays get inpainted.
  const R = new Float64Array(n), cov = new Uint8Array(n);
  for (let j = 0; j < nEl; j++) for (let i = 0; i < nAz; i++) {
    let c = 0, sum = 0, nHit = 0;
    for (let b = 0; b < SS; b++) for (let a = 0; a < SS; a++) {
      const k = (j * SS + b) * fAz + i * SS + a;
      c += fcov[k];
      if (fR[k] > 0) { sum += fR[k]; nHit++; }
    }
    if (2 * c < SS * SS) continue;
    cov[j * nAz + i] = 1;
    R[j * nAz + i] = nHit ? sum / nHit : NaN;
  }
  const edge: [V3[], V3[]] = [[], []];   // [uncovered edge samples, covered edge samples]
  for (let j = 0; j < fEl; j++) for (let i = 0; i < fAz; i++) {
    const s = fcov[j * fAz + i];
    const nb = [fcov[j * fAz + (i + 1) % fAz], fcov[j * fAz + (i + fAz - 1) % fAz],
      j > 0 ? fcov[(j - 1) * fAz + i] : s, j < fEl - 1 ? fcov[(j + 1) * fAz + i] : s];
    if (nb.some((x) => x !== s)) { const [az, el] = cellDir(fg, i, j); edge[s].push(dirVec(az, el)); }
  }
  const half = (((elMax - elMin) / fEl) / 2) * Math.PI / 180;
  const MASK_SCALE = 4, MASK_LIM = 127 / MASK_SCALE;
  const M = new Float64Array(n);
  for (let j = 0; j < nEl; j++) for (let i = 0; i < nAz; i++) {
    const [az, el] = cellDir(g, i, j);
    const d = dirVec(az, el), s = cov[j * nAz + i];
    const opp = edge[1 - s];
    let best = 1;   // max cos
    let bestCos = -1;
    for (const e of opp) { const c = d[0] * e[0] + d[1] * e[1] + d[2] * e[2]; if (c > bestCos) bestCos = c; }
    best = opp.length ? Math.acos(Math.min(1, bestCos)) : Math.PI;
    const dist = Math.max(best - half, 0) * 180 / Math.PI;
    M[j * nAz + i] = Math.max(-MASK_LIM, Math.min(MASK_LIM, s ? dist : -dist));
  }
  // Inpaint the radius under no-hair cells (Jacobi diffusion, covered cells fixed).
  let mean = 0, nc = 0;
  const fixed = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (cov[i] && Number.isFinite(R[i])) { mean += R[i]; nc++; fixed[i] = 1; }
  if (!nc) throw new Error('captureHair: no hair triangles were hit — check the landmarks / facing axes');
  mean /= nc;
  for (let i = 0; i < n; i++) if (!fixed[i]) R[i] = mean;
  const tmp = new Float64Array(n);
  for (let it = 0; it < 600; it++) {
    for (let j = 0; j < nEl; j++) for (let i = 0; i < nAz; i++) {
      const k = j * nAz + i;
      if (fixed[k]) { tmp[k] = R[k]; continue; }
      const up = j < nEl - 1 ? R[k + nAz] : R[k], dn = j > 0 ? R[k - nAz] : R[k];
      tmp[k] = (R[j * nAz + (i + 1) % nAz] + R[j * nAz + (i + nAz - 1) % nAz] + up + dn) / 4;
    }
    R.set(tmp);
  }
  let rMin = Infinity, rMax = -Infinity;
  for (let i = 0; i < n; i++) { rMin = Math.min(rMin, R[i]); rMax = Math.max(rMax, R[i]); }
  rMin = Math.floor(rMin * 1000) / 1000; rMax = Math.ceil(rMax * 1000) / 1000;
  const rb = new Uint8Array(n), mb = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    rb[i] = Math.round(((R[i] - rMin) / (rMax - rMin)) * 255);
    mb[i] = Math.round(M[i] * MASK_SCALE);
  }
  return {
    name: opts.name, source: opts.source, nAz, nEl, elMin, elMax, centre, shape, rMin, rMax,
    maskScale: MASK_SCALE, radius: bytesToB64(rb), mask: bytesToB64(new Uint8Array(mb.buffer)),
  };
}
