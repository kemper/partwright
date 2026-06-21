// Placement resolver for the image-stamp / decal flow. Turns a high-level
// "project this graphic onto the FRONT of the model" request into the concrete
// { at, normal, size } the stamp engine (stampImageOntoMesh) needs — so callers
// (the window.partwright.paintImage console method and the AI paintImage tool)
// don't have to hand-compute a surface anchor point and projection axis, which
// is exactly where agents struggled (they fell back to solid-colour boxes).
//
// Pure + dependency-free (no THREE) so it unit-tests in the node tier. The ray
// cast is a small Möller–Trumbore sweep over the mesh triangles — a one-shot
// per stamp, so the O(numTri) cost is fine.

import type { MeshData } from '../geometry/types';

export type StampView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** Outward surface normal for each named view — the direction the painted face
 *  points (toward the camera). Z-up, right-handed: the default "front" camera
 *  looks toward +Y from -Y, so the front face points -Y. Mirrors
 *  STANDARD_VIEWS in src/renderer/multiview.ts. */
const VIEW_NORMALS: Record<StampView, readonly [number, number, number]> = {
  front:  [0, -1, 0],
  back:   [0,  1, 0],
  right:  [1,  0, 0],
  left:   [-1, 0, 0],
  top:    [0,  0, 1],
  bottom: [0,  0, -1],
};

export const STAMP_VIEWS = Object.keys(VIEW_NORMALS) as StampView[];

export interface StampPlacementInput {
  /** Named projection direction. Resolves both the projection axis and (with no
   *  explicit `at`) the surface anchor. Ignored when `at` + `normal` are both given. */
  view?: StampView;
  /** Explicit surface anchor (world coords). Skips the auto ray-cast. */
  at?: [number, number, number];
  /** Explicit outward projection normal. Overrides the `view` normal. */
  normal?: [number, number, number];
  /** Decal width in model units. Auto-derived from the label's footprint when
   *  omitted and `labelTriangles` is supplied. */
  size?: number;
  /** Triangle indices of a paint label region to centre the projection on (and
   *  to auto-size against). Resolve a label name to this set before calling. */
  labelTriangles?: Set<number> | null;
}

export interface ResolvedStampPlacement {
  at: [number, number, number];
  normal: [number, number, number];
  size: number;
}

function normalize(v: readonly [number, number, number]): [number, number, number] | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0)) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Nearest forward ray-triangle hit distance (t), or null on a miss.
 *  Möller–Trumbore, double-sided (a decal anchor doesn't care about winding). */
function rayNearestHit(
  mesh: MeshData,
  origin: readonly [number, number, number],
  dir: readonly [number, number, number],
): number | null {
  const { numTri, numProp, vertProperties: vp, triVerts: tv } = mesh;
  const EPS = 1e-7;
  let best = Infinity;
  for (let t = 0; t < numTri; t++) {
    const a = tv[t * 3] * numProp, b = tv[t * 3 + 1] * numProp, c = tv[t * 3 + 2] * numProp;
    const ax = vp[a], ay = vp[a + 1], az = vp[a + 2];
    const e1x = vp[b] - ax, e1y = vp[b + 1] - ay, e1z = vp[b + 2] - az;
    const e2x = vp[c] - ax, e2y = vp[c + 1] - ay, e2z = vp[c + 2] - az;
    // p = dir × e2
    const px = dir[1] * e2z - dir[2] * e2y;
    const py = dir[2] * e2x - dir[0] * e2z;
    const pz = dir[0] * e2y - dir[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) continue; // ray parallel to triangle
    const inv = 1 / det;
    const tx = origin[0] - ax, ty = origin[1] - ay, tz = origin[2] - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -EPS || u > 1 + EPS) continue;
    // q = t × e1
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dir[0] * qx + dir[1] * qy + dir[2] * qz) * inv;
    if (v < -EPS || u + v > 1 + EPS) continue;
    const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (hit > EPS && hit < best) best = hit;
  }
  return best === Infinity ? null : best;
}

/** Average of the centroids of a triangle set, plus its extent in the plane
 *  perpendicular to `n` (used to auto-size a decal to a label region). */
function labelGeometry(
  mesh: MeshData,
  tris: Set<number>,
  n: readonly [number, number, number],
): { center: [number, number, number]; lateralExtent: number } | null {
  if (tris.size === 0) return null;
  const { numProp, vertProperties: vp, triVerts: tv } = mesh;
  // In-plane tangent frame for measuring lateral spread.
  const ref: [number, number, number] = Math.abs(n[2]) > 0.5 ? [0, 1, 0] : [0, 0, 1];
  let tx = ref[1] * n[2] - ref[2] * n[1];
  let ty = ref[2] * n[0] - ref[0] * n[2];
  let tz = ref[0] * n[1] - ref[1] * n[0];
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = n[1] * tz - n[2] * ty, by = n[2] * tx - n[0] * tz, bz = n[0] * ty - n[1] * tx;

  let cx = 0, cy = 0, cz = 0;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const t of tris) {
    const a = tv[t * 3] * numProp, b = tv[t * 3 + 1] * numProp, c = tv[t * 3 + 2] * numProp;
    const px = (vp[a] + vp[b] + vp[c]) / 3;
    const py = (vp[a + 1] + vp[b + 1] + vp[c + 1]) / 3;
    const pz = (vp[a + 2] + vp[b + 2] + vp[c + 2]) / 3;
    cx += px; cy += py; cz += pz;
    for (const off of [a, b, c]) {
      const u = vp[off] * tx + vp[off + 1] * ty + vp[off + 2] * tz;
      const v = vp[off] * bx + vp[off + 1] * by + vp[off + 2] * bz;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
  }
  const inv = 1 / tris.size;
  return {
    center: [cx * inv, cy * inv, cz * inv],
    lateralExtent: Math.max(maxU - minU, maxV - minV),
  };
}

function meshBBox(mesh: MeshData): { min: [number, number, number]; max: [number, number, number] } | null {
  const { numVert, numProp, vertProperties: vp } = mesh;
  if (numVert === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < numVert; i++) {
    for (let k = 0; k < 3; k++) {
      const c = vp[i * numProp + k];
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return { min, max };
}

/** Resolve a high-level stamp request into { at, normal, size }. Returns
 *  `{ error }` when it can't (no projection direction, empty mesh, the ray
 *  misses the surface, or no size could be determined). */
export function resolveImageStampPlacement(
  mesh: MeshData,
  input: StampPlacementInput,
): ResolvedStampPlacement | { error: string } {
  // Projection normal: explicit `normal` wins, else the named view.
  let normal: [number, number, number] | null = null;
  if (input.normal) {
    normal = normalize(input.normal);
    if (!normal) return { error: 'paintImage: `normal` must be a non-zero vector.' };
  } else if (input.view) {
    if (!VIEW_NORMALS[input.view]) {
      return { error: `paintImage: unknown view "${input.view}". Use one of: ${STAMP_VIEWS.join(', ')}.` };
    }
    normal = [...VIEW_NORMALS[input.view]];
  } else {
    return { error: 'paintImage: provide a `view` (front/back/left/right/top/bottom) or both `at` and `normal`.' };
  }

  let at = input.at ? ([...input.at] as [number, number, number]) : null;
  let size = (typeof input.size === 'number' && input.size > 0) ? input.size : null;

  // Fully explicit — no geometry analysis needed.
  if (at && size != null) return { at, normal, size };

  const bbox = meshBBox(mesh);
  if (!bbox) return { error: 'paintImage: the model has no geometry to project onto.' };
  const diag = Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
  const radius = diag / 2 || 1;

  const label = (input.labelTriangles && input.labelTriangles.size > 0)
    ? labelGeometry(mesh, input.labelTriangles, normal)
    : null;

  const center: [number, number, number] = label
    ? label.center
    : [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ];

  // Auto-anchor: cast from far on the camera side back toward the surface,
  // through the lateral centre, and take the nearest forward hit.
  if (!at) {
    const margin = radius * 2 + 1;
    const origin: [number, number, number] = [
      center[0] + normal[0] * margin,
      center[1] + normal[1] * margin,
      center[2] + normal[2] * margin,
    ];
    const dir: [number, number, number] = [-normal[0], -normal[1], -normal[2]];
    const t = rayNearestHit(mesh, origin, dir);
    if (t == null) {
      return { error: 'paintImage: no surface faces that view at the model centre — pass an explicit `at` point (e.g. from probePixel/probeRay).' };
    }
    at = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
  }

  // Auto-size to the label footprint (with a small margin) when no size given.
  if (size == null) {
    if (label && label.lateralExtent > 0) {
      size = label.lateralExtent * 1.1;
    } else {
      return { error: 'paintImage: provide `size` (decal width in model units), or a `label` so it can be sized automatically.' };
    }
  }

  return { at, normal, size };
}
