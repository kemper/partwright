// Cut operation helpers for the geometry Worker.
// Called from engineWorker.ts when a `cut` message arrives.
// Runs entirely off the main thread — no DOM, no imports, no THREE.

import type { MeshData } from '../geometry/types';

export interface CutParams {
  shape: 'plane' | 'box' | 'sphere' | 'cylinder';
  keepSide: 'outside' | 'inside';
  /** 4×3 column-major matrix: [r00,r10,r20, r01,r11,r21, r02,r12,r22, tx,ty,tz] */
  mat4x3: number[];
  /** Shape dimensions in local space. Plane: [size,size,1]. Box: [sx,sy,sz]. Sphere: [r,r,r]. Cylinder: [r,r,h]. */
  scale: [number, number, number];
  /** Optional input triangle colors (RGB, numTri*3 bytes). Preserved best-effort. */
  triColors?: Uint8Array;
}

export interface CutResult {
  /** The "kept side" mesh — shown in the Apply preview. */
  mesh: MeshData;
  /**
   * All resulting parts: the kept side + the complement, each decomposed into
   * connected components. Every non-empty piece becomes a separate session Part on
   * Save. Length ≥ 1.
   */
  meshes: MeshData[];
  /** Colors for the preview mesh. */
  triColors?: Uint8Array;
  /** Colors per component, parallel to `meshes`. */
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
      if (colorsList && triColors) colorsList.push(mapColors(inputMesh, triColors, cm));
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
  const { shape, keepSide, mat4x3, scale, triColors } = params;
  const [sx, sy, sz] = scale;

  // Compute mesh bounding-sphere radius for sizing the plane half-space
  const meshRadius = meshBoundingRadius(inputMesh);
  const S = Math.max(meshRadius * 20, 1000);

  let base: ManifoldInstance | null = null;
  let cutter: ManifoldInstance | null = null;
  let resultKept: ManifoldInstance | null = null;
  let resultOther: ManifoldInstance | null = null;

  try {
    base = Manifold.ofMesh(inputMesh);
    cutter = buildCutter(Manifold, shape, keepSide, mat4x3, sx, sy, sz, S);
    if (!cutter) return null;

    // keepSide='inside' on volumetric shapes uses intersect; all others use subtract.
    // The complement always uses the opposite operation.
    const useIntersectForKept = keepSide === 'inside' && shape !== 'plane';
    resultKept  = useIntersectForKept ? base.intersect(cutter) : base.subtract(cutter);
    resultOther = useIntersectForKept ? base.subtract(cutter)  : base.intersect(cutter);

    // Preview mesh = the kept side (what the user chose to keep)
    const keptRaw = resultKept.getMesh();
    if (keptRaw.numTri === 0) return null; // cutter didn't intersect

    const mesh = cloneMeshData(keptRaw);

    // Decompose each side into connected components, then combine all non-empty pieces.
    const { meshes: keptMeshes, colorsList: keptColors } = decomposeToParts(resultKept, inputMesh, triColors);
    safeDelete(resultKept);
    resultKept = null;

    const { meshes: otherMeshes, colorsList: otherColors } = decomposeToParts(resultOther, inputMesh, triColors);
    safeDelete(resultOther);
    resultOther = null;

    const meshes: MeshData[] = [...keptMeshes, ...otherMeshes];
    if (meshes.length === 0) meshes.push(mesh); // shouldn't happen, but guard

    const hasColorsList = !!(keptColors || otherColors);
    const triColorsList: Uint8Array[] | undefined = hasColorsList
      ? [...(keptColors ?? []), ...(otherColors ?? [])]
      : undefined;

    // Colors for the combined preview mesh
    let outColors: Uint8Array | undefined;
    if (triColors && triColors.length === inputMesh.numTri * 3 && mesh.numTri > 0) {
      outColors = mapColors(inputMesh, triColors, mesh);
    }

    return { mesh, meshes, triColors: outColors, triColorsList };
  } finally {
    safeDelete(base);
    safeDelete(cutter);
    safeDelete(resultKept);
    safeDelete(resultOther);
  }
}

function buildCutter(
  Manifold: ManifoldModule['Manifold'],
  shape: string,
  keepSide: string,
  mat4x3: number[],
  sx: number,
  sy: number,
  sz: number,
  S: number,
): ManifoldInstance | null {
  if (shape === 'plane') {
    // Half-space: large cube offset so its face aligns with the cut plane.
    // keepSide='outside' keeps the +Z half → subtract the -Z cube.
    // keepSide='inside'  keeps the -Z half → subtract the +Z cube.
    const offset: [number, number, number] = keepSide === 'outside'
      ? [0, 0, -S / 2]
      : [0, 0, S / 2];
    const halfSpace = Manifold.cube([S, S, S], true).translate(offset);
    return halfSpace.transform(mat4x3);
  }
  if (shape === 'box') {
    return Manifold.cube([sx, sy, sz], true).transform(mat4x3);
  }
  if (shape === 'sphere') {
    // scale[0] = full size in local space (proxy.scale.x), so radius = size/2
    const r = sx / 2;
    return Manifold.sphere(r, 32).transform(mat4x3);
  }
  if (shape === 'cylinder') {
    // scale[0]=scale[1]=diameter, scale[2]=height
    const r = sx / 2;
    const h = sz;
    // manifold cylinder goes from z=0 to z=h; center it around z=0.
    // Break chaining to delete the intermediate WASM object.
    const centered = Manifold.cylinder(h, r, r, 32).translate([0, 0, -h / 2]);
    const transformed = centered.transform(mat4x3);
    if (typeof (centered as { delete?: () => void }).delete === 'function') {
      try { (centered as { delete: () => void }).delete(); } catch { /* ignore */ }
    }
    return transformed;
  }
  return null;
}

/** Map input triangle colors to output triangles using centroid nearest-neighbor (best effort). */
function mapColors(
  inputMesh: MeshData,
  inputColors: Uint8Array,
  outputMesh: MeshData,
): Uint8Array {
  const inputCentroids = buildCentroids(inputMesh);
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
