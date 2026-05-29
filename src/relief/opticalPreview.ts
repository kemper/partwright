// Optically-honest preview for stepped-relief prints. Bakes a composited
// color per triangle into the existing per-triangle color buffer so both the
// live viewport and the offscreen AI renderer pick it up for free.

import type { MeshData } from '../geometry/types';
import type { ColorRegion } from '../color/regions';
import { buildTriColors, createEmptyTriColors, overlayPainted } from '../color/regions';
import type { Filament, HeightBand, PreviewMode } from './types';
import { hexToRgb } from './filaments';

const EPS = 1e-4;

function colorDist2(a: [number, number, number], b: [number, number, number]): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/** Transmission distance (mm) of the filament whose color is closest to
 *  `color` (0..1 RGB). Falls back to td=1 when the library is empty. */
export function nearestFilamentTd(color: [number, number, number], filaments: readonly Filament[]): number {
  let bestTd = 1;
  let best = Infinity;
  for (const f of filaments) {
    const d = colorDist2(color, hexToRgb(f.hex));
    if (d < best) {
      best = d;
      bestTd = f.td;
    }
  }
  return bestTd;
}

interface TriGeom {
  cz: Float32Array; // centroid z per triangle
  nz: Float32Array; // unit normal z (up-facing-ness) per triangle
}

/** Single pass over the mesh: centroid z + up-facing-ness of each triangle.
 *  Returns flat typed arrays (no per-triangle object) to stay cheap at 100k+. */
function triGeometry(mesh: MeshData): TriGeom {
  const { vertProperties: vp, triVerts: tv, numTri, numProp } = mesh;
  const cz = new Float32Array(numTri);
  const nz = new Float32Array(numTri);
  for (let t = 0; t < numTri; t++) {
    const ia = tv[t * 3] * numProp;
    const ib = tv[t * 3 + 1] * numProp;
    const ic = tv[t * 3 + 2] * numProp;
    const ax = vp[ia], ay = vp[ia + 1], az = vp[ia + 2];
    const bx = vp[ib], by = vp[ib + 1], bz = vp[ib + 2];
    const cx = vp[ic], cy = vp[ic + 1], ccz = vp[ic + 2];
    // Cross product of edges → face normal; we only need its z, normalized.
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = ccz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, fnz) || 1;
    cz[t] = (az + bz + ccz) / 3;
    nz[t] = fnz / len;
  }
  return { cz, nz };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function buildPreviewTriColors(
  mesh: MeshData,
  _regions: readonly ColorRegion[],
  bands: readonly HeightBand[],
  filaments: readonly Filament[],
  mode: PreviewMode,
  _layerHeight: number,
): Uint8Array | null {
  const numTri = mesh.numTri;

  // Region store is the source of truth for painted triangles (the `_regions`
  // arg mirrors it for callers that pass an explicit snapshot).
  const flat = buildTriColors(numTri, true);

  if (mode === 'flat') return flat;

  if (mode === 'ams') {
    // Per-XY full color already; add depth so the relief reads as glossy
    // multi-material filament rather than flat paint: top faces gain a warm
    // highlight, near-vertical walls darken for shadow — clearly distinct from
    // 'flat' even on a fully top-painted relief.
    if (!flat) return null;
    const geom = triGeometry(mesh);
    const painted = (flat as Uint8Array & { _painted?: Uint8Array })._painted;
    for (let t = 0; t < numTri; t++) {
      if (painted && painted[t] !== 1) continue;
      const up = Math.max(0, geom.nz[t]); // 0 (side) .. 1 (top)
      const sheen = 0.08 + 0.24 * up;     // 0.08 (wall) .. 0.32 (top)
      const shade = up < 0.2 ? 0.8 : 1;   // darken near-vertical walls for depth
      flat[t * 3] = Math.round(mix(flat[t * 3] * shade, 242, sheen));
      flat[t * 3 + 1] = Math.round(mix(flat[t * 3 + 1] * shade, 242, sheen));
      flat[t * 3 + 2] = Math.round(mix(flat[t * 3 + 2] * shade, 238, sheen));
    }
    return flat;
  }

  // single-nozzle: composite the derived swap stack via Beer–Lambert.
  const buf = createEmptyTriColors(numTri);
  if (bands.length === 0) {
    // Nothing to composite — preserve whatever the user painted.
    return flat ?? buf;
  }

  const geom = triGeometry(mesh);

  // Precompute per-band optics so the per-triangle loop is O(triangles * bands).
  const bandColors = bands.map(b => b.color);
  const bandTd = bands.map(b => nearestFilamentTd(b.color, filaments));
  const bandMid = bands.map(b => (b.zStart + b.zEnd) / 2);
  // Sort band indices by zStart so we can composite bottom→up and bail early.
  const order = bands.map((_, i) => i).sort((a, b) => bands[a].zStart - bands[b].zStart);

  // Single pass: write each triangle's color through overlayPainted (keeps the
  // `_painted` sidecar correct). Reuse one index + one color tuple so a 100k+
  // mesh doesn't allocate per triangle.
  const one: [number] = [0];
  const col: [number, number, number] = [0, 0, 0];

  for (let t = 0; t < numTri; t++) {
    const h = geom.cz[t];

    if (geom.nz[t] <= 0.2) {
      // Side wall — show the nearest band's plain color (no stacking).
      let best = Infinity;
      let bestColor = bandColors[0];
      for (let bi = 0; bi < bands.length; bi++) {
        const d = Math.abs(bandMid[bi] - h);
        if (d < best) {
          best = d;
          bestColor = bandColors[bi];
        }
      }
      col[0] = bestColor[0];
      col[1] = bestColor[1];
      col[2] = bestColor[2];
    } else {
      // Top/upward face: light travels up through every band that lies below h,
      // attenuating per channel toward each band's pigment (Beer–Lambert).
      let r = 1, g = 1, b = 1; // white backlight
      for (const bi of order) {
        const band = bands[bi];
        if (band.zStart >= h) break; // band starts above this surface
        const thickness = Math.min(band.zEnd, h) - band.zStart;
        if (thickness <= 0) continue;
        const trans = Math.exp(-thickness / Math.max(bandTd[bi], EPS)); // 1 = clear, 0 = opaque
        const [cr, cg, cb] = bandColors[bi];
        // Thin layer → keep incoming light; thick → pull toward pigment color.
        r *= mix(cr, 1, trans);
        g *= mix(cg, 1, trans);
        b *= mix(cb, 1, trans);
      }
      col[0] = r;
      col[1] = g;
      col[2] = b;
    }

    one[0] = t;
    overlayPainted(buf, one, col);
  }
  return buf;
}
