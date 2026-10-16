// Pure set-morphology over a painted region's triangle set — the clean-up ops
// behind `growRegion` / `shrinkRegion` / `despeckleRegion` / `combineRegions`.
//
// Everything here works on the triangle adjacency graph from `buildAdjacency`
// (triangles that share a corner are neighbours), so "one step" is one ring of
// triangles and the ops follow the real surface — never a coordinate box. No
// DOM / region-store / mesh dependencies: callers pass the neighbour lists and
// get a new Set back, which keeps this unit-testable in Node.

/** Neighbour lists per triangle — `AdjacencyGraph.neighbors`. */
export type Neighbors = ArrayLike<ArrayLike<number>>;

/** Optional gate on which triangles a grow may add (e.g. a spatial clamp). */
export type TriangleFilter = (tri: number) => boolean;

/** Dilate `tris` by `steps` rings of neighbouring triangles. `allow` (optional)
 *  vetoes individual triangles so a grow can't leak past a clamp. */
export function growTriangles(tris: ReadonlySet<number>, neighbors: Neighbors, steps: number, allow?: TriangleFilter): Set<number> {
  const out = new Set(tris);
  let frontier: number[] = [...tris];
  for (let s = 0; s < steps && frontier.length > 0; s++) {
    const next: number[] = [];
    for (const t of frontier) {
      const ns = neighbors[t];
      if (!ns) continue;
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        if (out.has(n) || (allow && !allow(n))) continue;
        out.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/** Erode `tris` by `steps` rings: each step drops every triangle that touches
 *  a triangle outside the set. Triangles on an open mesh border (no neighbour
 *  outside) are kept. */
export function shrinkTriangles(tris: ReadonlySet<number>, neighbors: Neighbors, steps: number): Set<number> {
  let cur = new Set(tris);
  for (let s = 0; s < steps && cur.size > 0; s++) {
    const next = new Set<number>();
    for (const t of cur) {
      const ns = neighbors[t];
      let interior = true;
      if (ns) {
        for (let i = 0; i < ns.length; i++) {
          if (!cur.has(ns[i])) { interior = false; break; }
        }
      }
      if (interior) next.add(t);
    }
    if (next.size === cur.size) break;
    cur = next;
  }
  return cur;
}

/** Split a triangle set into connected components (via `neighbors`). */
export function connectedComponents(tris: ReadonlySet<number>, neighbors: Neighbors): number[][] {
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const start of tris) {
    if (seen.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const t = stack.pop()!;
      comp.push(t);
      const ns = neighbors[t];
      if (!ns) continue;
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        if (!seen.has(n) && tris.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

export interface DespeckleResult {
  triangles: Set<number>;
  /** Islands removed (components smaller than `minIslandTriangles`). */
  islandsRemoved: number;
  islandTrianglesRemoved: number;
  /** Holes filled (enclosed unpainted patches of ≤ `maxHoleTriangles`). */
  holesFilled: number;
  holeTrianglesFilled: number;
}

/** Remove small islands of the region and fill small holes inside it.
 *
 *  - An **island** is a connected component of the region with fewer than
 *    `minIslandTriangles` triangles. It is dropped — but the region's largest
 *    component is always kept, so despeckle can't erase a small region whole.
 *  - A **hole** is a connected patch of triangles NOT in the region, with at
 *    most `maxHoleTriangles` triangles, that touches the region. Because a
 *    patch is a maximal component of the complement, touching the region means
 *    it is enclosed by it (or by the mesh border) — so it gets filled. Patches
 *    that don't touch the region (a separate mesh piece) are left alone.
 *
 *  Pass 0 for either threshold to skip that half. */
export function despeckleTriangles(
  tris: ReadonlySet<number>,
  neighbors: Neighbors,
  numTri: number,
  opts: { minIslandTriangles: number; maxHoleTriangles: number },
): DespeckleResult {
  const out = new Set(tris);
  let islandsRemoved = 0, islandTrianglesRemoved = 0, holesFilled = 0, holeTrianglesFilled = 0;

  if (opts.minIslandTriangles > 0 && out.size > 0) {
    const comps = connectedComponents(out, neighbors);
    let largest = 0;
    for (let i = 1; i < comps.length; i++) if (comps[i].length > comps[largest].length) largest = i;
    comps.forEach((comp, i) => {
      if (i === largest || comp.length >= opts.minIslandTriangles) return;
      for (const t of comp) out.delete(t);
      islandsRemoved++;
      islandTrianglesRemoved += comp.length;
    });
  }

  if (opts.maxHoleTriangles > 0 && out.size > 0) {
    // Walk complement components that start next to the region. A component
    // bigger than the cap is "outside", not a hole; it is still walked to the
    // end once so every triangle in it is marked seen and never re-walked.
    const seen = new Set<number>();
    for (const t of out) {
      const ns = neighbors[t];
      if (!ns) continue;
      for (let i = 0; i < ns.length; i++) {
        const start = ns[i];
        if (out.has(start) || seen.has(start)) continue;
        const comp: number[] = [];
        const stack = [start];
        seen.add(start);
        let tooBig = false;
        while (stack.length > 0) {
          const c = stack.pop()!;
          comp.push(c);
          if (comp.length > opts.maxHoleTriangles) tooBig = true;
          const cn = neighbors[c];
          if (!cn) continue;
          for (let j = 0; j < cn.length; j++) {
            const n = cn[j];
            if (n >= numTri || out.has(n) || seen.has(n)) continue;
            seen.add(n);
            stack.push(n);
          }
        }
        if (tooBig) continue;
        for (const c of comp) out.add(c);
        holesFilled++;
        holeTrianglesFilled += comp.length;
      }
    }
  }

  return { triangles: out, islandsRemoved, islandTrianglesRemoved, holesFilled, holeTrianglesFilled };
}

export type RegionSetOp = 'union' | 'subtract' | 'intersect';

/** Boolean set op on triangle sets: `a ∪ others`, `a − others`, `a ∩ others`
 *  (intersect keeps triangles of `a` that are in EVERY other set). */
export function combineTriangles(a: ReadonlySet<number>, others: ReadonlySet<number>[], op: RegionSetOp): Set<number> {
  if (op === 'union') {
    const out = new Set(a);
    for (const o of others) for (const t of o) out.add(t);
    return out;
  }
  if (op === 'subtract') {
    const out = new Set(a);
    for (const o of others) for (const t of o) out.delete(t);
    return out;
  }
  const out = new Set<number>();
  for (const t of a) if (others.every(o => o.has(t))) out.add(t);
  return out;
}
