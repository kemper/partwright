// BFS triangle unfolding — surface-following UV parameterization.
//
// Traverses the mesh via triangle adjacency in BFS order, "unfolding" each
// triangle into a flat 2D UV plane (isometric local unfolding). The result
// is a parameterization whose U and V axes follow the mesh surface, so texture
// patterns applied in UV space curve naturally around the model.
//
// Limitations (acceptable for a surface-texture spike):
//   - Accumulated angular error causes drift for highly curved surfaces.
//   - Closed surfaces have a seam where the BFS "wraps around."
//   - UV coordinates are in world units (scale = 1:1 with 3D distances).
//
// Pure logic (no DOM/WASM) → unit-tested in the vitest tier.

export interface UVResult {
  /** Per-vertex UV, 2 floats per vertex: [u0,v0, u1,v1, ...]. World units. */
  uvs: Float32Array;
}

/** Edge length between vertex i and j in a position buffer (x,y,z per vertex). */
function edgeLen(p: Float32Array, i: number, j: number): number {
  const dx = p[i * 3] - p[j * 3];
  const dy = p[i * 3 + 1] - p[j * 3 + 1];
  const dz = p[i * 3 + 2] - p[j * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Unfold vertex v3 into UV space by isometric projection.
 *
 * Given the shared edge v1→v2 (with known UV coords uv1, uv2) from the
 * already-placed triangle, places v3 to the RIGHT of the directed edge.
 * Preserves 3D distances as faithfully as possible.
 */
function unfoldVertex(
  v1: number, v2: number, v3: number,
  uv1: [number, number], uv2: [number, number],
  p: Float32Array,
): [number, number] {
  const p1x = p[v1 * 3], p1y = p[v1 * 3 + 1], p1z = p[v1 * 3 + 2];
  const p2x = p[v2 * 3], p2y = p[v2 * 3 + 1], p2z = p[v2 * 3 + 2];
  const p3x = p[v3 * 3], p3y = p[v3 * 3 + 1], p3z = p[v3 * 3 + 2];

  // 3D edge
  const ex = p2x - p1x, ey = p2y - p1y, ez = p2z - p1z;
  const e2 = ex * ex + ey * ey + ez * ez;
  if (e2 < 1e-14) return [(uv1[0] + uv2[0]) / 2, (uv1[1] + uv2[1]) / 2];

  // Scalar projection of (p3-p1) along the edge
  const dx = p3x - p1x, dy = p3y - p1y, dz = p3z - p1z;
  const t = (dx * ex + dy * ey + dz * ez) / e2;

  // Perpendicular component length (distance from edge line to p3 in 3D)
  const rx = dx - t * ex, ry = dy - t * ey, rz = dz - t * ez;
  const perpLen = Math.sqrt(rx * rx + ry * ry + rz * rz);

  // UV edge vector
  const uvEx = uv2[0] - uv1[0], uvEy = uv2[1] - uv1[1];
  const uvELen = Math.sqrt(uvEx * uvEx + uvEy * uvEy);
  if (uvELen < 1e-14) return [(uv1[0] + uv2[0]) / 2, (uv1[1] + uv2[1]) / 2];

  // CW rotation of the unit edge vector → places v3 to the RIGHT of v1→v2.
  // This keeps alternating triangles on opposite sides so they tile correctly.
  const uvPerpX = uvEy / uvELen;   // CW rot: (y, -x)
  const uvPerpY = -uvEx / uvELen;

  return [
    uv1[0] + t * uvEx + perpLen * uvPerpX,
    uv1[1] + t * uvEy + perpLen * uvPerpY,
  ];
}

/**
 * BFS triangle unfolding UV parameterization.
 *
 * Returns per-vertex UV coordinates in world units (U and V distances on the
 * surface). For a sphere with radius 5, UV values range over ~[−5π, +5π].
 *
 * The BFS seed is the largest-area triangle found near the mesh centroid,
 * placed with its longest edge along the +U axis (so stitchWidth maps
 * naturally to horizontal stitch count).
 */
export function bfsUnwrapMesh(
  positions: Float32Array,
  triVerts: Uint32Array,
): UVResult {
  const numVert = positions.length / 3;
  const numTri = triVerts.length / 3;
  if (numTri === 0) return { uvs: new Float32Array(numVert * 2) };

  // --- Build undirected edge adjacency ---
  // Key: "v_min,v_max" → [{tri, vA, vB, vOpposite}] where vA→vB is A's CCW order.
  type EdgeEntry = { tri: number; vA: number; vB: number; vC: number };
  const edgeAdj = new Map<string, EdgeEntry[]>();

  for (let t = 0; t < numTri; t++) {
    const va = triVerts[t * 3], vb = triVerts[t * 3 + 1], vc = triVerts[t * 3 + 2];
    const tris: [number, number, number][] = [[va, vb, vc], [vb, vc, va], [vc, va, vb]];
    for (const [v1, v2, v3] of tris) {
      const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
      let arr = edgeAdj.get(key);
      if (!arr) edgeAdj.set(key, arr = []);
      arr.push({ tri: t, vA: v1, vB: v2, vC: v3 });
    }
  }

  // --- Find best seed triangle ---
  // Use the triangle with the longest hypotenuse whose centroid is closest to
  // the mesh centroid, biasing toward "flat" areas to minimise early drift.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < positions.length; i += 3) {
    cx += positions[i]; cy += positions[i + 1]; cz += positions[i + 2];
  }
  cx /= numVert; cy /= numVert; cz /= numVert;

  let bestSeed = 0, bestScore = Infinity;
  for (let t = 0; t < Math.min(numTri, 2000); t++) {
    const va = triVerts[t * 3], vb = triVerts[t * 3 + 1], vc = triVerts[t * 3 + 2];
    const tcx = (positions[va * 3] + positions[vb * 3] + positions[vc * 3]) / 3;
    const tcy = (positions[va * 3 + 1] + positions[vb * 3 + 1] + positions[vc * 3 + 1]) / 3;
    const tcz = (positions[va * 3 + 2] + positions[vb * 3 + 2] + positions[vc * 3 + 2]) / 3;
    const dist = (tcx - cx) ** 2 + (tcy - cy) ** 2 + (tcz - cz) ** 2;
    if (dist < bestScore) { bestScore = dist; bestSeed = t; }
  }

  // --- UV storage ---
  const uvFlat = new Float32Array(numVert * 2);
  const placed = new Uint8Array(numVert);
  const uv = (v: number): [number, number] => [uvFlat[v * 2], uvFlat[v * 2 + 1]];
  const setUV = (v: number, u: number, vCoord: number) => {
    uvFlat[v * 2] = u; uvFlat[v * 2 + 1] = vCoord;
    placed[v] = 1;
  };

  const triVisited = new Uint8Array(numTri);

  // BFS queue item: [triIdx, parentEdgeVA, parentEdgeVB]
  // parentEdgeVA→parentEdgeVB is the shared edge directed from the parent triangle.
  const queueTri: number[] = [];
  const queuePA: number[] = [];
  const queuePB: number[] = [];

  const enqueueAdjacent = (tri: number) => {
    const ta = triVerts[tri * 3], tb = triVerts[tri * 3 + 1], tc = triVerts[tri * 3 + 2];
    const edges: [number, number][] = [[ta, tb], [tb, tc], [tc, ta]];
    for (const [v1, v2] of edges) {
      const key = v1 < v2 ? `${v1},${v2}` : `${v2},${v1}`;
      for (const { tri: adjTri } of edgeAdj.get(key) ?? []) {
        if (adjTri !== tri && !triVisited[adjTri]) {
          queueTri.push(adjTri);
          queuePA.push(v1);
          queuePB.push(v2);
        }
      }
    }
  };

  // Process each connected component
  for (let comp = 0; comp < numTri; comp++) {
    const startTri = comp === 0 ? bestSeed : comp;
    if (triVisited[startTri]) continue;

    const sv0 = triVerts[startTri * 3];
    const sv1 = triVerts[startTri * 3 + 1];
    const sv2 = triVerts[startTri * 3 + 2];

    // Align longest edge of seed triangle along +U axis
    const e01 = edgeLen(positions, sv0, sv1);
    const e12 = edgeLen(positions, sv1, sv2);
    const e20 = edgeLen(positions, sv2, sv0);
    let [seedA, seedB, seedC] = [sv0, sv1, sv2];
    if (e12 >= e01 && e12 >= e20) [seedA, seedB, seedC] = [sv1, sv2, sv0];
    else if (e20 >= e01 && e20 >= e12) [seedA, seedB, seedC] = [sv2, sv0, sv1];
    const eAB = edgeLen(positions, seedA, seedB);

    setUV(seedA, 0, 0);
    setUV(seedB, eAB, 0);
    const [uc, vc_] = unfoldVertex(seedA, seedB, seedC, uv(seedA), uv(seedB), positions);
    setUV(seedC, uc, vc_);
    triVisited[startTri] = 1;
    enqueueAdjacent(startTri);

    let qi = 0;
    while (qi < queueTri.length) {
      const tri = queueTri[qi];
      const pA = queuePA[qi];
      const pB = queuePB[qi];
      qi++;

      if (triVisited[tri]) continue;
      triVisited[tri] = 1;

      const ta = triVerts[tri * 3], tb = triVerts[tri * 3 + 1], tc = triVerts[tri * 3 + 2];
      // Find the vertex not on the shared edge
      const newV = ta !== pA && ta !== pB ? ta : tb !== pA && tb !== pB ? tb : tc;

      if (!placed[newV] && placed[pA] && placed[pB]) {
        const [nu, nv] = unfoldVertex(pA, pB, newV, uv(pA), uv(pB), positions);
        setUV(newV, nu, nv);
      }

      enqueueAdjacent(tri);
    }
  }

  return { uvs: uvFlat };
}
