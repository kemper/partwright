// Apply part edits (`api.movePart('bolt', [10, 0, 0])` …) to a finished mesh.
//
// The engine records the edits as an ordered `PartOp[]`; after the model code
// returns its Manifold it calls `applyPartOps` on the result's MeshGL and
// rebuilds a Manifold with `Manifold.ofMesh(out.mesh)` (then subtracts any
// cutters). A part is a set of manifold-provenance ids ("runs") that share a
// name in `labels`; it can be edited on its own only if it is a FREE solid —
// no vertex shared with other geometry — which is checked per op.
//
// Pure typed-array work, linear in the mesh size, dependency-free so it runs in
// the vitest unit tier and in the Worker alike. Inputs are never mutated.

export type Vec3 = [number, number, number];

export type PartOp =
  | { kind: 'move'; part: string; offset: Vec3 }
  /** About the part's bbox centre; x applied first, then y, then z (matrix Rz·Ry·Rx), like manifold's rotate([x,y,z]). */
  | { kind: 'rotate'; part: string; degrees: Vec3 }
  /** About the bbox (centre x, centre y, MIN z) so the part stays on the plate. */
  | { kind: 'scale'; part: string; factor: Vec3 }
  /** About the bbox centre; flips the part's triangle winding. */
  | { kind: 'mirror'; part: string; axis: 'x' | 'y' | 'z' }
  /** Duplicate the part (as it is at this point in the list), shifted, as a NEW part named `as`. */
  | { kind: 'copy'; part: string; as: string; offset: Vec3 }
  /** Relabel: every id named one of `parts` is renamed `as` (one part from then on). */
  | { kind: 'group'; parts: string[]; as: string }
  /** Take the part out of the mesh and return it as a cutter (the caller subtracts it from the rest). */
  | { kind: 'cut'; part: string };

export interface PartOpsMesh {
  /** >= 3; the first 3 props of each vertex are x, y, z. The rest are copied through unchanged. */
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  /** Run k covers triVerts[runIndex[k] .. runIndex[k+1]) (indices into triVerts, 3 per triangle); length = runs + 1. */
  runIndex?: Uint32Array;
  /** Length = runs. */
  runOriginalID?: Uint32Array;
  /** Manifold's merge pairs: vertex mergeFromVert[i] is the same position as mergeToVert[i]. */
  mergeFromVert?: Uint32Array;
  mergeToVert?: Uint32Array;
}

export class PartOpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartOpError';
  }
}

type Growable = Float32Array | Uint32Array;

/** A typed array with spare capacity, so appending a copied part is amortised
 *  linear instead of re-allocating the whole mesh per copy. */
class Buf<T extends Growable> {
  private ctor: new (n: number) => T;
  data: T;
  len: number;
  constructor(ctor: new (n: number) => T, data: T, len: number) {
    this.ctor = ctor;
    this.data = data;
    this.len = len;
  }
  static of<T extends Growable>(ctor: new (n: number) => T, init: T): Buf<T> {
    return new Buf(ctor, init, init.length);
  }
  /** Make room for `extra` more elements; returns the offset to write at. */
  grow(extra: number): number {
    const at = this.len;
    if (at + extra > this.data.length) {
      const next = new this.ctor(Math.max(at + extra, this.data.length * 2));
      next.set(this.data.subarray(0, at));
      this.data = next;
    }
    this.len = at + extra;
    return at;
  }
  view(): T { return this.data.subarray(0, this.len) as T; }
}

const AXIS = { x: 0, y: 1, z: 2 } as const;

/** Row-major 3x3 of Rz·Ry·Rx for Euler degrees [x, y, z] (x applied first). */
function eulerMatrix(deg: Vec3): number[] {
  const [ax, ay, az] = deg.map(d => d * Math.PI / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

/** Drop unreferenced vertices, group triangles into runs by original id (ids in
 *  first-appearance order, triangle order stable within a run) and rebuild the
 *  run arrays; merge pairs are remapped, those touching a dropped vertex dropped. */
function compact(
  np: number,
  vp: Float32Array,
  nVert: number,
  tv: Uint32Array,
  triId: Uint32Array,
  nTri: number,
  mergeFrom: Uint32Array,
  mergeTo: Uint32Array,
): Required<PartOpsMesh> {
  const remap = new Uint32Array(nVert);
  const used = new Uint8Array(nVert);
  for (let i = 0; i < nTri * 3; i++) used[tv[i]] = 1;
  let kept = 0;
  for (let v = 0; v < nVert; v++) if (used[v]) remap[v] = kept++;
  const outVp = new Float32Array(kept * np);
  for (let v = 0; v < nVert; v++) {
    if (!used[v]) continue;
    const src = v * np, dst = remap[v] * np;
    for (let k = 0; k < np; k++) outVp[dst + k] = vp[src + k];
  }

  // Runs: count per id, then scatter (a stable counting sort by first appearance).
  const runOfId = new Map<number, number>();
  const ids: number[] = [];
  const triRun = new Uint32Array(nTri);
  const counts: number[] = [];
  let lastId = -1, lastRun = -1;
  for (let t = 0; t < nTri; t++) {
    const id = triId[t];
    if (id !== lastId || lastRun < 0) {
      let run = runOfId.get(id);
      if (run === undefined) { run = ids.length; runOfId.set(id, run); ids.push(id); counts.push(0); }
      lastId = id; lastRun = run;
    }
    triRun[t] = lastRun;
    counts[lastRun]++;
  }
  const runIndex = new Uint32Array(ids.length + 1);
  for (let r = 0; r < ids.length; r++) runIndex[r + 1] = runIndex[r] + counts[r] * 3;
  const cursor = new Uint32Array(ids.length);
  for (let r = 0; r < ids.length; r++) cursor[r] = runIndex[r];
  const outTv = new Uint32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    const at = cursor[triRun[t]];
    cursor[triRun[t]] = at + 3;
    outTv[at] = remap[tv[t * 3]];
    outTv[at + 1] = remap[tv[t * 3 + 1]];
    outTv[at + 2] = remap[tv[t * 3 + 2]];
  }

  let pairs = 0;
  for (let i = 0; i < mergeFrom.length; i++) if (used[mergeFrom[i]] && used[mergeTo[i]]) pairs++;
  const outFrom = new Uint32Array(pairs), outTo = new Uint32Array(pairs);
  let p = 0;
  for (let i = 0; i < mergeFrom.length; i++) {
    if (!used[mergeFrom[i]] || !used[mergeTo[i]]) continue;
    outFrom[p] = remap[mergeFrom[i]];
    outTo[p] = remap[mergeTo[i]];
    p++;
  }
  return {
    numProp: np,
    vertProperties: outVp,
    triVerts: outTv,
    runIndex,
    runOriginalID: Uint32Array.from(ids),
    mergeFromVert: outFrom,
    mergeToVert: outTo,
  };
}

const VERB: Record<string, string> = {
  move: 'moved', rotate: 'rotated', scale: 'scaled', mirror: 'mirrored', copy: 'copied', cut: 'cut out',
};

/** Apply `ops` in order to `mesh`. `labels` maps provenance ids to part names
 *  (several ids may share a name; ids missing from it are unlabelled geometry).
 *  `reserveIds(n)` hands out `n` fresh provenance ids and returns the first
 *  (used by `copy`). Returns the edited mesh (compact, runs rebuilt), the
 *  updated labels, and one cutter mesh per `cut` op. Throws `PartOpError` for an
 *  unknown part, a name clash, or a part that is joined to other geometry. */
export function applyPartOps(
  mesh: PartOpsMesh,
  labelsIn: Map<number, string>,
  ops: PartOp[],
  reserveIds: (n: number) => number,
): { mesh: Required<PartOpsMesh>; labels: Map<number, string>; cutters: PartOpsMesh[] } {
  const np = mesh.numProp;
  if (!(np >= 3)) throw new PartOpError('The mesh needs at least 3 properties per vertex (x, y, z).');
  if (mesh.vertProperties.length % np !== 0 || mesh.triVerts.length % 3 !== 0) {
    throw new PartOpError('The mesh arrays are the wrong length for numProp / 3 vertices per triangle.');
  }
  const nVert0 = mesh.vertProperties.length / np;
  const nTri0 = mesh.triVerts.length / 3;
  const labels = new Map(labelsIn);

  // Per-triangle provenance id (a mesh without runs is one run of id 0).
  const triId0 = new Uint32Array(nTri0);
  if (mesh.runIndex) {
    const ri = mesh.runIndex, ro = mesh.runOriginalID;
    for (let r = 0; r + 1 < ri.length; r++) {
      const id = ro ? ro[r] : 0;
      const end = Math.min(ri[r + 1] / 3, nTri0);
      for (let t = ri[r] / 3; t < end; t++) triId0[t] = id;
    }
  }

  const mf0 = mesh.mergeFromVert ?? new Uint32Array(0);
  const mt0 = mesh.mergeToVert ?? new Uint32Array(0);

  if (ops.length === 0) {
    return {
      mesh: {
        numProp: np,
        vertProperties: mesh.vertProperties.slice(),
        triVerts: mesh.triVerts.slice(),
        runIndex: mesh.runIndex ? mesh.runIndex.slice() : Uint32Array.of(0, nTri0 * 3),
        runOriginalID: mesh.runOriginalID ? mesh.runOriginalID.slice() : Uint32Array.of(0),
        mergeFromVert: mf0.slice(),
        mergeToVert: mt0.slice(),
      },
      labels,
      cutters: [],
    };
  }

  const vp = Buf.of(Float32Array, mesh.vertProperties.slice());
  const tv = Buf.of(Uint32Array, mesh.triVerts.slice());
  const triId = Buf.of(Uint32Array, triId0);
  const mf = Buf.of(Uint32Array, mf0.slice());
  const mt = Buf.of(Uint32Array, mt0.slice());
  let nVert = nVert0, nTri = nTri0;
  const cutters: PartOpsMesh[] = [];

  /** Ids that have at least one triangle right now. */
  const presentIds = (): Set<number> => {
    const s = new Set<number>();
    const ids = triId.data;
    let last = -1;
    for (let t = 0; t < nTri; t++) if (ids[t] !== last || s.size === 0) { last = ids[t]; s.add(last); }
    return s;
  };
  const partNames = (present: Set<number>): string[] => {
    const names: string[] = [];
    for (const id of present) {
      const n = labels.get(id);
      if (n !== undefined && !names.includes(n)) names.push(n);
    }
    return names;
  };
  /** The present ids named `name`, or a PartOpError if there are none. */
  const idsOf = (name: string, present: Set<number>): Set<number> => {
    const ids = new Set<number>();
    for (const id of present) if (labels.get(id) === name) ids.add(id);
    if (ids.size === 0) {
      const have = partNames(present);
      const shown = have.slice(0, 5).map(n => `"${n}"`).join(', ');
      throw new PartOpError(`No part named "${name}"${have.length > 0 ? ` (parts: ${shown}${have.length > 5 ? ', …' : ''})` : ' (this model has no labelled parts)'}.`);
    }
    return ids;
  };
  const checkNewName = (as: string, allowed: string[], present: Set<number>): void => {
    if (!partNames(present).includes(as) || allowed.includes(as)) return;
    throw new PartOpError(`A part named "${as}" already exists — pick a different name.`);
  };

  /** The part's triangle mask and vertex mask, verified free of other geometry. */
  const freePart = (name: string, kind: string, ids: Set<number>) => {
    const triIn = new Uint8Array(nTri);
    const vertIn = new Uint8Array(nVert);
    const vertOut = new Uint8Array(nVert);
    const t3 = tv.data, tid = triId.data;
    let count = 0;
    for (let t = 0; t < nTri; t++) {
      const inside = ids.has(tid[t]);
      if (inside) { triIn[t] = 1; count++; }
      const mark = inside ? vertIn : vertOut;
      mark[t3[t * 3]] = 1; mark[t3[t * 3 + 1]] = 1; mark[t3[t * 3 + 2]] = 1;
    }
    let joined = false;
    for (let v = 0; v < nVert && !joined; v++) if (vertIn[v] && vertOut[v]) joined = true;
    for (let i = 0; i < mf.len && !joined; i++) {
      const a = mf.data[i], b = mt.data[i];
      if ((vertIn[a] && vertOut[b]) || (vertIn[b] && vertOut[a])) joined = true;
    }
    if (joined) {
      throw new PartOpError(`Part "${name}" is joined to other geometry, so it can't be ${VERB[kind]} on its own — it has to be a separate solid.`);
    }
    return { triIn, vertIn, count };
  };

  const bboxOf = (vertIn: Uint8Array): { min: Vec3; max: Vec3 } => {
    const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
    const d = vp.data;
    for (let v = 0; v < nVert; v++) {
      if (!vertIn[v]) continue;
      for (let k = 0; k < 3; k++) {
        const x = d[v * np + k];
        if (x < min[k]) min[k] = x;
        if (x > max[k]) max[k] = x;
      }
    }
    return { min, max };
  };

  for (const op of ops) {
    const present = presentIds();

    if (op.kind === 'group') {
      const distinct = [...new Set(op.parts)];
      for (const p of distinct) idsOf(p, present); // unknown part -> error naming it
      if (distinct.length < 2) throw new PartOpError('Grouping needs at least two different existing parts.');
      checkNewName(op.as, distinct, present);
      for (const [id, name] of labels) if (distinct.includes(name)) labels.set(id, op.as);
      continue;
    }

    const ids = idsOf(op.part, present);
    if (op.kind === 'copy') checkNewName(op.as, [op.part], present);
    if (op.kind === 'scale' && !op.factor.every(f => f > 0)) {
      throw new PartOpError(`Scale factors for "${op.part}" must be greater than 0.`);
    }
    const { triIn, vertIn, count } = freePart(op.part, op.kind, ids);
    const d = vp.data;

    if (op.kind === 'move') {
      for (let v = 0; v < nVert; v++) {
        if (!vertIn[v]) continue;
        d[v * np] += op.offset[0]; d[v * np + 1] += op.offset[1]; d[v * np + 2] += op.offset[2];
      }
    } else if (op.kind === 'rotate') {
      const { min, max } = bboxOf(vertIn);
      const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
      const m = eulerMatrix(op.degrees);
      for (let v = 0; v < nVert; v++) {
        if (!vertIn[v]) continue;
        const x = d[v * np] - c[0], y = d[v * np + 1] - c[1], z = d[v * np + 2] - c[2];
        d[v * np] = c[0] + m[0] * x + m[1] * y + m[2] * z;
        d[v * np + 1] = c[1] + m[3] * x + m[4] * y + m[5] * z;
        d[v * np + 2] = c[2] + m[6] * x + m[7] * y + m[8] * z;
      }
    } else if (op.kind === 'scale') {
      const { min, max } = bboxOf(vertIn);
      const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
      for (let v = 0; v < nVert; v++) {
        if (!vertIn[v]) continue;
        for (let k = 0; k < 3; k++) d[v * np + k] = c[k] + (d[v * np + k] - c[k]) * op.factor[k];
      }
    } else if (op.kind === 'mirror') {
      const a = AXIS[op.axis];
      const { min, max } = bboxOf(vertIn);
      const c2 = min[a] + max[a];
      for (let v = 0; v < nVert; v++) if (vertIn[v]) d[v * np + a] = c2 - d[v * np + a];
      // A mirrored solid is inside-out unless its winding flips too.
      const t3 = tv.data;
      for (let t = 0; t < nTri; t++) {
        if (!triIn[t]) continue;
        const tmp = t3[t * 3 + 1]; t3[t * 3 + 1] = t3[t * 3 + 2]; t3[t * 3 + 2] = tmp;
      }
    } else if (op.kind === 'copy') {
      const newId = reserveIds(1);
      const map = new Uint32Array(nVert);
      let nv = 0;
      for (let v = 0; v < nVert; v++) if (vertIn[v]) map[v] = nv++;
      const vAt = vp.grow(nv * np);
      for (let v = 0; v < nVert; v++) {
        if (!vertIn[v]) continue;
        const src = v * np, dst = vAt + map[v] * np;
        for (let k = 0; k < np; k++) vp.data[dst + k] = vp.data[src + k];
        vp.data[dst] += op.offset[0]; vp.data[dst + 1] += op.offset[1]; vp.data[dst + 2] += op.offset[2];
      }
      const base = nVert;
      const tAt = tv.grow(count * 3);
      triId.grow(count);
      let o = 0;
      const t3 = tv.data;
      for (let t = 0; t < nTri; t++) {
        if (!triIn[t]) continue;
        t3[tAt + o * 3] = base + map[t3[t * 3]];
        t3[tAt + o * 3 + 1] = base + map[t3[t * 3 + 1]];
        t3[tAt + o * 3 + 2] = base + map[t3[t * 3 + 2]];
        triId.data[nTri + o] = newId;
        o++;
      }
      const pairLen = mf.len;
      for (let i = 0; i < pairLen; i++) {
        const a = mf.data[i], b = mt.data[i];
        if (!vertIn[a] || !vertIn[b]) continue;
        const at = mf.grow(1); mt.grow(1);
        mf.data[at] = base + map[a];
        mt.data[at] = base + map[b];
      }
      nVert += nv;
      nTri += count;
      labels.set(newId, op.as);
    } else {
      // cut: split the triangles into the part (the cutter) and the rest.
      const t3 = tv.data, tid = triId.data;
      const cutTv = new Uint32Array(count * 3), cutId = new Uint32Array(count);
      const restTv = new Uint32Array((nTri - count) * 3), restId = new Uint32Array(nTri - count);
      let c = 0, r = 0;
      for (let t = 0; t < nTri; t++) {
        if (triIn[t]) {
          cutTv[c * 3] = t3[t * 3]; cutTv[c * 3 + 1] = t3[t * 3 + 1]; cutTv[c * 3 + 2] = t3[t * 3 + 2];
          cutId[c++] = tid[t];
        } else {
          restTv[r * 3] = t3[t * 3]; restTv[r * 3 + 1] = t3[t * 3 + 1]; restTv[r * 3 + 2] = t3[t * 3 + 2];
          restId[r++] = tid[t];
        }
      }
      cutters.push(compact(np, vp.data, nVert, cutTv, cutId, count, mf.view(), mt.view()));
      tv.data = restTv; tv.len = restTv.length;
      triId.data = restId; triId.len = restId.length;
      nTri -= count;
    }
  }

  return {
    mesh: compact(np, vp.data, nVert, tv.data, triId.data, nTri, mf.view(), mt.view()),
    labels,
    cutters,
  };
}
