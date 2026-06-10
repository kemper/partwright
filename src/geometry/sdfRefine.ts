// Targeted SDF mesh refinement — the "detail regions" pass behind
// `api.sdf.build({ detail: [...] })`.
//
// Manifold.levelSet marches a UNIFORM grid, so one global edgeLength serves
// the whole model: fine enough for a figurine's face means 30–60× the eval
// cost over the body. This module refines selectively AFTER the march:
// triangles inside the caller's detail spheres are subdivided until their
// edges reach the per-region target, and every new vertex is projected back
// onto the SDF iso-surface with a clamped Newton step. The result keeps the
// coarse mesh everywhere else, stays watertight (split edges are shared via
// a global edge set, so neighbouring triangles always agree), and needs no
// second levelSet pass.
//
// Pure logic — no WASM, no DOM — so it lives in the vitest unit tier.

export type Vec3 = [number, number, number];

export interface DetailRegion {
  /** Sphere centre, world units. */
  center: Vec3;
  /** Sphere radius — triangles whose edges cross it get refined. */
  radius: number;
  /** Target max edge length inside the sphere. */
  edgeLength: number;
}

export interface RefineOptions {
  /** Iso value to project onto: eval(p) = iso on the surface. 0 for a
   *  standard `.build()`; -level when the caller passed `{ level }`. */
  iso?: number;
  /** Hard cap on subdivision passes (each pass can ~4× local tris). */
  maxRounds?: number;
  /** Stop refining before a pass that would exceed this triangle count. */
  maxTriangles?: number;
}

export interface RefineResult {
  positions: Float32Array;
  triVerts: Uint32Array;
  /** Subdivision passes actually executed (0 = mesh was already fine). */
  rounds: number;
}

const DEFAULT_MAX_ROUNDS = 6;
const DEFAULT_MAX_TRIANGLES = 400_000;
/** Newton iterations per projected vertex. */
const PROJECT_ITERS = 4;

/** Squared distance from segment AB to point C. */
function segDistSq(
  p: Float32Array, a: number, b: number, c: Vec3,
): number {
  const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
  const dx = p[b * 3] - ax, dy = p[b * 3 + 1] - ay, dz = p[b * 3 + 2] - az;
  const px = c[0] - ax, py = c[1] - ay, pz = c[2] - az;
  const ll = dx * dx + dy * dy + dz * dz;
  let t = ll > 0 ? (px * dx + py * dy + pz * dz) / ll : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const qx = px - dx * t, qy = py - dy * t, qz = pz - dz * t;
  return qx * qx + qy * qy + qz * qz;
}

function edgeLenSq(p: Float32Array, a: number, b: number): number {
  const dx = p[a * 3] - p[b * 3];
  const dy = p[a * 3 + 1] - p[b * 3 + 1];
  const dz = p[a * 3 + 2] - p[b * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

/** Undirected edge key. Vertex ids stay far below 2^26, so the packed key
 *  fits a double exactly. */
function edgeKey(a: number, b: number): number {
  return a < b ? a * 0x4000000 + b : b * 0x4000000 + a;
}

/** Project `p` onto the iso-surface eval(p) = iso with damped Newton steps.
 *  `h` is the finite-difference step; total movement is clamped to
 *  `maxMove` so a Lipschitz-approximate field (twist/taper/displace) can't
 *  fling a vertex. Mutates and returns `p`. */
function projectToSurface(
  p: Vec3,
  evalFn: (x: number, y: number, z: number) => number,
  iso: number,
  h: number,
  maxMove: number,
): Vec3 {
  let moved = 0;
  for (let i = 0; i < PROJECT_ITERS; i++) {
    const d = evalFn(p[0], p[1], p[2]) - iso;
    if (!Number.isFinite(d)) return p;
    if (Math.abs(d) < h * 0.05) return p;
    const gx = (evalFn(p[0] + h, p[1], p[2]) - evalFn(p[0] - h, p[1], p[2])) / (2 * h);
    const gy = (evalFn(p[0], p[1] + h, p[2]) - evalFn(p[0], p[1] - h, p[2])) / (2 * h);
    const gz = (evalFn(p[0], p[1], p[2] + h) - evalFn(p[0], p[1], p[2] - h)) / (2 * h);
    const g2 = gx * gx + gy * gy + gz * gz;
    if (!Number.isFinite(g2) || g2 < 1e-12) return p;
    let sx = (d / g2) * gx, sy = (d / g2) * gy, sz = (d / g2) * gz;
    const stepLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const budget = maxMove - moved;
    if (budget <= 0) return p;
    if (stepLen > budget) {
      const f = budget / stepLen;
      sx *= f; sy *= f; sz *= f;
    }
    p[0] -= sx; p[1] -= sy; p[2] -= sz;
    moved += Math.min(stepLen, budget);
  }
  return p;
}

/**
 * Refine a watertight triangle mesh near the given detail regions and project
 * the new vertices onto the SDF iso-surface.
 *
 * Each pass marks every edge that (a) crosses a detail sphere and (b) is
 * longer than that sphere's target, into a GLOBAL edge set — both triangles
 * sharing a marked edge see the same mark, so the split is conforming (no
 * T-junctions) by construction. Triangles are then split by how many of
 * their edges are marked (1 → 2, 2 → 3, 3 → 4 children), and every new
 * midpoint is Newton-projected onto the surface.
 */
export function refineMeshNearRegions(
  positionsIn: Float32Array,
  triVertsIn: Uint32Array,
  evalFn: (x: number, y: number, z: number) => number,
  regions: DetailRegion[],
  opts: RefineOptions = {},
): RefineResult {
  const iso = opts.iso ?? 0;
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxTriangles = opts.maxTriangles ?? DEFAULT_MAX_TRIANGLES;

  let positions = positionsIn;
  let triVerts = triVertsIn;
  let rounds = 0;

  // The projection step must not move a vertex farther than roughly one
  // coarse cell — that's the worst-case chord error levelSet leaves behind.
  // Derive it from the longest marked edge seen in round one.
  let maxMove = 0;

  for (let round = 0; round < maxRounds; round++) {
    // --- Mark edges to split (global, undirected). -----------------------
    const marked = new Map<number, number>(); // key -> target edge length
    for (let t = 0; t < triVerts.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = triVerts[t + e], b = triVerts[t + (e + 1) % 3];
        const key = edgeKey(a, b);
        if (marked.has(key)) continue;
        const lenSq = edgeLenSq(positions, a, b);
        for (const r of regions) {
          if (lenSq <= r.edgeLength * r.edgeLength) continue;
          if (segDistSq(positions, a, b, r.center) > r.radius * r.radius) continue;
          const prev = marked.get(key);
          if (prev === undefined || r.edgeLength < prev) marked.set(key, r.edgeLength);
        }
        if (round === 0) {
          const len = Math.sqrt(lenSq);
          if (marked.has(key) && len > maxMove) maxMove = len;
        }
      }
    }
    if (marked.size === 0) break;

    // --- Estimate growth; respect the cap. -------------------------------
    let extra = 0;
    for (let t = 0; t < triVerts.length; t += 3) {
      let n = 0;
      for (let e = 0; e < 3; e++) {
        if (marked.has(edgeKey(triVerts[t + e], triVerts[t + (e + 1) % 3]))) n++;
      }
      extra += n; // 1 marked edge → +1 tri, 2 → +2, 3 → +3
    }
    if (triVerts.length / 3 + extra > maxTriangles) break;

    // --- Split. -----------------------------------------------------------
    const verts: number[] = Array.from(positions);
    const midOf = new Map<number, number>();
    const newTris: number[] = [];

    const midpoint = (a: number, b: number, target: number): number => {
      const key = edgeKey(a, b);
      const cached = midOf.get(key);
      if (cached !== undefined) return cached;
      const idx = verts.length / 3;
      const m: Vec3 = [
        (positions[a * 3] + positions[b * 3]) / 2,
        (positions[a * 3 + 1] + positions[b * 3 + 1]) / 2,
        (positions[a * 3 + 2] + positions[b * 3 + 2]) / 2,
      ];
      const h = Math.max(target * 0.1, 1e-5);
      projectToSurface(m, evalFn, iso, h, maxMove);
      verts.push(m[0], m[1], m[2]);
      midOf.set(key, idx);
      return idx;
    };

    for (let t = 0; t < triVerts.length; t += 3) {
      // Rotate the triangle so the marked-edge pattern is canonical while
      // preserving winding: (v0,v1,v2) → (v1,v2,v0).
      let v0 = triVerts[t], v1 = triVerts[t + 1], v2 = triVerts[t + 2];
      const m01 = (): number | undefined => { const k = edgeKey(v0, v1); return marked.has(k) ? marked.get(k) : undefined; };
      const m12 = (): number | undefined => { const k = edgeKey(v1, v2); return marked.has(k) ? marked.get(k) : undefined; };
      const m20 = (): number | undefined => { const k = edgeKey(v2, v0); return marked.has(k) ? marked.get(k) : undefined; };
      let a = m01(), b = m12(), c = m20();
      const count = (a !== undefined ? 1 : 0) + (b !== undefined ? 1 : 0) + (c !== undefined ? 1 : 0);

      if (count === 0) {
        newTris.push(v0, v1, v2);
        continue;
      }
      if (count === 3) {
        const ab = midpoint(v0, v1, a!), bc = midpoint(v1, v2, b!), ca = midpoint(v2, v0, c!);
        newTris.push(v0, ab, ca, ab, v1, bc, ca, bc, v2, ab, bc, ca);
        continue;
      }
      if (count === 1) {
        // Rotate so the marked edge is (v0, v1).
        while (a === undefined) { [v0, v1, v2] = [v1, v2, v0]; [a, b, c] = [b, c, a]; }
        const ab = midpoint(v0, v1, a);
        newTris.push(v0, ab, v2, ab, v1, v2);
        continue;
      }
      // count === 2: rotate so the UNmarked edge is (v2, v0).
      while (c !== undefined) { [v0, v1, v2] = [v1, v2, v0]; [a, b, c] = [b, c, a]; }
      const ab = midpoint(v0, v1, a!), bc = midpoint(v1, v2, b!);
      newTris.push(ab, v1, bc, v0, ab, bc, v0, bc, v2);
    }

    positions = Float32Array.from(verts);
    triVerts = Uint32Array.from(newTris);
    rounds++;
  }

  return { positions, triVerts, rounds };
}

/** Sphere ↔ AABB overlap — used to skip detail regions that can't touch a
 *  labelled region's mesh bounds. */
export function sphereIntersectsBox(
  center: Vec3, radius: number,
  min: Vec3, max: Vec3,
): boolean {
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const v = center[i];
    if (v < min[i]) d += (min[i] - v) * (min[i] - v);
    else if (v > max[i]) d += (v - max[i]) * (v - max[i]);
  }
  return d <= radius * radius;
}
