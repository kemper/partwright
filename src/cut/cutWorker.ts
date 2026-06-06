// Cut operation helpers for the geometry Worker.
// Called from engineWorker.ts when a `cut` message arrives.
// Runs entirely off the main thread — no DOM, no imports, no THREE.

import type { MeshData } from '../geometry/types';

export interface CutParams {
  shape: 'plane' | 'box' | 'sphere' | 'cylinder';
  /** 4×3 column-major matrix: [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz] */
  mat4x3: number[];
  /** Shape dimensions in local space. Plane: [size,size,1]. Box: [sx,sy,sz]. Sphere: [r,r,r]. Cylinder: [r,r,h]. */
  scale: [number, number, number];
  /** Optional input triangle colors (RGB, numTri*3 bytes). Preserved best-effort. */
  triColors?: Uint8Array;
}

export interface CutResult {
  /** The "kept side" mesh (undecomposed). */
  mesh: MeshData;
  /** Kept-side components (decomposed). Parallel to `keptColorsList`. */
  keptMeshes: MeshData[];
  /** Complement-side components (decomposed). Parallel to `complementColorsList`. */
  complementMeshes: MeshData[];
  /** All components flat (kept then complement) — kept for backward-compat. */
  meshes: MeshData[];
  /** Colors for the kept-side preview mesh. */
  triColors?: Uint8Array;
  /** Colors per kept component. */
  keptColorsList?: Uint8Array[];
  /** Colors per complement component. */
  complementColorsList?: Uint8Array[];
  /** Colors per all component (flat). */
  triColorsList?: Uint8Array[];
}

// Type for Manifold module as used by performCut
interface ManifoldModule {
  Manifold: {
    ofMesh: (m: MeshData) => ManifoldInstance;
    cube: (size: [number, number, number], center?: boolean) => ManifoldInstance;
    sphere: (r: number, segments?: number) => ManifoldInstance;
    cylinder: (h: number, rLow: number, rHigh?: number, segments?: number) => ManifoldInstance;
  };
}

interface ManifoldInstance {
  subtract: (other: ManifoldInstance) => ManifoldInstance;
  intersect: (other: ManifoldInstance) => ManifoldInstance;
  getMesh: () => MeshData;
  translate: (v: [number, number, number]) => ManifoldInstance;
  transform: (m: number[]) => ManifoldInstance;
  decompose: () => ManifoldInstance[];
  delete?: () => void;
}

function cloneMeshData(raw: MeshData): MeshData {
  const m: MeshData = {
    vertProperties: raw.vertProperties.slice(),
    triVerts: raw.triVerts.slice(),
    numVert: raw.numVert,
    numTri: raw.numTri,
    numProp: raw.numProp,
  };
  if (raw.mergeFromVert) m.mergeFromVert = raw.mergeFromVert.slice();
  if (raw.mergeToVert) m.mergeToVert = raw.mergeToVert.slice();
  if (raw.runIndex) m.runIndex = raw.runIndex.slice();
  if (raw.runOriginalID) m.runOriginalID = raw.runOriginalID.slice();
  return m;
}

function safeDelete(obj: ManifoldInstance | null): void {
  if (obj && typeof obj.delete === 'function') {
    try { obj.delete(); } catch { /* ignore */ }
  }
}

/**
 * Decompose a Manifold into per-component MeshData arrays and optionally map
 * colors from the input mesh to each component. Deletes each piece after
 * extracting its mesh. Returns only non-empty components.
 */
function decomposeToParts(
  result: ManifoldInstance,
  inputMesh: MeshData,
  triColors: Uint8Array | undefined,
  inputCentroids: Float32Array,
): { meshes: MeshData[]; colorsList: Uint8Array[] | undefined } {
  const pieces = result.decompose();
  const hasColors = !!(triColors && triColors.length === inputMesh.numTri * 3);
  const meshes: MeshData[] = [];
  const colorsList: Uint8Array[] | undefined = hasColors ? [] : undefined;
  for (const p of pieces) {
    const pm = p.getMesh();
    if (pm.numTri > 0) {
      const cm = cloneMeshData(pm);
      meshes.push(cm);
      if (colorsList && triColors) colorsList.push(mapColors(triColors, inputCentroids, cm));
    }
    safeDelete(p);
  }
  return { meshes, colorsList };
}

/** Apply a boolean cut to `inputMesh` and return the result. Runs in the Worker. */
export function performCut(
  mod: ManifoldModule,
  inputMesh: MeshData,
  params: CutParams,
): CutResult | null {
  const { Manifold } = mod;
  const { shape, mat4x3, scale, triColors } = params;
  const [sx, sy, sz] = scale;

  // Compute mesh bounding-sphere radius for sizing the plane half-space (use original mesh)
  const meshRadius = meshBoundingRadius(inputMesh);
  const S = Math.max(meshRadius * 20, 1000);

  // For plane cuts with paint colors, subdivide triangles straddling the cut plane
  // so that boundary-region colors are preserved exactly after the boolean.
  let workMesh = inputMesh;
  let workColors = triColors;
  if (shape === 'plane' && triColors && triColors.length === inputMesh.numTri * 3) {
    // mat4x3 = [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz]
    // Column 2 (indices 6-8) is the plane's Z-axis = normal direction
    const planeOrigin: [number, number, number] = [mat4x3[9], mat4x3[10], mat4x3[11]];
    const planeNormal: [number, number, number] = [mat4x3[6], mat4x3[7], mat4x3[8]];
    const sub = subdivideBoundaryTriangles(workMesh, planeOrigin, planeNormal, triColors);
    workMesh = sub.mesh;
    workColors = sub.triColors;
  }

  // Hoist centroid computation once — shared across all decomposeToParts calls
  const inputCentroids = (workColors && workColors.length === workMesh.numTri * 3)
    ? buildCentroids(workMesh)
    : new Float32Array(0);

  let base: ManifoldInstance | null = null;
  let cutter: ManifoldInstance | null = null;
  let resultKept: ManifoldInstance | null = null;
  let resultOther: ManifoldInstance | null = null;

  try {
    base = Manifold.ofMesh(workMesh);
    cutter = buildCutter(Manifold, shape, mat4x3, sx, sy, sz, S);
    if (!cutter) return null;

    // Always compute both sides: subtract(cutter) and intersect(cutter).
    resultKept  = base.subtract(cutter);
    resultOther = base.intersect(cutter);

    // Preview mesh = the kept side (what the user chose to keep)
    const keptRaw = resultKept.getMesh();
    if (keptRaw.numTri === 0) return null; // cutter didn't intersect

    const mesh = cloneMeshData(keptRaw);

    // Decompose each side into connected components, then combine all non-empty pieces.
    const { meshes: keptMeshes, colorsList: keptColors } = decomposeToParts(resultKept, workMesh, workColors, inputCentroids);
    safeDelete(resultKept);
    resultKept = null;

    const { meshes: otherMeshes, colorsList: otherColors } = decomposeToParts(resultOther, workMesh, workColors, inputCentroids);
    safeDelete(resultOther);
    resultOther = null;

    const complementMeshes = otherMeshes;
    const meshes: MeshData[] = [...keptMeshes, ...complementMeshes];
    if (meshes.length === 0) meshes.push(mesh); // shouldn't happen, but guard

    const hasColorsList = !!(keptColors || otherColors);
    const triColorsList: Uint8Array[] | undefined = hasColorsList
      ? [...(keptColors ?? []), ...(otherColors ?? [])]
      : undefined;

    // Colors for the kept-side preview mesh
    let outColors: Uint8Array | undefined;
    if (workColors && workColors.length === workMesh.numTri * 3 && mesh.numTri > 0) {
      outColors = mapColors(workColors, inputCentroids, mesh);
    }

    return {
      mesh,
      keptMeshes,
      complementMeshes,
      meshes,
      triColors: outColors,
      keptColorsList: keptColors ?? undefined,
      complementColorsList: otherColors ?? undefined,
      triColorsList,
    };
  } finally {
    safeDelete(base);
    safeDelete(cutter);
    safeDelete(resultKept);
    safeDelete(resultOther);
  }
}

/**
 * Subdivide triangles in `mesh` that straddle the cut plane (defined by a
 * world-space `planeOrigin` and `planeNormal`). Each straddling triangle is
 * split into three sub-triangles (one alone vertex + two on the other side),
 * all inheriting the parent's color. Non-straddling triangles pass through
 * unchanged. Returns the original mesh if no triangles straddle the plane.
 */
function subdivideBoundaryTriangles(
  mesh: MeshData,
  planeOrigin: [number, number, number],
  planeNormal: [number, number, number],
  triColors: Uint8Array,
): { mesh: MeshData; triColors: Uint8Array } {
  const stride = mesh.numProp;
  const [ox, oy, oz] = planeOrigin;
  const [nx, ny, nz] = planeNormal;

  // Classify each vertex: +1 = positive side, -1 = non-positive side
  const side = new Int8Array(mesh.numVert);
  for (let v = 0; v < mesh.numVert; v++) {
    const x = mesh.vertProperties[v * stride] - ox;
    const y = mesh.vertProperties[v * stride + 1] - oy;
    const z = mesh.vertProperties[v * stride + 2] - oz;
    side[v] = (x * nx + y * ny + z * nz) > 0 ? 1 : -1;
  }

  // Early exit if no straddling triangles
  let straddleCount = 0;
  for (let t = 0; t < mesh.numTri; t++) {
    const s = side[mesh.triVerts[t * 3]] + side[mesh.triVerts[t * 3 + 1]] + side[mesh.triVerts[t * 3 + 2]];
    if (s !== 3 && s !== -3) straddleCount++;
  }
  if (straddleCount === 0) return { mesh, triColors };

  // Build new geometry: copy all existing vertices, then add edge midpoints
  const newVerts: number[] = Array.from(mesh.vertProperties);
  let numNewVert = mesh.numVert;
  const newTris: number[] = [];
  const newColors: number[] = [];

  // Insert interpolated vertex at the plane crossing between v0 and v1
  function addEdgeMidpoint(v0: number, v1: number): number {
    const x0 = mesh.vertProperties[v0 * stride];
    const y0 = mesh.vertProperties[v0 * stride + 1];
    const z0 = mesh.vertProperties[v0 * stride + 2];
    const x1 = mesh.vertProperties[v1 * stride];
    const y1 = mesh.vertProperties[v1 * stride + 1];
    const z1 = mesh.vertProperties[v1 * stride + 2];
    const d0 = (x0 - ox) * nx + (y0 - oy) * ny + (z0 - oz) * nz;
    const d1 = (x1 - ox) * nx + (y1 - oy) * ny + (z1 - oz) * nz;
    const denom = d0 - d1;
    const t = Math.abs(denom) < 1e-9 ? 0.5 : d0 / denom;
    const newIdx = numNewVert++;
    for (let p = 0; p < stride; p++) {
      newVerts.push(mesh.vertProperties[v0 * stride + p] * (1 - t) + mesh.vertProperties[v1 * stride + p] * t);
    }
    return newIdx;
  }

  for (let t = 0; t < mesh.numTri; t++) {
    const v0 = mesh.triVerts[t * 3];
    const v1 = mesh.triVerts[t * 3 + 1];
    const v2 = mesh.triVerts[t * 3 + 2];
    const s0 = side[v0], s1 = side[v1], s2 = side[v2];
    const s = s0 + s1 + s2;
    const r = triColors[t * 3], g = triColors[t * 3 + 1], b = triColors[t * 3 + 2];

    if (s === 3 || s === -3) {
      // Non-straddling: keep as-is
      newTris.push(v0, v1, v2);
      newColors.push(r, g, b);
    } else {
      // Find the "alone" vertex (the one on the minority side)
      let alone: number, a: number, bv: number;
      if (s0 !== s1 && s0 !== s2) {
        alone = v0; a = v1; bv = v2;
      } else if (s1 !== s0 && s1 !== s2) {
        alone = v1; a = v0; bv = v2;
      } else {
        alone = v2; a = v0; bv = v1;
      }
      // Split into three triangles along the plane crossing edges
      const mab = addEdgeMidpoint(alone, a);
      const mbb = addEdgeMidpoint(alone, bv);
      newTris.push(alone, mab, mbb);  newColors.push(r, g, b);
      newTris.push(mab, a, bv);       newColors.push(r, g, b);
      newTris.push(mab, bv, mbb);     newColors.push(r, g, b);
    }
  }

  const numTri = newTris.length / 3;
  const outMesh: MeshData = {
    vertProperties: new Float32Array(newVerts),
    triVerts: new Uint32Array(newTris),
    numVert: numNewVert,
    numTri,
    numProp: stride,
  };
  return { mesh: outMesh, triColors: new Uint8Array(newColors) };
}

/**
 * Convert a 12-element column-major 3×4 matrix (the gizmo's `mat4x3`:
 * [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz]) into the 16-element
 * column-major 4×4 `Mat4` that manifold-3d's `.transform()` binding requires.
 * Passing the bare 12-element array makes the binding read past the end and
 * produces a degenerate (empty) result — see meshOps.ts / curves.ts, which
 * both build a full 16-float matrix for the same reason.
 */
function mat4x3ToMat4(m: number[]): number[] {
  return [
    m[0], m[1], m[2], 0, // col 0
    m[3], m[4], m[5], 0, // col 1
    m[6], m[7], m[8], 0, // col 2
    m[9], m[10], m[11], 1, // col 3 (translation + homogeneous 1)
  ];
}

function buildCutter(
  Manifold: ManifoldModule['Manifold'],
  shape: string,
  mat4x3: number[],
  sx: number,
  sy: number,
  sz: number,
  S: number,
): ManifoldInstance | null {
  const mat = mat4x3ToMat4(mat4x3);
  if (shape === 'plane') {
    // Half-space: large cube in the -Z region. subtract(cutter) keeps the +Z side;
    // intersect(cutter) keeps the -Z side. Both sides are always returned.
    const halfSpace = Manifold.cube([S, S, S], true).translate([0, 0, -S / 2] as [number, number, number]);
    return halfSpace.transform(mat);
  }
  if (shape === 'box') {
    return Manifold.cube([sx, sy, sz], true).transform(mat);
  }
  if (shape === 'sphere') {
    // scale[0] = full size in local space (proxy.scale.x), so radius = size/2
    const r = sx / 2;
    return Manifold.sphere(r, 32).transform(mat);
  }
  if (shape === 'cylinder') {
    // scale[0]=scale[1]=diameter, scale[2]=height
    const r = sx / 2;
    const h = sz;
    // manifold cylinder goes from z=0 to z=h; center it around z=0.
    // Break chaining to delete the intermediate WASM object.
    const centered = Manifold.cylinder(h, r, r, 32).translate([0, 0, -h / 2]);
    const transformed = centered.transform(mat);
    if (typeof (centered as { delete?: () => void }).delete === 'function') {
      try { (centered as { delete: () => void }).delete(); } catch { /* ignore */ }
    }
    return transformed;
  }
  return null;
}

/** Map input triangle colors to output triangles using centroid nearest-neighbor (best effort). */
function mapColors(
  inputColors: Uint8Array,
  inputCentroids: Float32Array,
  outputMesh: MeshData,
): Uint8Array {
  const outputColors = new Uint8Array(outputMesh.numTri * 3);
  const outStride = outputMesh.numProp;

  for (let ot = 0; ot < outputMesh.numTri; ot++) {
    const v0 = outputMesh.triVerts[ot * 3];
    const v1 = outputMesh.triVerts[ot * 3 + 1];
    const v2 = outputMesh.triVerts[ot * 3 + 2];
    const cx = (outputMesh.vertProperties[v0 * outStride]
      + outputMesh.vertProperties[v1 * outStride]
      + outputMesh.vertProperties[v2 * outStride]) / 3;
    const cy = (outputMesh.vertProperties[v0 * outStride + 1]
      + outputMesh.vertProperties[v1 * outStride + 1]
      + outputMesh.vertProperties[v2 * outStride + 1]) / 3;
    const cz = (outputMesh.vertProperties[v0 * outStride + 2]
      + outputMesh.vertProperties[v1 * outStride + 2]
      + outputMesh.vertProperties[v2 * outStride + 2]) / 3;

    // Find nearest input triangle centroid
    let nearest = 0;
    let bestDist = Infinity;
    const numIn = inputCentroids.length / 3;
    for (let it = 0; it < numIn; it++) {
      const dx = inputCentroids[it * 3] - cx;
      const dy = inputCentroids[it * 3 + 1] - cy;
      const dz = inputCentroids[it * 3 + 2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < bestDist) { bestDist = d2; nearest = it; }
    }
    outputColors[ot * 3]     = inputColors[nearest * 3];
    outputColors[ot * 3 + 1] = inputColors[nearest * 3 + 1];
    outputColors[ot * 3 + 2] = inputColors[nearest * 3 + 2];
  }
  return outputColors;
}

function buildCentroids(mesh: MeshData): Float32Array {
  const stride = mesh.numProp;
  const c = new Float32Array(mesh.numTri * 3);
  for (let t = 0; t < mesh.numTri; t++) {
    const v0 = mesh.triVerts[t * 3];
    const v1 = mesh.triVerts[t * 3 + 1];
    const v2 = mesh.triVerts[t * 3 + 2];
    c[t * 3]     = (mesh.vertProperties[v0 * stride]     + mesh.vertProperties[v1 * stride]     + mesh.vertProperties[v2 * stride])     / 3;
    c[t * 3 + 1] = (mesh.vertProperties[v0 * stride + 1] + mesh.vertProperties[v1 * stride + 1] + mesh.vertProperties[v2 * stride + 1]) / 3;
    c[t * 3 + 2] = (mesh.vertProperties[v0 * stride + 2] + mesh.vertProperties[v1 * stride + 2] + mesh.vertProperties[v2 * stride + 2]) / 3;
  }
  return c;
}

function meshBoundingRadius(mesh: MeshData): number {
  let maxR2 = 0;
  const stride = mesh.numProp;
  for (let v = 0; v < mesh.numVert; v++) {
    const x = mesh.vertProperties[v * stride];
    const y = mesh.vertProperties[v * stride + 1];
    const z = mesh.vertProperties[v * stride + 2];
    maxR2 = Math.max(maxR2, x * x + y * y + z * z);
  }
  return Math.sqrt(maxR2);
}

/**
 * Merge multiple MeshData objects into one by concatenating their vertex and
 * triangle arrays. The resulting mesh has disconnected components — one per
 * input mesh. Returns null if the input is empty.
 */
export function mergeMeshData(meshes: MeshData[]): MeshData | null {
  const nonempty = meshes.filter(m => m.numTri > 0 && m.numVert > 0);
  if (nonempty.length === 0) return null;
  if (nonempty.length === 1) return nonempty[0];

  const stride = nonempty[0].numProp;
  let totalVerts = 0;
  let totalTris = 0;
  for (const m of nonempty) { totalVerts += m.numVert; totalTris += m.numTri; }

  const vertProperties = new Float32Array(totalVerts * stride);
  const triVerts = new Uint32Array(totalTris * 3);

  let vOff = 0;
  let tOff = 0;
  for (const m of nonempty) {
    vertProperties.set(m.vertProperties, vOff * stride);
    for (let t = 0; t < m.numTri; t++) {
      triVerts[tOff * 3]     = m.triVerts[t * 3]     + vOff;
      triVerts[tOff * 3 + 1] = m.triVerts[t * 3 + 1] + vOff;
      triVerts[tOff * 3 + 2] = m.triVerts[t * 3 + 2] + vOff;
      tOff++;
    }
    vOff += m.numVert;
  }

  return { vertProperties, triVerts, numVert: totalVerts, numTri: totalTris, numProp: stride };
}

/**
 * Build an "exploded view" mesh that shows both the kept and complement sides
 * simultaneously, each offset by `offsetDist` along the cut normal so the gap
 * between them makes the cut plane visible. The kept side is pushed in the
 * +normal direction, the complement in -normal. Colors are concatenated in the
 * same order. Returns null if no non-empty meshes exist.
 */
export function buildExplodedMesh(
  keptMeshes: MeshData[],
  complementMeshes: MeshData[],
  cutNormal: [number, number, number],
  offsetDist: number,
  keptColorsList?: Uint8Array[],
  complementColorsList?: Uint8Array[],
): { mesh: MeshData; triColors: Uint8Array | undefined } | null {
  const [nx, ny, nz] = cutNormal;

  function offsetMesh(m: MeshData, dx: number, dy: number, dz: number): MeshData {
    const vp = new Float32Array(m.vertProperties);
    const stride = m.numProp;
    for (let v = 0; v < m.numVert; v++) {
      vp[v * stride]     += dx;
      vp[v * stride + 1] += dy;
      vp[v * stride + 2] += dz;
    }
    return { ...m, vertProperties: vp };
  }

  const keptOffset  =  offsetDist;
  const compOffset  = -offsetDist;

  const offsetKept = keptMeshes.map(m => offsetMesh(m, nx * keptOffset, ny * keptOffset, nz * keptOffset));
  const offsetComp = complementMeshes.map(m => offsetMesh(m, nx * compOffset, ny * compOffset, nz * compOffset));

  const merged = mergeMeshData([...offsetKept, ...offsetComp]);
  if (!merged) return null;

  // Build combined color array if paint data is present
  let triColors: Uint8Array | undefined;
  const hasColors = !!(keptColorsList?.length || complementColorsList?.length);
  if (hasColors) {
    const totalTris = [...offsetKept, ...offsetComp].reduce((s, m) => s + m.numTri, 0);
    const combined = new Uint8Array(totalTris * 3);
    let off = 0;
    const allColors = [...(keptColorsList ?? []), ...(complementColorsList ?? [])];
    for (const c of allColors) { combined.set(c, off); off += c.length; }
    triColors = combined;
  }

  return { mesh: merged, triColors };
}
