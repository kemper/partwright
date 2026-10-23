// Persisted smooth-paint refinement (schema 1.21) — types + validation, pure.
//
// Smooth paint (brush strokes; smooth slab / box / cylinder / pattern regions)
// subdivides the mesh under its edges. Reopening a version used to rebuild
// that subdivision from the descriptors every time — tens of seconds on a
// scan with many strokes. Like `Version.surfaceTexture`, the result is now
// saved with the version: the refined mesh plus `toRoot` (each refined
// triangle's source triangle on the run's base mesh, which carries labels,
// parts and explicit triangle ids across), under a content KEY of the base
// mesh + the refine descriptors (+ the run's label sizes, which pattern
// scopes depend on). On load a matching key restores the mesh directly; any
// mismatch (geometry, descriptors or labels changed, or the key scheme
// evolved) just rebuilds, so a stale entry can never paint the wrong mesh.

export interface PersistedPaintRefine {
  key: string;
  mesh: {
    vertProperties: Float32Array;
    triVerts: Uint32Array;
    numVert: number;
    numTri: number;
    numProp: number;
  };
  /** Source triangle on the base mesh, per refined triangle. */
  toRoot: Int32Array;
}

/** Structural check of a persisted refine against the base mesh it should
 *  sit on (typed arrays survive IndexedDB as-is; imports are decoded). */
export function validPaintRefine(p: unknown, baseNumTri: number): p is PersistedPaintRefine {
  if (!p || typeof p !== 'object') return false;
  const r = p as PersistedPaintRefine;
  const m = r.mesh;
  if (typeof r.key !== 'string' || !m || !(r.toRoot instanceof Int32Array)) return false;
  if (!(m.vertProperties instanceof Float32Array) || !(m.triVerts instanceof Uint32Array)) return false;
  if (!Number.isInteger(m.numProp) || m.numProp < 3) return false;
  if (m.vertProperties.length !== m.numVert * m.numProp || m.triVerts.length !== m.numTri * 3) return false;
  if (r.toRoot.length !== m.numTri) return false;
  for (let i = 0; i < r.toRoot.length; i++) {
    const t = r.toRoot[i];
    if (t < 0 || t >= baseNumTri) return false;
  }
  for (let i = 0; i < m.triVerts.length; i++) if (m.triVerts[i] >= m.numVert) return false;
  return true;
}
