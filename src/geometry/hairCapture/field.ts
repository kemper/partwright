// Captured hair field — the pure (dependency-free) half of the 'captured' hair
// style (`F.hair(rig, { style: 'captured', preset })`).
//
// A captured hairdo is stored as two spherical grids over a head-normalized
// frame (see `HairCapturePreset`):
//   - RADIUS: the distance from a capture centre to the hair's OUTER surface
//     along each (azimuth, elevation) direction — a radial height field;
//   - MASK: the signed angular distance (deg) to the edge of the hair coverage
//     (positive = hair, negative = no hair: the face window, under the hem).
// Hair is everything inside the radius AND inside the mask, so the field is
// star-shaped from the centre; overhangs (a fringe lock lying over the
// forehead) fill in solid down to the head. Both grids are interpolated with a
// C1 Catmull-Rom cubic, so spike tips stay sharp with no stair-stepping, and
// the mask is a distance field, so the hairline / hem keep crisp sub-cell
// outlines.
//
// The frame is LANDMARK-based so a capture maps onto any head: ν = (forward,
// left, up) measured from the face-front point at eye height on the midline,
// in units of (W, W, H) — W = face half-width at eye height, H = eye-to-chin
// drop. `measure`d once on the source mesh (stored in the preset) and once on
// the target head at build time.

export type V3 = [number, number, number];

/** A captured hairdo (the data module `presets/<name>.ts` exports one). */
export interface HairCapturePreset {
  name: string;
  /** Where it came from (free text, for humans). */
  source: string;
  /** Grid size: `nAz` columns over azimuth −180..180 (0 = face front, +90 =
   *  the figure's LEFT), `nEl` rows over elevation `elMin..elMax` (deg). */
  nAz: number;
  nEl: number;
  elMin: number;
  elMax: number;
  /** Capture centre in landmark units ν = (forward, left, up). */
  centre: V3;
  /** Per-axis shape radii (ν units): directions/radii are taken in the
   *  normalized space m = (ν − centre) / shape, where the hair is ≈ a unit sphere. */
  shape: V3;
  /** Radius quantization: byte b ↦ rMin + (rMax − rMin)·b/255 (m units). */
  rMin: number;
  rMax: number;
  /** Mask quantization: int8 value v ↦ v / maskScale degrees. */
  maskScale: number;
  /** base64 Uint8 radius grid, row-major (row = elevation, from elMin). */
  radius: string;
  /** base64 Int8 mask grid, same layout. */
  mask: string;
}

/** A decoded grid pair (Float64, row-major el × az). */
export interface HairGrids {
  nAz: number;
  nEl: number;
  elMin: number;
  elMax: number;
  radius: Float64Array;
  mask: Float64Array;
}

const DEG = Math.PI / 180;

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64 encode (pure, no Buffer) — the capture side's inverse of b64ToBytes. */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Throw unless the grid is `nAz` × `nEl` positive EVEN integers — the build
 *  samples the skin at half resolution, and the capture supersamples per cell. */
export function assertGridSize(nAz: unknown, nEl: unknown, where: string): void {
  const ok = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 2 && v % 2 === 0;
  if (!ok(nAz) || !ok(nEl)) throw new Error(`${where}: grid must be positive even integers (az × el), got ${String(nAz)} × ${String(nEl)}`);
}

/** Quantize radii to bytes over [rMin, rMax] (rounded out to 1e-3). A constant
 *  field gets a non-zero span so the mapping never divides by zero. */
export function quantizeRadii(R: Float64Array): { rMin: number; rMax: number; bytes: Uint8Array } {
  let rMin = Infinity, rMax = -Infinity;
  for (const v of R) { rMin = Math.min(rMin, v); rMax = Math.max(rMax, v); }
  rMin = Math.floor(rMin * 1000) / 1000; rMax = Math.ceil(rMax * 1000) / 1000;
  if (!(rMax - rMin > 1e-9)) rMax = rMin + 1e-3;
  const bytes = new Uint8Array(R.length);
  for (let i = 0; i < R.length; i++) bytes[i] = Math.round(((R[i] - rMin) / (rMax - rMin)) * 255);
  return { rMin, rMax, bytes };
}

/** Decode a preset's quantized grids into Float64 grids. */
export function decodePreset(p: HairCapturePreset): HairGrids {
  assertGridSize(p.nAz, p.nEl, `hair preset '${p.name}'`);
  const n = p.nAz * p.nEl;
  const rb = b64ToBytes(p.radius), mb = b64ToBytes(p.mask);
  if (rb.length !== n || mb.length !== n) throw new Error(`hair preset '${p.name}': grid size mismatch (${rb.length}/${mb.length} vs ${n})`);
  const radius = new Float64Array(n), mask = new Float64Array(n);
  const mi = new Int8Array(mb.buffer, mb.byteOffset, n);
  for (let i = 0; i < n; i++) {
    radius[i] = p.rMin + ((p.rMax - p.rMin) * rb[i]) / 255;
    mask[i] = mi[i] / p.maskScale;
  }
  return { nAz: p.nAz, nEl: p.nEl, elMin: p.elMin, elMax: p.elMax, radius, mask };
}

// --- Spherical-grid sampling ------------------------------------------------

/** Grid-space coordinates of a direction: fractional column / row (cell centres at integers). */
function gridXY(g: { nAz: number; nEl: number; elMin: number; elMax: number }, azDeg: number, elDeg: number): [number, number] {
  const x = ((azDeg + 180) / 360) * g.nAz - 0.5;
  const y = ((elDeg - g.elMin) / (g.elMax - g.elMin)) * g.nEl - 0.5;
  return [x, y];
}

/** Catmull-Rom weights for fractional offset t ∈ [0, 1). */
function crWeights(t: number, w: number[]): void {
  const t2 = t * t, t3 = t2 * t;
  w[0] = -0.5 * t3 + t2 - 0.5 * t;
  w[1] = 1.5 * t3 - 2.5 * t2 + 1;
  w[2] = -1.5 * t3 + 2 * t2 + 0.5 * t;
  w[3] = 0.5 * t3 - 0.5 * t2;
}

const WX = [0, 0, 0, 0], WY = [0, 0, 0, 0];

/** Bicubic (Catmull-Rom) sample of a spherical grid: azimuth wraps, elevation
 *  clamps. `clampRing` limits the result to the range of the 4 nearest cells —
 *  no overshoot ringing beside cliffs (a lock edge over the layer below) at the
 *  cost of strict C1 there. */
export function sampleCubic(grid: Float64Array, g: { nAz: number; nEl: number; elMin: number; elMax: number }, azDeg: number, elDeg: number, clampRing = false): number {
  const [x, y0] = gridXY(g, azDeg, elDeg);
  const y = Math.min(Math.max(y0, 0), g.nEl - 1);
  const ix = Math.floor(x), iy = Math.floor(y);
  crWeights(x - ix, WX);
  crWeights(y - iy, WY);
  let s = 0;
  for (let b = 0; b < 4; b++) {
    const row = Math.min(Math.max(iy - 1 + b, 0), g.nEl - 1) * g.nAz;
    let r = 0;
    for (let a = 0; a < 4; a++) {
      let col = (ix - 1 + a) % g.nAz;
      if (col < 0) col += g.nAz;
      r += WX[a] * grid[row + col];
    }
    s += WY[b] * r;
  }
  if (clampRing) {
    const r0 = iy * g.nAz, r1 = Math.min(iy + 1, g.nEl - 1) * g.nAz;
    const c0 = ((ix % g.nAz) + g.nAz) % g.nAz, c1 = (c0 + 1) % g.nAz;
    const a = grid[r0 + c0], b = grid[r0 + c1], c = grid[r1 + c0], d = grid[r1 + c1];
    s = Math.min(Math.max(s, Math.min(a, b, c, d)), Math.max(a, b, c, d));
  }
  return s;
}

/** Bilinear sample (same addressing as sampleCubic) — for the slowly varying helper grids. */
export function sampleLinear(grid: Float64Array, g: { nAz: number; nEl: number; elMin: number; elMax: number }, azDeg: number, elDeg: number): number {
  const [x, y0] = gridXY(g, azDeg, elDeg);
  const y = Math.min(Math.max(y0, 0), g.nEl - 1);
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const c0 = ((ix % g.nAz) + g.nAz) % g.nAz, c1 = (c0 + 1) % g.nAz;
  const r0 = iy * g.nAz, r1 = Math.min(iy + 1, g.nEl - 1) * g.nAz;
  return (grid[r0 + c0] * (1 - fx) + grid[r0 + c1] * fx) * (1 - fy) + (grid[r1 + c0] * (1 - fx) + grid[r1 + c1] * fx) * fy;
}

/** Cell-centre direction of grid cell (i, j) → [azDeg, elDeg]. */
export function cellDir(g: { nAz: number; nEl: number; elMin: number; elMax: number }, i: number, j: number): [number, number] {
  return [-180 + ((i + 0.5) * 360) / g.nAz, g.elMin + ((j + 0.5) * (g.elMax - g.elMin)) / g.nEl];
}

/** Unit vector (forward, left, up) of azimuth/elevation (deg). */
export function dirVec(azDeg: number, elDeg: number): V3 {
  const a = azDeg * DEG, e = elDeg * DEG, ce = Math.cos(e);
  return [ce * Math.cos(a), ce * Math.sin(a), Math.sin(e)];
}

/** Azimuth/elevation (deg) of a non-zero (forward, left, up) vector. */
export function vecDir(v: V3): [number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.atan2(v[1], v[0]) / DEG, Math.asin(Math.max(-1, Math.min(1, v[2] / l))) / DEG];
}

/** Separable Gaussian blur of a spherical grid (σ in CELLS of elevation; the
 *  azimuth kernel widens by 1/cos(el) so the blur is ≈ isotropic in angle). */
export function blurGrid(grid: Float64Array, g: { nAz: number; nEl: number; elMin: number; elMax: number }, sigma: number): Float64Array {
  if (sigma <= 1e-3) return grid.slice();
  const { nAz, nEl } = g;
  const tmp = new Float64Array(grid.length), out = new Float64Array(grid.length);
  const cellEl = (g.elMax - g.elMin) / nEl, cellAz = 360 / nAz;
  for (let j = 0; j < nEl; j++) {
    const el = g.elMin + (j + 0.5) * cellEl;
    const sAz = Math.min((sigma * cellEl) / cellAz / Math.max(Math.cos(el * DEG), 0.08), nAz / 3);
    const rad = Math.ceil(sAz * 3);
    for (let i = 0; i < nAz; i++) {
      let s = 0, ws = 0;
      for (let k = -rad; k <= rad; k++) {
        const w = Math.exp((-k * k) / (2 * sAz * sAz));
        s += w * grid[j * nAz + ((((i + k) % nAz) + nAz) % nAz)]; ws += w;
      }
      tmp[j * nAz + i] = s / ws;
    }
  }
  const rad = Math.ceil(sigma * 3);
  for (let j = 0; j < nEl; j++) {
    for (let i = 0; i < nAz; i++) {
      let s = 0, ws = 0;
      for (let k = -rad; k <= rad; k++) {
        const jj = Math.min(Math.max(j + k, 0), nEl - 1);
        const w = Math.exp((-k * k) / (2 * sigma * sigma));
        s += w * tmp[jj * nAz + i]; ws += w;
      }
      out[j * nAz + i] = s / ws;
    }
  }
  return out;
}

/** Grey dilation (max filter) over a (2r+1)² cell window; azimuth wraps. */
export function dilateGrid(grid: Float64Array, g: { nAz: number; nEl: number }, r: number): Float64Array {
  const { nAz, nEl } = g;
  const tmp = new Float64Array(grid.length), out = new Float64Array(grid.length);
  for (let j = 0; j < nEl; j++) for (let i = 0; i < nAz; i++) {
    let m = -Infinity;
    for (let k = -r; k <= r; k++) m = Math.max(m, grid[j * nAz + (((i + k) % nAz) + nAz) % nAz]);
    tmp[j * nAz + i] = m;
  }
  for (let j = 0; j < nEl; j++) for (let i = 0; i < nAz; i++) {
    let m = -Infinity;
    for (let k = Math.max(0, j - r); k <= Math.min(nEl - 1, j + r); k++) m = Math.max(m, tmp[k * nAz + i]);
    out[j * nAz + i] = m;
  }
  return out;
}

// --- Knobs: resample the captured grids into the final (per-build) grids ----

/** Style knobs. Every default reproduces the capture literally. */
export interface HairKnobs {
  /** Hair thickness above the target skull (×). */
  volume: number;
  /** Amplify (>1) or calm (<1) the detail — deviation from a blurred copy of
   *  the radius + mask (spike height, hem/fringe point depth). */
  spikiness: number;
  /** 0..1 — Gaussian softening of both grids (rounds tips and points). */
  smooth: number;
  /** Hem length: stretches the side/back hair below the pivot (×). */
  length: number;
  /** Fringe drop: stretches the front hair below its root (×; <1 lifts it). */
  fringe: number;
  /** Flip left/right (puts the part on the other side). */
  mirror: boolean;
  /** Pitch the whole hairdo about the ear-to-ear axis (deg; + sweeps it back). */
  tilt: number;
  /** Face-window size (×) — scales the bare-face opening about its centre. */
  windowScale: number;
}

export const DEFAULT_KNOBS: HairKnobs = {
  volume: 1, spikiness: 1, smooth: 0, length: 1, fringe: 1, mirror: false, tilt: 0, windowScale: 1,
};

// Internal capture-remap constants (degrees, in the normalized m-space).
/** Elevation the hem stretch (`length`) pivots about. */
const HEM_PIVOT_EL = 0;
/** Elevation the fringe stretch pivots about (≈ the fringe roots). */
const FRINGE_PIVOT_EL = 38;
/** Face-window centre the `windowScale` zoom is taken about. */
const WINDOW_CENTRE_EL = -12;
/** Blur (cells) defining the "smooth base" the spikiness knob is measured from. */
const SPIKE_BASE_SIGMA = 2.5;
/** Max blur (cells) at smooth = 1. */
const SMOOTH_MAX_SIGMA = 3;
/** Skull-guard lift: deficit dilation radius + blur (cells). */
const LIFT_DILATE = 3;
const LIFT_SIGMA = 2.5;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Front-sector weight (1 over the face, fading to 0 by the temples). */
const frontW = (az: number, a0: number, a1: number): number => 1 - smoothstep(a0, a1, Math.abs(az));

/** Map a TARGET direction to the SOURCE direction it samples, applying the
 *  geometric knobs (mirror, tilt, windowScale, fringe, length) as an inverse
 *  warp of the sphere. Pure, so the same mapping can be unit-tested. */
export function sourceDir(azDeg: number, elDeg: number, k: HairKnobs): [number, number] {
  let az = azDeg, el = elDeg;
  if (k.mirror) az = -az;
  if (k.tilt !== 0) {
    // Rotate the direction about the left axis by −tilt (inverse warp).
    const v = dirVec(az, el), a = -k.tilt * DEG, c = Math.cos(a), s = Math.sin(a);
    [az, el] = vecDir([v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]);
  }
  if (k.windowScale !== 1) {
    const w = frontW(az, 70, 130);
    const z = 1 + (1 / k.windowScale - 1) * w;
    az *= z;
    el = WINDOW_CENTRE_EL + (el - WINDOW_CENTRE_EL) * z;
  }
  if (k.fringe !== 1 && el < FRINGE_PIVOT_EL) {
    const w = frontW(az, 45, 80);
    el = FRINGE_PIVOT_EL + (el - FRINGE_PIVOT_EL) / (1 + (k.fringe - 1) * w);
  }
  if (k.length !== 1 && el < HEM_PIVOT_EL) {
    const w = 1 - frontW(az, 55, 95);
    el = HEM_PIVOT_EL + (el - HEM_PIVOT_EL) / (1 + (k.length - 1) * w);
  }
  return [az, Math.max(-90, Math.min(90, el))];
}

/** The per-build field: final radius + mask grids (knobs baked in) plus the
 *  Lipschitz factor grid used to keep the SDF ≈ a true distance. */
export interface HairField extends HairGrids {
  /** sqrt(1 + |∇R|² / R²) per cell — divides the radial SDF so steep spikes
   *  don't over-report distance. */
  lip: Float64Array;
}

/** Bake the knobs into the final grids. `skin` (optional) is the target head's
 *  skin radius per cell (same grid, m units) and `minThick` the minimum hair
 *  thickness above it (m units): `volume` scales the thickness ABOVE the skin,
 *  and the guard keeps the skull from poking through where the target head is
 *  bigger than the source's. */
export function bakeField(src: HairGrids, k: HairKnobs, skin?: Float64Array, minThick: Float64Array | number = 0): HairField {
  const { nAz, nEl } = src;
  const n = nAz * nEl;
  let radius = new Float64Array(n), mask = new Float64Array(n);
  for (let j = 0; j < nEl; j++) {
    for (let i = 0; i < nAz; i++) {
      const [az, el] = cellDir(src, i, j);
      const [sa, se] = sourceDir(az, el, k);
      radius[j * nAz + i] = sampleCubic(src.radius, src, sa, se);
      mask[j * nAz + i] = sampleCubic(src.mask, src, sa, se);
    }
  }
  if (k.spikiness !== 1) {
    const rb = blurGrid(radius, src, SPIKE_BASE_SIGMA), mbl = blurGrid(mask, src, SPIKE_BASE_SIGMA);
    for (let i = 0; i < n; i++) {
      radius[i] = rb[i] + k.spikiness * (radius[i] - rb[i]);
      mask[i] = mbl[i] + k.spikiness * (mask[i] - mbl[i]);
    }
  }
  if (k.smooth > 0) {
    radius = blurGrid(radius, src, k.smooth * SMOOTH_MAX_SIGMA);
    mask = blurGrid(mask, src, k.smooth * SMOOTH_MAX_SIGMA);
  }
  if (skin) {
    const tMin = (i: number): number => (typeof minThick === 'number' ? minThick : minThick[i]);
    // Where the target skull rises above the captured surface (a taller or
    // deeper head than the source's), LIFT the hair by a smooth offset — the
    // dilated + blurred deficit — instead of clamping it flat to the skull, so
    // the locks keep their own layering and no ledge marks the clamp edge.
    const deficit = new Float64Array(n);
    for (let i = 0; i < n; i++) if (mask[i] > 0) deficit[i] = Math.max(0, skin[i] + tMin(i) - radius[i]);
    const lift = blurGrid(dilateGrid(deficit, src, LIFT_DILATE), src, LIFT_SIGMA);
    for (let i = 0; i < n; i++) {
      const th = Math.max(radius[i] + lift[i] - skin[i], tMin(i) * 0.5);
      radius[i] = skin[i] + k.volume * th;
    }
  } else if (k.volume !== 1) {
    for (let i = 0; i < n; i++) radius[i] *= k.volume;
  }
  for (let i = 0; i < n; i++) radius[i] = Math.max(radius[i], 1e-3);
  // Lipschitz factor from central differences (per radian).
  const lip = new Float64Array(n);
  const dEl = ((src.elMax - src.elMin) / nEl) * DEG, dAz = (360 / nAz) * DEG;
  for (let j = 0; j < nEl; j++) {
    const [, el] = cellDir(src, 0, j);
    const ce = Math.max(Math.cos(el * DEG), 0.05);
    const jm = Math.max(j - 1, 0), jp = Math.min(j + 1, nEl - 1);
    for (let i = 0; i < nAz; i++) {
      const im = (i + nAz - 1) % nAz, ip = (i + 1) % nAz;
      const r = radius[j * nAz + i];
      const gEl = (radius[jp * nAz + i] - radius[jm * nAz + i]) / ((jp - jm) * dEl || 1);
      const gAz = (radius[j * nAz + ip] - radius[j * nAz + im]) / (2 * dAz * ce);
      lip[j * nAz + i] = Math.sqrt(1 + (gEl * gEl + gAz * gAz) / (r * r));
    }
  }
  return { nAz, nEl, elMin: src.elMin, elMax: src.elMax, radius, mask, lip };
}

/** Signed distance (m units, ≈ scaled to the local radius) of a point given in
 *  the normalized m-space: negative inside the hair. `scaleAt(d)` converts a
 *  unit of m along unit direction d into world units (anisotropic frames). */
export function fieldValue(f: HairField, m: V3): { d: number; rho: number; az: number; el: number } {
  const rho = Math.hypot(m[0], m[1], m[2]);
  if (rho < 1e-9) return { d: -sampleLinear(f.radius, f, 0, 0), rho, az: 0, el: 0 };
  const az = Math.atan2(m[1], m[0]) / DEG;
  const el = Math.asin(Math.max(-1, Math.min(1, m[2] / rho))) / DEG;
  const R = sampleCubic(f.radius, f, az, el, true);
  const radial = (rho - R) / sampleLinear(f.lip, f, az, el);
  const side = -sampleCubic(f.mask, f, az, el) * DEG * rho;   // angular distance → arc length
  return { d: Math.max(radial, side), rho, az, el };
}
