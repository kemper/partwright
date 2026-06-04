// Projection (screen-space) brush footprint — "paint exactly what I see".
//
// Instead of a 3D-ball centroid scan (which can wrap around thin walls and is
// O(mesh) per move), the regular brush footprint is whatever triangles are
// *visible* under the 2D brush disk. We render the mesh into an offscreen
// triangle-id buffer, then read back the small pixel rectangle under the cursor
// and collect the ids inside the brush shape. The depth test means occluded
// back faces are naturally excluded — you paint what you see, nothing behind it.
//
// WebGL2 (GLSL ES 3.00) does not reliably expose gl_PrimitiveID in the fragment
// shader without a geometry shader, so we render an *unindexed* id-geometry
// (one vertex triple per triangle, in triVerts order) and recover the triangle
// index from gl_VertexID as floor(gl_VertexID / 3). That index matches
// currentMeshData's triangle order, so the ids are directly usable by the paint
// pipeline (and its base-mesh remap).
//
// The id-buffer render is cached and only repeated when the camera moves, the
// mesh changes, or the canvas resizes — during a pointer-captured stroke the
// camera is fixed, so a whole drag costs one render plus cheap per-move reads.

import * as THREE from 'three';
import type { MeshData } from '../geometry/types';
import type { BrushShape } from './subdivide';
import { getCamera, getRenderer, getMeshGroup } from '../renderer/viewport';

const ID_VERTEX = /* glsl */ `
precision highp float;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
in vec3 position;
flat out float vId;
void main() {
  // Unindexed draw: vertices 3t, 3t+1, 3t+2 belong to triangle t.
  vId = floor(float(gl_VertexID) / 3.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ID_FRAGMENT = /* glsl */ `
precision highp float;
flat in float vId;
out vec4 fragColor;
void main() {
  // Encode the triangle index into RGB (24 bits → up to 16.7M triangles, exact
  // in float32). Alpha 1 marks "a triangle is here" so the background (alpha 0)
  // is distinguishable from triangle 0.
  float id = vId;
  float r = mod(id, 256.0);
  float g = mod(floor(id / 256.0), 256.0);
  float b = mod(floor(id / 65536.0), 256.0);
  fragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
`;

let renderTarget: THREE.WebGLRenderTarget | null = null;
let rtW = 0, rtH = 0;

let idMaterial: THREE.RawShaderMaterial | null = null;
let idGeometry: THREE.BufferGeometry | null = null;
let idMesh: THREE.Mesh | null = null;
let idScene: THREE.Scene | null = null;

// Cache invalidation: the id buffer is reused until the mesh, camera pose, or
// canvas size changes.
let builtForMesh: MeshData | null = null;
let bufferValid = false;
const cachedView = new Float32Array(16);
const cachedProj = new Float32Array(16);

function ensureMaterial(): THREE.RawShaderMaterial {
  if (!idMaterial) {
    idMaterial = new THREE.RawShaderMaterial({
      vertexShader: ID_VERTEX,
      fragmentShader: ID_FRAGMENT,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
    });
  }
  return idMaterial;
}

/** Build (or rebuild) the unindexed id-geometry from the current mesh. Triangles
 *  stay in triVerts order so gl_VertexID/3 recovers the mesh triangle index. */
function ensureIdGeometry(mesh: MeshData): void {
  if (builtForMesh === mesh && idGeometry) return;

  const { numTri, triVerts, vertProperties, numProp } = mesh;
  const positions = new Float32Array(numTri * 9);
  for (let t = 0; t < numTri; t++) {
    const v0 = triVerts[t * 3], v1 = triVerts[t * 3 + 1], v2 = triVerts[t * 3 + 2];
    positions[t * 9]     = vertProperties[v0 * numProp];
    positions[t * 9 + 1] = vertProperties[v0 * numProp + 1];
    positions[t * 9 + 2] = vertProperties[v0 * numProp + 2];
    positions[t * 9 + 3] = vertProperties[v1 * numProp];
    positions[t * 9 + 4] = vertProperties[v1 * numProp + 1];
    positions[t * 9 + 5] = vertProperties[v1 * numProp + 2];
    positions[t * 9 + 6] = vertProperties[v2 * numProp];
    positions[t * 9 + 7] = vertProperties[v2 * numProp + 1];
    positions[t * 9 + 8] = vertProperties[v2 * numProp + 2];
  }

  idGeometry?.dispose();
  idGeometry = new THREE.BufferGeometry();
  idGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  if (!idScene) idScene = new THREE.Scene();
  if (!idMesh) {
    idMesh = new THREE.Mesh(idGeometry, ensureMaterial());
    idMesh.matrixAutoUpdate = false;
    idMesh.matrixWorldAutoUpdate = false;
    idMesh.frustumCulled = false;
    idScene.add(idMesh);
  } else {
    idMesh.geometry = idGeometry;
  }

  builtForMesh = mesh;
  bufferValid = false;
}

/** Resize the offscreen render target to match the renderer's drawing buffer. */
function ensureRenderTarget(): void {
  const renderer = getRenderer();
  const w = renderer.domElement.width;
  const h = renderer.domElement.height;
  if (renderTarget && rtW === w && rtH === h) return;
  renderTarget?.dispose();
  renderTarget = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    generateMipmaps: false,
  });
  rtW = w; rtH = h;
  bufferValid = false;
}

/** True when the cached id buffer still matches the live camera pose. */
function cameraUnchanged(camera: THREE.Camera): boolean {
  const view = camera.matrixWorldInverse.elements;
  const proj = camera.projectionMatrix.elements;
  for (let i = 0; i < 16; i++) {
    if (cachedView[i] !== view[i] || cachedProj[i] !== proj[i]) return false;
  }
  return true;
}

function cacheCamera(camera: THREE.Camera): void {
  cachedView.set(camera.matrixWorldInverse.elements);
  cachedProj.set(camera.projectionMatrix.elements);
}

const _clearColor = new THREE.Color();

/** Render the triangle-id buffer if the cache is stale. No-op (cheap) when the
 *  camera, mesh, and canvas are all unchanged since the last render. */
function ensureIdBuffer(camera: THREE.Camera): void {
  if (bufferValid && cameraUnchanged(camera)) return;
  const renderer = getRenderer();
  const solid = getMeshGroup().children[0];
  if (!(solid instanceof THREE.Mesh) || !idMesh || !idScene) return;

  // The id mesh shares the solid mesh's world transform so the buffer lines up
  // pixel-for-pixel with what the user sees.
  idMesh.matrixWorld.copy(solid.matrixWorld);

  const prevRT = renderer.getRenderTarget();
  renderer.getClearColor(_clearColor);
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;

  renderer.setRenderTarget(renderTarget);
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0); // alpha 0 background = "no triangle"
  renderer.clear();
  renderer.render(idScene, camera);

  renderer.setRenderTarget(prevRT);
  renderer.setClearColor(_clearColor, prevAlpha);
  renderer.autoClear = prevAutoClear;

  cacheCamera(camera);
  bufferValid = true;
}

/** Screen-space (projected) pixel radius of a world-space brush radius at the
 *  hit point, measured in drawing-buffer pixels. */
function projectedPixelRadius(
  hit: [number, number, number],
  radius: number,
  camera: THREE.Camera,
): number {
  const a = new THREE.Vector3(hit[0], hit[1], hit[2]);
  // Offset along the camera's screen-right axis so the projected delta is the
  // on-screen extent of the brush regardless of camera type (perspective/ortho).
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(radius);
  const b = a.clone().add(right);
  a.project(camera);
  b.project(camera);
  const dx = (b.x - a.x) * 0.5 * rtW;
  const dy = (b.y - a.y) * 0.5 * rtH;
  return Math.hypot(dx, dy);
}

function insideShape(dx: number, dy: number, pr: number, shape: BrushShape): boolean {
  if (shape === 'square') return Math.abs(dx) <= pr && Math.abs(dy) <= pr;
  if (shape === 'diamond') return Math.abs(dx) + Math.abs(dy) <= pr;
  return dx * dx + dy * dy <= pr * pr;
}

/** Invalidate the cached id-geometry/buffer — call when the painted mesh
 *  changes so the next projection rebuilds against the new geometry. */
export function invalidateProjection(): void {
  builtForMesh = null;
  bufferValid = false;
}

/** Release all GPU resources. Call when leaving paint mode. */
export function disposeProjection(): void {
  renderTarget?.dispose(); renderTarget = null; rtW = 0; rtH = 0;
  idGeometry?.dispose(); idGeometry = null;
  idMaterial?.dispose(); idMaterial = null;
  if (idMesh && idScene) idScene.remove(idMesh);
  idMesh = null; idScene = null;
  builtForMesh = null; bufferValid = false;
}

/** Triangles visible under the brush at the cursor — the screen-space footprint.
 *  Returns ids in `mesh`'s triangle index space, or null if the cursor isn't
 *  over the canvas / nothing is set up. The set may be empty (cursor over empty
 *  background inside the disk). */
export function projectBrushFootprint(opts: {
  event: MouseEvent;
  mesh: MeshData;
  radius: number;
  shape: BrushShape;
  hitPoint: [number, number, number];
}): Set<number> | null {
  const { event, mesh, radius, shape, hitPoint } = opts;
  if (radius <= 0 || mesh.numTri === 0) return null;

  const renderer = getRenderer();
  const camera = getCamera();
  ensureRenderTarget();
  ensureIdGeometry(mesh);
  if (!renderTarget) return null;
  ensureIdBuffer(camera);

  // Cursor → drawing-buffer pixel coords (origin bottom-left).
  const rect = renderer.domElement.getBoundingClientRect();
  const fx = (event.clientX - rect.left) / rect.width;
  const fy = (event.clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const cx = fx * rtW;
  const cy = (1 - fy) * rtH;

  const pr = Math.max(0.5, projectedPixelRadius(hitPoint, radius, camera));
  const x0 = Math.max(0, Math.floor(cx - pr));
  const y0 = Math.max(0, Math.floor(cy - pr));
  const x1 = Math.min(rtW, Math.ceil(cx + pr));
  const y1 = Math.min(rtH, Math.ceil(cy + pr));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return new Set();

  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(renderTarget, x0, y0, w, h, buf);

  const out = new Set<number>();
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const dx = (x0 + px) + 0.5 - cx;
      const dy = (y0 + py) + 0.5 - cy;
      if (!insideShape(dx, dy, pr, shape)) continue;
      const o = (py * w + px) * 4;
      if (buf[o + 3] < 128) continue; // background, no triangle
      out.add(buf[o] + buf[o + 1] * 256 + buf[o + 2] * 65536);
    }
  }
  return out;
}
