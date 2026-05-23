// Universal geometric transforms applied to a rendered MeshData. Today: scale,
// in the four modes the print tools need — uniform, per-axis, scale-to-target
// (make one axis an exact length), and scale-to-fit (largest uniform factor
// that fits the build volume). Scaling is done directly on the vertex buffer
// (exact, topology-preserving, works on render-only imports too) about a pivot
// that keeps the model centred in XY and resting on its current base plane —
// the print-intuitive anchor (object stays on the plate, base stays down).
//
// Scale-to-fit reads the same build-volume primitive as the printability and
// split tools, so "scale up → too big → split" is one consistent pipeline.

import type { MeshData } from './types';

export type ScaleSpec =
  | { factor: number }
  | { scale: [number, number, number] }
  | { to: { axis: 'x' | 'y' | 'z' | 'max' | 'min'; length: number } }
  | { fit: { bed: [number, number, number]; margin?: number; mode?: 'shrink' | 'fit' } };

type Vec3 = [number, number, number];

function meshBounds(mesh: MeshData): { min: Vec3; max: Vec3; dim: Vec3 } | null {
  if (mesh.numVert === 0) return null;
  const v = mesh.vertProperties;
  const n = mesh.numProp;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < mesh.numVert; i++) {
    const x = v[i * n], y = v[i * n + 1], z = v[i * n + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], dim: [maxX - minX, maxY - minY, maxZ - minZ] };
}

/** Resolve a ScaleSpec against the current bounding-box dimensions into an
 *  explicit [sx, sy, sz] factor. Returns null with a reason for invalid specs
 *  (zero-length axis, non-positive factor) so callers can surface it. */
export function resolveScale(dim: Vec3, spec: ScaleSpec): { vector: Vec3 } | { error: string } {
  if ('factor' in spec) {
    if (!(spec.factor > 0) || !Number.isFinite(spec.factor)) return { error: 'scale factor must be a positive number' };
    return { vector: [spec.factor, spec.factor, spec.factor] };
  }
  if ('scale' in spec) {
    const s = spec.scale;
    if (!Array.isArray(s) || s.length !== 3 || s.some(n => !(n > 0) || !Number.isFinite(n))) {
      return { error: 'scale must be [sx, sy, sz] with all factors > 0' };
    }
    return { vector: [s[0], s[1], s[2]] };
  }
  if ('to' in spec) {
    const { axis, length } = spec.to;
    if (!(length > 0) || !Number.isFinite(length)) return { error: 'target length must be > 0' };
    const cur = axis === 'max' ? Math.max(dim[0], dim[1], dim[2])
      : axis === 'min' ? Math.min(dim[0], dim[1], dim[2])
      : dim[{ x: 0, y: 1, z: 2 }[axis]];
    if (!(cur > 1e-9)) return { error: `current ${axis} dimension is zero — can't scale to a target` };
    const f = length / cur;
    return { vector: [f, f, f] };
  }
  if ('fit' in spec) {
    const { bed, margin = 0, mode = 'shrink' } = spec.fit;
    if (!Array.isArray(bed) || bed.length !== 3 || bed.some(n => !(n > 0))) return { error: 'fit.bed must be [x, y, z] with all > 0' };
    const usable: Vec3 = [bed[0] * (1 - margin), bed[1] * (1 - margin), bed[2] * (1 - margin)];
    const fx = dim[0] > 1e-9 ? usable[0] / dim[0] : Infinity;
    const fy = dim[1] > 1e-9 ? usable[1] / dim[1] : Infinity;
    const fz = dim[2] > 1e-9 ? usable[2] / dim[2] : Infinity;
    let f = Math.min(fx, fy, fz);
    if (!Number.isFinite(f)) return { error: 'cannot fit a zero-size model' };
    if (mode === 'shrink' && f >= 1) f = 1; // only downscale when it already fits
    return { vector: [f, f, f] };
  }
  return { error: 'unknown scale spec' };
}

/** Scale a mesh in place-of-copy about the print-intuitive pivot (XY centre,
 *  base plane). Returns a new MeshData; the input is untouched. */
export function scaleMeshData(mesh: MeshData, vector: Vec3): MeshData {
  const b = meshBounds(mesh);
  const pivot: Vec3 = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]] : [0, 0, 0];
  const n = mesh.numProp;
  const src = mesh.vertProperties;
  const out = new Float32Array(src.length);
  out.set(src); // carry any extra vertex properties beyond xyz unchanged
  for (let i = 0; i < mesh.numVert; i++) {
    const o = i * n;
    out[o] = (src[o] - pivot[0]) * vector[0] + pivot[0];
    out[o + 1] = (src[o + 1] - pivot[1]) * vector[1] + pivot[1];
    out[o + 2] = (src[o + 2] - pivot[2]) * vector[2] + pivot[2];
  }
  return {
    vertProperties: out,
    triVerts: mesh.triVerts.slice(),
    numVert: mesh.numVert,
    numTri: mesh.numTri,
    numProp: mesh.numProp,
    ...(mesh.mergeFromVert ? { mergeFromVert: mesh.mergeFromVert.slice() } : {}),
    ...(mesh.mergeToVert ? { mergeToVert: mesh.mergeToVert.slice() } : {}),
    ...(mesh.runIndex ? { runIndex: mesh.runIndex.slice() } : {}),
    ...(mesh.runOriginalID ? { runOriginalID: mesh.runOriginalID.slice() } : {}),
  };
}

/** One-shot: resolve a spec and apply it. Returns the scaled mesh, the factor
 *  used, and the resulting dimensions, or an error. */
export function scaleModelMesh(mesh: MeshData, spec: ScaleSpec):
  | { mesh: MeshData; vector: Vec3; dimensions: Vec3 }
  | { error: string } {
  const b = meshBounds(mesh);
  if (!b) return { error: 'no geometry to scale' };
  const resolved = resolveScale(b.dim, spec);
  if ('error' in resolved) return resolved;
  const scaled = scaleMeshData(mesh, resolved.vector);
  const nb = meshBounds(scaled)!;
  return { mesh: scaled, vector: resolved.vector, dimensions: nb.dim };
}
