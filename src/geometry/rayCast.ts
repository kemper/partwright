// Ray-cast and point-probe queries using THREE.Raycaster on mesh data
import * as THREE from 'three';
import type { MeshData } from './types';

export interface RayHit {
  z: number;
  normal: [number, number, number];
  entering: boolean;
}

export interface ProbeResult {
  hits: RayHit[];
  zValues: number[];
  thickness: number | null;
  topZ: number | null;
  bottomZ: number | null;
}

export interface GeneralRayResult {
  hits: { point: [number, number, number]; normal: [number, number, number]; distance: number; triangleId: number }[];
}

export interface PixelHit {
  point: [number, number, number];
  normal: [number, number, number];
  distance: number;
  triangleId: number;
}

/** Pixel-space axis-aligned bounds of the model's projected silhouette in
 *  a given view. Values are rounded pixel coordinates and may fall outside
 *  [0, size) when the model extends past the rendered frame. */
export interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Returned by `probePixel` when the pixel ray misses the mesh. Instead of
 *  a bare null, it reports where the model actually projects in this view
 *  so the caller can re-aim instead of concluding the tool is broken. */
export interface PixelMiss {
  hit: false;
  /** Where the model's silhouette lands in pixel space for this view, or
   *  null when the mesh has no vertices / projects degenerately. */
  modelPixelBounds: PixelBounds | null;
}

function meshDataToBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(mesh.numVert * 3);

  for (let i = 0; i < mesh.numVert; i++) {
    positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export function probeAtXY(meshData: MeshData, x: number, y: number): ProbeResult {
  const geometry = meshDataToBufferGeometry(meshData);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const tempMesh = new THREE.Mesh(geometry, material);

  const raycaster = new THREE.Raycaster();
  // Cast from high above, straight down along -Z
  const origin = new THREE.Vector3(x, y, 1e6);
  const direction = new THREE.Vector3(0, 0, -1);
  raycaster.set(origin, direction);

  const intersections = raycaster.intersectObject(tempMesh);

  const rawHits: RayHit[] = intersections.map(hit => {
    const normal: [number, number, number] = hit.face
      ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]
      : [0, 0, 1];
    // Face normal Z > 0 means top-facing (ray enters), Z < 0 means bottom-facing (ray exits)
    const entering = normal[2] > 0;
    return {
      z: Math.round(hit.point.z * 1000) / 1000,
      normal,
      entering,
    };
  });

  // Deduplicate hits at the same Z (triangulated faces produce duplicates)
  const hits: RayHit[] = [];
  for (const h of rawHits) {
    const existing = hits.find(e => Math.abs(e.z - h.z) < 0.01 && e.entering === h.entering);
    if (!existing) hits.push(h);
  }

  // Sort by Z descending (top to bottom)
  hits.sort((a, b) => b.z - a.z);

  const zValues = hits.map(h => h.z);
  const topZ = zValues.length > 0 ? zValues[0] : null;
  const bottomZ = zValues.length > 0 ? zValues[zValues.length - 1] : null;

  // Compute total material thickness from entry/exit pairs
  let thickness: number | null = null;
  if (hits.length >= 2) {
    let total = 0;
    // Pair up entry/exit: top hit is entry, next is exit, etc.
    for (let i = 0; i < hits.length - 1; i += 2) {
      total += Math.abs(hits[i].z - hits[i + 1].z);
    }
    thickness = Math.round(total * 1000) / 1000;
  }

  // Cleanup
  geometry.dispose();
  material.dispose();

  return { hits, zValues, thickness, topZ, bottomZ };
}

export function probeRay(
  meshData: MeshData,
  origin: [number, number, number],
  direction: [number, number, number],
): GeneralRayResult {
  const geometry = meshDataToBufferGeometry(meshData);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const tempMesh = new THREE.Mesh(geometry, material);

  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3(...direction).normalize();
  raycaster.set(new THREE.Vector3(...origin), dir);

  const intersections = raycaster.intersectObject(tempMesh);

  const rawHits = intersections.map(hit => ({
    point: [
      Math.round(hit.point.x * 1000) / 1000,
      Math.round(hit.point.y * 1000) / 1000,
      Math.round(hit.point.z * 1000) / 1000,
    ] as [number, number, number],
    normal: hit.face
      ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] as [number, number, number]
      : [0, 0, 0] as [number, number, number],
    distance: Math.round(hit.distance * 1000) / 1000,
    triangleId: hit.faceIndex ?? -1,
  }));

  // Deduplicate hits at the same distance (triangulated faces produce duplicates)
  const hits: typeof rawHits = [];
  for (const h of rawHits) {
    const existing = hits.find(e => Math.abs(e.distance - h.distance) < 0.01);
    if (!existing) hits.push(h);
  }

  geometry.dispose();
  material.dispose();

  return { hits };
}

export function measureDistance(
  p1: [number, number, number],
  p2: [number, number, number],
): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000) / 1000;
}

/** Project the mesh's world-space bounding box through `camera` and return
 *  the pixel-space rectangle its silhouette occupies. Used to tell a caller
 *  who missed the mesh where to re-aim. Returns null for an empty/degenerate
 *  mesh. The NDC→pixel mapping is the exact inverse of the forward mapping in
 *  `probePixel`, so the rectangle lines up with the rendered image. */
function projectBoundsToPixels(
  geometry: THREE.BufferGeometry,
  camera: THREE.Camera,
  size: number,
): PixelBounds | null {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || !Number.isFinite(box.min.x)) return null;

  // Camera matrices must be current for project(); buildViewCamera positions
  // the camera but does not refresh matrixWorld/matrixWorldInverse.
  camera.updateMatrixWorld();

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const corner = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    corner.set(
      (i & 1) ? box.max.x : box.min.x,
      (i & 2) ? box.max.y : box.min.y,
      (i & 4) ? box.max.z : box.min.z,
    );
    corner.project(camera); // world → NDC in [-1, 1]
    const px = (corner.x + 1) * 0.5 * size;
    const py = (1 - corner.y) * 0.5 * size;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX: Math.round(minX),
    minY: Math.round(minY),
    maxX: Math.round(maxX),
    maxY: Math.round(maxY),
  };
}

/** Cast a ray from a pixel in a rendered view back into the mesh and
 *  return the first hit (front-most along the ray — so occlusion is
 *  correct by construction). Pixel coordinates use the rendered image's
 *  convention: (0, 0) is top-left, (size-1, size-1) is bottom-right.
 *  `camera` must be the same camera the render was produced with; use
 *  `buildViewCamera` from the renderer module to construct it from the
 *  same view options passed to `renderView`. On a background pixel it
 *  returns a `PixelMiss` carrying the model's pixel-space bounds so the
 *  caller can re-aim, rather than a bare null with no recovery signal. */
export function probePixel(
  meshData: MeshData,
  camera: THREE.Camera,
  pixel: [number, number],
  size: number,
): PixelHit | PixelMiss {
  const geometry = meshDataToBufferGeometry(meshData);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const tempMesh = new THREE.Mesh(geometry, material);

  // NDC: pixel (0,0) → (-1, +1); pixel (size, size) → (+1, -1). Y is
  // flipped because canvas pixel-y grows downward while NDC y grows
  // upward.
  const ndcX = (pixel[0] / size) * 2 - 1;
  const ndcY = -((pixel[1] / size) * 2 - 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const intersections = raycaster.intersectObject(tempMesh);

  if (intersections.length === 0) {
    const modelPixelBounds = projectBoundsToPixels(geometry, camera, size);
    geometry.dispose();
    material.dispose();
    return { hit: false, modelPixelBounds };
  }

  const hit = intersections[0];
  const result: PixelHit = {
    point: [
      Math.round(hit.point.x * 1000) / 1000,
      Math.round(hit.point.y * 1000) / 1000,
      Math.round(hit.point.z * 1000) / 1000,
    ],
    normal: hit.face
      ? [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z]
      : [0, 0, 0],
    distance: Math.round(hit.distance * 1000) / 1000,
    triangleId: hit.faceIndex ?? -1,
  };
  geometry.dispose();
  material.dispose();
  return result;
}
