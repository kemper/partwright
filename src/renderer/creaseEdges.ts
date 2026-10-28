// Crease-edge extraction for the offscreen renders' edge overlay — the same
// feature edges as THREE.EdgesGeometry (faces meeting at more than the crease
// angle, plus open boundary edges), minus MICRO-STEPS.
//
// A micro-step is a thin wall joining two nearly parallel faces that sit a
// hair apart: the seam a scoped `api.round` / `api.smoothWeld` leaves where its
// remeshed strip meets the untouched input (#1112), or similar sub-voxel
// ledges from booleans. Shaded, it is invisible; as crease lines it reads as a
// defect outlining the edit. A real corner, or a real engraved wall (whose
// floor sits well below the surface), is kept. Pure (no three.js) and
// unit-tested.

/** Faces within this angle count as coplanar / parallel for the step test. */
const PARALLEL_DEG = 35;
/** How far (in faces) the step test walks along a wall to reach its far side. */
const WALL_HOPS = 6;

/** Line-segment endpoints (x,y,z pairs) for the crease edges of a triangle
 *  mesh. `positions` holds xyz per vertex; `index` (or null for a
 *  non-indexed soup) lists 3 vertices per triangle. Vertices are welded by
 *  position, like EdgesGeometry. `minStep` (world units, 0 = off): steps
 *  shorter than this lose their wall lines. */
export function creaseEdgeSegments(
  positions: ArrayLike<number>,
  index: ArrayLike<number> | null,
  angleDeg: number,
  minStep: number,
): Float32Array {
  const nTri = index ? Math.floor(index.length / 3) : Math.floor(positions.length / 9);
  const vertOf = (t: number, c: number) => (index ? index[t * 3 + c] : t * 3 + c);
  const weld = new Map<string, number>();
  const welded = (v: number): number => {
    const k = `${Math.round(positions[v * 3] * 1e4)},${Math.round(positions[v * 3 + 1] * 1e4)},${Math.round(positions[v * 3 + 2] * 1e4)}`;
    let id = weld.get(k);
    if (id === undefined) { id = weld.size; weld.set(k, id); }
    return id;
  };
  const corners = new Int32Array(nTri * 3);
  const normal = new Float64Array(nTri * 3);
  const centroid = new Float64Array(nTri * 3);
  const edges = new Map<string, { faces: number[]; a: number; b: number }>();
  const faceEdges: string[][] = [];
  for (let t = 0; t < nTri; t++) {
    const v = [vertOf(t, 0), vertOf(t, 1), vertOf(t, 2)];
    corners[t * 3] = v[0]; corners[t * 3 + 1] = v[1]; corners[t * 3 + 2] = v[2];
    const p = v.map(i => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const wx = p[2][0] - p[0][0], wy = p[2][1] - p[0][1], wz = p[2][2] - p[0][2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) { normal[t * 3] = nx / len; normal[t * 3 + 1] = ny / len; normal[t * 3 + 2] = nz / len; }
    for (let k = 0; k < 3; k++) centroid[t * 3 + k] = (p[0][k] + p[1][k] + p[2][k]) / 3;
    const w = v.map(welded);
    const mine: string[] = [];
    for (let e = 0; e < 3; e++) {
      const x = w[e], y = w[(e + 1) % 3];
      if (x === y) continue;
      const key = x < y ? `${x}_${y}` : `${y}_${x}`;
      let ent = edges.get(key);
      if (!ent) { ent = { faces: [], a: v[e], b: v[(e + 1) % 3] }; edges.set(key, ent); }
      ent.faces.push(t);
      mine.push(key);
    }
    faceEdges.push(mine);
  }

  const dot = (f: number, g: number) => normal[f * 3] * normal[g * 3] + normal[f * 3 + 1] * normal[g * 3 + 1] + normal[f * 3 + 2] * normal[g * 3 + 2];
  const parallel = Math.cos((PARALLEL_DEG * Math.PI) / 180);
  const neighbours = function* (f: number) {
    for (const key of faceEdges[f]) for (const g of edges.get(key)!.faces) if (g !== f) yield g;
  };

  /** How far triangle `t` extends along `face`'s normal. */
  const spanAlong = (t: number, face: number): number => {
    let lo = Infinity, hi = -Infinity;
    for (let c = 0; c < 3; c++) {
      const v = corners[t * 3 + c];
      let d = 0;
      for (let k = 0; k < 3; k++) d += normal[face * 3 + k] * positions[v * 3 + k];
      lo = Math.min(lo, d); hi = Math.max(hi, d);
    }
    return hi - lo;
  };

  /** Sign of triangle `t`'s centroid relative to `wall`'s plane. */
  const sideOf = (t: number, wall: number): number => {
    let d = 0;
    for (let k = 0; k < 3; k++) d += normal[wall * 3 + k] * (centroid[t * 3 + k] - centroid[wall * 3 + k]);
    return Math.sign(d);
  };

  /** Is the crease between `face` and `wall` the lip of a micro-step? Walk
   *  the wall (faces coplanar with it) looking for a face on its far side
   *  that is parallel to `face`. Only THIN wall faces (spanning under minStep
   *  along `face`'s normal) are walked, so the wall — and with it the step —
   *  is under minStep tall; a real wall (an engraving's side, a box edge) is
   *  broader and keeps its lines. The wall's span is the step height: the two
   *  levels' own plane offset would also count their slight lean (a remesh
   *  ripples a few degrees) across their width. */
  const isMicroStep = (face: number, wall: number): boolean => {
    if (spanAlong(wall, face) >= minStep) return false;
    const seen = new Set<number>([face, wall]);
    let frontier = [wall];
    for (let hop = 0; hop < WALL_HOPS && frontier.length; hop++) {
      const next: number[] = [];
      for (const w of frontier) {
        for (const g of neighbours(w)) {
          if (seen.has(g)) continue;
          seen.add(g);
          if (Math.abs(dot(g, wall)) > parallel) {
            if (spanAlong(g, face) < minStep) next.push(g);
            continue;
          }
          if (dot(g, face) < parallel) continue;
          // A step's two levels sit on opposite sides of its wall; two
          // facets of a curved surface beside a sliver sit on the same side.
          if (sideOf(face, wall) * sideOf(g, wall) >= 0) continue;
          return true;
        }
      }
      frontier = next;
    }
    return false;
  };

  const cosAngle = Math.cos((angleDeg * Math.PI) / 180);
  const out: number[] = [];
  for (const ent of edges.values()) {
    if (ent.faces.length === 2) {
      const [f, g] = ent.faces;
      if (dot(f, g) > cosAngle) continue;
      if (minStep > 0 && (isMicroStep(f, g) || isMicroStep(g, f))) continue;
    } else if (ent.faces.length !== 1) {
      continue;
    }
    out.push(
      positions[ent.a * 3], positions[ent.a * 3 + 1], positions[ent.a * 3 + 2],
      positions[ent.b * 3], positions[ent.b * 3 + 1], positions[ent.b * 3 + 2],
    );
  }
  return Float32Array.from(out);
}
