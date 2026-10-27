// Footwear for the parametric human, as signed-distance fields the caller
// meshes with Manifold.levelSet. Pure (no WASM).
//
// A shell offset straight off the skin copies every toe, so a shoe built that
// way reads as a painted foot. Instead each shoe starts from the foot's own
// signed distance, CLOSED (dilate then erode) so the gaps between the toes
// fill into one rounded toe box, pushed out by the upper's thickness and
// extruded along the sole's normal for the sole — then cut where the shoe
// ends on the shin. Built on the posed foot in world units, so it follows any
// pose.

import { rasterizeOccupancy, signedFieldFromOccupancy, closeField, blurField, makeTrilinearSampler, type GridSpec } from '../geometry/meshSdf';
import type { HumanAsset, HumanMesh, Vec3 } from './humanModel';

export const FOOTWEAR_ITEMS = ['shoes', 'sneakers', 'boots', 'sabatons'] as const;

/** Per-style shape, as fractions of the print height. */
const STYLES: Record<typeof FOOTWEAR_ITEMS[number], { top: number; thick: number; sole: number; close: number; heel: number }> = {
  shoes:    { top: 0.012, thick: 0.003, sole: 0.005, close: 0.008, heel: 0.003 },
  sneakers: { top: 0.02, thick: 0.004, sole: 0.009, close: 0.009, heel: 0 },
  boots:    { top: 0.11, thick: 0.004, sole: 0.007, close: 0.009, heel: 0.006 },
  sabatons: { top: 0.025, thick: 0.006, sole: 0.004, close: 0.013, heel: 0 },
};
/** Footwear lattice steps per ankle-to-toe length (sized by the foot, so a
 *  toy's big feet don't mesh finer than they need). */
const FOOTWEAR_STEPS_PER_FOOT = 28;
/** How fast the shoe's top edge rises toward the toes (per unit forward). */
const TOE_RISE = 0.7;

export interface FootwearField { field: Float32Array; spec: GridSpec; minZ: number }

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Distance from p to the segment a→b. */
function segDist(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a), ap = sub(p, a);
  const t = Math.min(1, Math.max(0, dot(ap, ab) / (dot(ab, ab) || 1)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/**
 * One footwear item: a field per foot (negative inside), in world units.
 * `thickness` scales the upper; `extraThickness` (world units) clears what is
 * already worn on the feet (socks).
 */
export function buildFootwear(asset: HumanAsset, mesh: HumanMesh, item: typeof FOOTWEAR_ITEMS[number], height: number, thickness = 1, extraThickness = 0): FootwearField[] {
  const st = STYLES[item];
  const h = height;
  const J = (n: string) => mesh.joints.get(`${n}____head`)!;
  const footLen = Math.hypot(...([0, 1, 2].map((c) => J('toe3-1.L')[c] - J('foot.L')[c]) as [number, number, number]));
  const voxel = footLen / FOOTWEAR_STEPS_PER_FOOT;
  const boneIndex = new Map(asset.bones.map((b, i) => [b.name, i]));
  const skinTris: number[] = [];
  for (let t = 0; t < asset.nT; t++) {
    if (asset.triLabel[t] !== 0) continue;
    skinTris.push(asset.triVerts[t * 3], asset.triVerts[t * 3 + 1], asset.triVerts[t * 3 + 2]);
  }
  const skinVerts = [...new Set(skinTris)];
  // At least ~1.3 voxels: a thinner upper can't cover toes thinner than the lattice.
  const thick = Math.max(st.thick * h * thickness, voxel * 1.3) + extraThickness;
  const sole = st.sole * h;
  const out: FootwearField[] = [];

  for (const s of ['L', 'R'] as const) {
    const other = s === 'L' ? 'R' : 'L';
    const ankle = J(`foot.${s}`), knee = J(`lowerleg01.${s}`), toe = J(`toe3-1.${s}`);
    const oAnkle = J(`foot.${other}`), oKnee = J(`lowerleg01.${other}`), oToe = J(`toe3-1.${other}`);
    const shinUp = norm(sub(knee, ankle));
    const footFwd = norm(sub(toe, ankle));
    const R = mesh.bones.R[boneIndex.get(`foot.${s}`)!];
    // The foot's rest "up" (+z) carried into the pose: the sole's normal.
    const soleUp = norm([R[2], R[5], R[8]]);
    const top = st.top * h;
    // This foot's skin: nearer this leg than the other, below the shoe's top.
    const mine = (p: Vec3) => Math.min(segDist(p, knee, ankle), segDist(p, ankle, toe)) <= Math.min(segDist(p, oKnee, oAnkle), segDist(p, oAnkle, oToe));
    let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const v of skinVerts) {
      const p: Vec3 = [mesh.posed[v * 3], mesh.posed[v * 3 + 1], mesh.posed[v * 3 + 2]];
      if (dot(sub(p, ankle), shinUp) - Math.max(0, dot(sub(p, ankle), footFwd)) * TOE_RISE > top + 0.01 * h || !mine(p)) continue;
      if (segDist(p, knee, toe) > 0.2 * h) continue;
      for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], p[c]); hi[c] = Math.max(hi[c], p[c]); }
    }
    if (!Number.isFinite(lo[0])) continue;
    const pad = thick + sole + st.close * h + 4 * voxel;
    lo = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
    hi = [hi[0] + pad, hi[1] + pad, hi[2] + pad];
    const spec: GridSpec = {
      nx: Math.ceil((hi[0] - lo[0]) / voxel) + 1,
      ny: Math.ceil((hi[1] - lo[1]) / voxel) + 1,
      nz: Math.ceil((hi[2] - lo[2]) / voxel) + 1,
      origin: lo, voxel,
    };
    const occ = rasterizeOccupancy({ vertProperties: mesh.posed, triVerts: new Uint32Array(skinTris), numProp: 3, numTri: skinTris.length / 3 }, spec, 'nonzero');
    // Keep only this foot (the other may share the lattice when the feet are close).
    for (let k = 0, i = 0; k < spec.nz; k++) for (let j = 0; j < spec.ny; j++) for (let x = 0; x < spec.nx; x++, i++) {
      if (occ[i] && !mine([lo[0] + x * voxel, lo[1] + j * voxel, lo[2] + k * voxel])) occ[i] = 0;
    }
    let foot = blurField(signedFieldFromOccupancy(occ, spec), spec);
    foot = blurField(closeField(foot, spec, st.close * h), spec);
    const at = makeTrilinearSampler(foot, spec);
    const field = new Float32Array(foot.length);
    let minZ = Infinity;
    const SOLE_STEPS = 5;
    for (let k = 0, i = 0; k < spec.nz; k++) for (let j = 0; j < spec.ny; j++) for (let x = 0; x < spec.nx; x++, i++) {
      const p: Vec3 = [lo[0] + x * voxel, lo[1] + j * voxel, lo[2] + k * voxel];
      // Upper: the closed foot pushed out by the thickness.
      let f = foot[i] - thick;
      // Sole: the foot's underside extruded down along the sole normal.
      for (let q = 1; q <= SOLE_STEPS; q++) {
        const d = (sole * q) / SOLE_STEPS;
        f = Math.min(f, at(p[0] + soleUp[0] * d, p[1] + soleUp[1] * d, p[2] + soleUp[2] * d) - thick * 0.6);
      }
      // A heel block under the back of the foot.
      if (st.heel > 0) {
        const back = dot(sub(p, ankle), norm(sub(ankle, toe)));
        if (back > -0.02 * h) {
          const d = sole + st.heel * h;
          f = Math.min(f, Math.max(at(p[0] + soleUp[0] * d, p[1] + soleUp[1] * d, p[2] + soleUp[2] * d) - thick * 0.6, -back - 0.02 * h));
        }
      }
      // End on the shin. The cut rises toward the toes, so a big or
      // forward-tilted foot never has its toe box trimmed.
      const ahead = Math.max(0, dot(sub(p, ankle), footFwd));
      f = Math.max(f, dot(sub(p, ankle), shinUp) - top - ahead * TOE_RISE);
      field[i] = f;
      if (f < 0) minZ = Math.min(minZ, p[2]);
    }
    // Toes thinner than the lattice may not rasterize; check this foot's own
    // skin against the shoe and thicken the shoe enough to cover it.
    const shoe = makeTrilinearSampler(field, spec);
    let worst = -Infinity;
    for (const v of skinVerts) {
      const p: Vec3 = [mesh.posed[v * 3], mesh.posed[v * 3 + 1], mesh.posed[v * 3 + 2]];
      if (!mine(p) || dot(sub(p, ankle), shinUp) - Math.max(0, dot(sub(p, ankle), footFwd)) * TOE_RISE > top - thick) continue;
      const d = shoe(p[0], p[1], p[2]);
      if (d < 1e5) worst = Math.max(worst, d);
    }
    const grow = Math.min(Math.max(0, worst + thick * 0.3), thick * 1.5);
    if (grow > 0) {
      for (let i = 0; i < field.length; i++) field[i] -= grow;
      minZ -= grow;
    }
    out.push({ field, spec, minZ });
  }
  return out;
}
