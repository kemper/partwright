import * as THREE from 'three';
import { createWhiteMaterial, createBlackWireframeMaterial, createCreaseEdgeMaterial } from './materials';
import type { MeshData } from '../geometry/types';
import { meshDataToGeometry as indexedGeometry, triColoredGeometry } from './meshGeometry';
import { previewProxy } from './previewProxy';
import { buildOffscreenOverlay, disposeOffscreenOverlay } from './viewportRegistry';
import { presetIndex } from '../storage/db';
import type { SessionAttachment, AttachedImage } from '../storage/attachment';
import { CREASE_ANGLE_DEG, resolveEdgeMode, type EdgeMode } from './edgeMode';
import { getConfig } from '../config/appConfig';
import { getReferenceMesh } from './referenceMesh';
export { EDGE_MODES, type EdgeMode } from './edgeMode';

/** Composite-render angle sets accepted by `partwright.renderViews`.
 *  Single source of truth shared by the API surface (main.ts), the AI
 *  tool schema (src/ai/tools.ts), and the per-turn system prompt. */
export const RENDER_VIEW_MODES = ['auto', 'tri', 'all', 'box'] as const;
export type RenderViewMode = typeof RENDER_VIEW_MODES[number];

/** Standard camera angles used by `renderSingleView` consumers across
 *  the app: the renderViews composite, the Show-AI iso-views capture,
 *  and any future thumbnail caller. Each value is exactly the shape
 *  `renderSingleView` accepts. Single source so the Front-elevation
 *  semantics can't drift between callers. */
export const STANDARD_VIEWS = {
  front: { label: 'Front', elevation: 0,  azimuth: 0,   ortho: true  },
  right: { label: 'Right', elevation: 0,  azimuth: 90,  ortho: true  },
  top:   { label: 'Top',   elevation: 90, azimuth: 0,   ortho: true  },
  iso:   { label: 'Iso',   elevation: 35, azimuth: 45,  ortho: false },
} as const;
/** Solid-shaded grey applied to triangles that have no color region.
 *  Sits between the white render background and the brightest painted
 *  RGB so silhouettes stay visible without overpowering painted
 *  features. ~0.85 is roughly halfway in perceptual luminance between
 *  white and middle-gray (#bfbfbf). Picking a value too dark obscures
 *  pastel paints; too light and the mesh disappears against the bg. */
const UNPAINTED_BASE = 0.85;

interface ViewConfig {
  name: string;
  position: (d: number) => [number, number, number];
  up: [number, number, number];
}

// 4 isometric angles from alternating cube corners — every face visible in 3+ views
const VIEWS: ViewConfig[] = [
  { name: 'Upper Front-Right', position: (d) => [d, -d, d],    up: [0, 0, 1] },
  { name: 'Upper Back-Left',   position: (d) => [-d, d, d],    up: [0, 0, 1] },
  { name: 'Under Front-Left',  position: (d) => [-d, -d, -d],  up: [0, 0, 1] },
  { name: 'Under Back-Right',  position: (d) => [d, d, -d],    up: [0, 0, 1] },
];

function meshDataToGeometry(meshData: MeshData): THREE.BufferGeometry {
  // Unpainted base is light gray, NOT pure white, so the mesh silhouette is
  // visible against the white render background. Pure white made unpainted
  // parts of a model invisible against the bg — only the painted patches
  // showed, which read as "the renderer is broken" to a model reasoning from
  // the image.
  return meshData.triColors
    ? triColoredGeometry(meshData as MeshData & { triColors: Uint8Array }, [UNPAINTED_BASE, UNPAINTED_BASE, UNPAINTED_BASE])
    : indexedGeometry(meshData);
}

let offRenderer: THREE.WebGLRenderer | null = null;
let offRendererDisposeTimer: ReturnType<typeof setTimeout> | null = null;

// Three.js retains compiled shader programs, framebuffers, and texture handles
// inside WebGLRenderer that setSize() does not free. Browsers also cap a tab
// at ~16 live WebGL contexts. We dispose the offscreen renderer after a short
// idle window so GPU memory is reclaimed between user actions; the lazy branch
// in getOffscreenRenderer re-creates it on the next render.

function disposeOffscreenRenderer(): void {
  if (!offRenderer) return;
  // forceContextLoss releases the underlying WebGL context; dispose() alone
  // leaves it counted against the per-tab context cap.
  offRenderer.forceContextLoss();
  offRenderer.dispose();
  offRenderer = null;
}

function scheduleOffscreenDispose(): void {
  if (offRendererDisposeTimer) clearTimeout(offRendererDisposeTimer);
  offRendererDisposeTimer = setTimeout(() => {
    offRendererDisposeTimer = null;
    disposeOffscreenRenderer();
  }, getConfig().renderer.offscreenIdleDisposeMs);
}

function getOffscreenRenderer(size: number): THREE.WebGLRenderer {
  if (!offRenderer) {
    offRenderer = new THREE.WebGLRenderer({ antialias: true });
    offRenderer.setPixelRatio(1);
  }
  offRenderer.setSize(size, size);
  scheduleOffscreenDispose();
  return offRenderer;
}

/** Dispose scene contents (meshes, lines, geometries, materials) to prevent
 *  WebGL memory leaks. Covers both Mesh (solid + wireframe overlay) and Line
 *  (crease-edge LineSegments) — both own a geometry and material. */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose());
      } else {
        obj.material?.dispose?.();
      }
    }
  });
  scene.clear();
}

/** Add the chosen edge overlay on top of a scene that already holds the
 *  solid mesh. `wireframe` draws every triangle edge; `crease` draws only
 *  feature edges (via EdgesGeometry past CREASE_ANGLE_DEG); `none` adds
 *  nothing. The overlay shares the solid mesh's geometry for the wireframe
 *  case, and builds a throwaway EdgesGeometry for the crease case —
 *  disposeScene releases both. Crease edges are skipped past
 *  `renderer.creaseEdgeMaxTriangles`: EdgesGeometry is a synchronous
 *  main-thread pass that froze the app for seconds on a dense import. */
function addEdgeOverlay(scene: THREE.Scene, geometry: THREE.BufferGeometry, mode: EdgeMode): void {
  if (mode === 'wireframe') {
    scene.add(new THREE.Mesh(geometry, createBlackWireframeMaterial()));
  } else if (mode === 'crease' && triangleCount(geometry) <= getConfig().renderer.creaseEdgeMaxTriangles) {
    const edges = new THREE.EdgesGeometry(geometry, CREASE_ANGLE_DEG);
    scene.add(new THREE.LineSegments(edges, createCreaseEdgeMaterial()));
  }
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ?? geometry.getAttribute('position')).count / 3;
}

/** Near/far clip planes for an offscreen camera framing a model of `maxDim`.
 *  The cameras sit 1.4–2× maxDim from the centre, so a fixed far plane clips
 *  any model larger than a few hundred units out of the render entirely (a
 *  blank thumbnail). Mirrors the interactive viewport's fit (viewport.ts);
 *  the floors keep renders of models up to 100 units unchanged. */
function clipPlanes(maxDim: number): { near: number; far: number } {
  return { near: Math.max(0.1, maxDim * 0.001), far: Math.max(1000, maxDim * 10) };
}

export function renderCompositeCanvas(meshData: MeshData): HTMLCanvasElement {
  const geometry = meshDataToGeometry(meshData);
  const viewSize = 500;
  const hasColors = geometry.hasAttribute('color');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(10, -10, 15);
  scene.add(dir);

  const solidMesh = new THREE.Mesh(geometry, createWhiteMaterial(hasColors));
  scene.add(solidMesh);
  addEdgeOverlay(scene, geometry, resolveEdgeMode(undefined, hasColors));

  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  const center = box.getCenter(new THREE.Vector3());
  const bsize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bsize.x, bsize.y, bsize.z);
  const d = maxDim * 1.4;

  const { near, far } = clipPlanes(maxDim);
  const camera = new THREE.PerspectiveCamera(40, 1, near, far);
  const renderer = getOffscreenRenderer(viewSize);

  const annotations = buildOffscreenOverlay(viewSize);
  if (annotations) scene.add(annotations);

  const labelHeight = 28;
  const cellHeight = viewSize + labelHeight;
  const compositeCanvas = document.createElement('canvas');
  compositeCanvas.width = 2 * viewSize;
  compositeCanvas.height = 2 * cellHeight;
  const ctx = compositeCanvas.getContext('2d')!;
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, compositeCanvas.width, compositeCanvas.height);

  VIEWS.forEach((view, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);

    const pos = view.position(d);
    camera.position.set(center.x + pos[0], center.y + pos[1], center.z + pos[2]);
    camera.up.set(view.up[0], view.up[1], view.up[2]);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    const x = col * viewSize;
    const y = row * cellHeight;
    ctx.drawImage(renderer.domElement, x, y);

    // Label below the view, not overlaid
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, y + viewSize, viewSize, labelHeight);
    ctx.fillStyle = '#333333';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(view.name, x + viewSize / 2, y + viewSize + 18);
    ctx.textAlign = 'start';
  });

  if (annotations) {
    scene.remove(annotations);
    disposeOffscreenOverlay(annotations);
  }
  disposeScene(scene);
  geometry.dispose();
  return compositeCanvas;
}

// === Attached session attachments (reference images, models, docs…) ===

export type { SessionAttachment, AttachedImage, AttachmentKind } from '../storage/attachment';

// In-memory mirror of the active session's attachment list. The session
// manager seeds it on open and persists mutations back to IndexedDB; the UI
// reads it synchronously here.
let _attachments: SessionAttachment[] = [];

export function setAttachments(attachments: SessionAttachment[]): void {
  _attachments = attachments;
  window.dispatchEvent(new Event('images-changed'));
}

export function clearAttachments(): void {
  _attachments = [];
  window.dispatchEvent(new Event('images-changed'));
}

export function getAttachments(): SessionAttachment[] {
  return _attachments;
}

/** Image-kind attachments only — what the Gallery strip and the AI's
 *  `getReferenceImages` tool render. */
export function getImageAttachments(): SessionAttachment[] {
  return _attachments.filter(a => a.kind === 'image');
}

/** Stable sort: preset-matching labels first in preset order, others keep
 *  their insertion order at the end. */
export function sortImagesByPreset<T extends AttachedImage>(images: readonly T[]): T[] {
  return images
    .map((item, idx) => ({ item, idx, p: presetIndex(item.label) }))
    .sort((a, b) => {
      const aHasPreset = a.p >= 0;
      const bHasPreset = b.p >= 0;
      if (aHasPreset && bHasPreset) return a.p - b.p;
      if (aHasPreset) return -1;
      if (bHasPreset) return 1;
      return a.idx - b.idx;
    })
    .map(x => x.item);
}

// === Scene construction for offscreen single-view renders ===

function createElevationScene(geometry: THREE.BufferGeometry, bgColor: number, edges?: EdgeMode): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColor);
  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.6);
  dir1.position.set(10, -10, 15);
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dir2.position.set(-10, 10, -5);
  scene.add(dir2);
  const hasColors = geometry.hasAttribute('color');
  const solidMesh = new THREE.Mesh(geometry, createWhiteMaterial(hasColors));
  scene.add(solidMesh);
  // Edge-overlay default (resolveEdgeMode): uncolored meshes get crease
  // edges — corners and silhouettes sharpen shape-reading without spraying
  // facet noise over tessellated curves. A full wireframe would instead
  // compound into a dark mass that washes out painted regions, so painted
  // meshes default to none (read colors, not topology). An explicit `edges`
  // mode overrides either way — catalog hero thumbnails pass 'none'.
  addEdgeOverlay(scene, geometry, resolveEdgeMode(edges, hasColors));
  return scene;
}

/** Render a single view from any camera angle. Returns a data URL (PNG).
 *  For orthographic views, pass ortho: true.
 *  elevation/azimuth are in degrees: elevation 0 = horizon, 90 = top-down.
 *  azimuth 0 = front (-Y), 90 = right (+X), 180 = back (+Y), 270 = left (-X). */
/** Camera defaults for an omitted elevation / azimuth — shared by renders,
 *  pixel probes and the AI tool's view label so they can't disagree. */
export const DEFAULT_VIEW_ELEVATION = 30;
export const DEFAULT_VIEW_AZIMUTH = 315;

/** Build the same THREE.Camera that `renderSingleView` would render
 *  through for these options. Exported so `probePixel` (in
 *  geometry/rayCast.ts) can replay the camera exactly and unproject
 *  pixel coordinates back to world rays that hit the same triangles
 *  the agent sees in the rendered image. Camera setup MUST match
 *  renderSingleView byte-for-byte — both call sites read from this
 *  function so they can't drift. */
export function buildViewCamera(meshData: MeshData, options: {
  elevation?: number;
  azimuth?: number;
  ortho?: boolean;
  /** Frame this world box instead of the whole mesh (zoom onto a part).
   *  The rest of the mesh still renders — anything in front occludes. */
  frame?: { min: [number, number, number]; max: [number, number, number] };
}): THREE.Camera {
  const elevation = (options.elevation ?? DEFAULT_VIEW_ELEVATION) * Math.PI / 180;
  const azimuth = (options.azimuth ?? DEFAULT_VIEW_AZIMUTH) * Math.PI / 180;

  // Bounding box from the raw vertProperties — same numbers
  // renderSingleView computes after constructing the BufferGeometry.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const { vertProperties, numVert, numProp } = meshData;
  for (let i = 0; i < numVert; i++) {
    const x = vertProperties[i * numProp];
    const y = vertProperties[i * numProp + 1];
    const z = vertProperties[i * numProp + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const meshDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (options.frame) {
    [minX, minY, minZ] = options.frame.min;
    [maxX, maxY, maxZ] = options.frame.max;
  }
  const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const bsize = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
  const maxDim = Math.max(bsize.x, bsize.y, bsize.z) || meshDim || 1;
  const dist = maxDim * 2;

  // Spherical to cartesian (Z-up)
  const cx = dist * Math.cos(elevation) * Math.sin(azimuth);
  const cy = dist * Math.cos(elevation) * (-Math.cos(azimuth));
  const cz = dist * Math.sin(elevation);

  // When looking straight down or up (elevation ≈ ±90°), the Z-up vector is
  // parallel to the look direction — a degenerate case Three.js resolves with
  // an arbitrary fallback that puts +Y right and +X downward on screen.
  // Switch to Y-up for polar views so +X is screen-right and +Y is screen-up,
  // matching the standard slicer/CAD build-plate orientation.
  const isPolar = Math.abs(Math.sin(elevation)) > 0.999;
  const [upX, upY, upZ] = isPolar ? [0, 1, 0] : [0, 0, 1];
  const { near } = clipPlanes(maxDim);
  // A framed (zoomed) view still has the whole mesh behind the focus box.
  const { far } = clipPlanes(Math.max(maxDim, meshDim));

  let camera: THREE.Camera;
  if (options.ortho) {
    const halfExtent = maxDim * 0.7;
    const orthoCamera = new THREE.OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, near, far);
    orthoCamera.position.set(center.x + cx, center.y + cy, center.z + cz);
    orthoCamera.up.set(upX, upY, upZ);
    orthoCamera.lookAt(center);
    orthoCamera.updateProjectionMatrix();
    orthoCamera.updateMatrixWorld();
    camera = orthoCamera;
  } else {
    const perspCamera = new THREE.PerspectiveCamera(40, 1, near, far);
    perspCamera.position.set(center.x + cx, center.y + cy, center.z + cz);
    perspCamera.up.set(upX, upY, upZ);
    perspCamera.lookAt(center);
    perspCamera.updateProjectionMatrix();
    perspCamera.updateMatrixWorld();
    camera = perspCamera;
  }
  return camera;
}

/** Add the reference ("ghost") geometry to an offscreen scene, drawn like the
 *  viewport's: translucent, depth-tested (so it hides where it passes behind
 *  the model and shows where it pokes through), plus its crease edges so the
 *  outline reads on a white background. Returns false when there is none. */
function addReferenceGhost(scene: THREE.Scene): boolean {
  const ref = getReferenceMesh();
  if (!ref) return false;
  const color = ref.style.color ?? 0x00ff88;
  const opacity = ref.style.opacity ?? 0.25;
  const geometry = indexedGeometry(ref.mesh);
  if (ref.style.wireframe) {
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.max(opacity, 0.35), wireframe: true })));
    return true;
  }
  const solid = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  }));
  solid.renderOrder = 1; // after the opaque model
  scene.add(solid);
  if (triangleCount(geometry) <= getConfig().renderer.creaseEdgeMaxTriangles) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, CREASE_ANGLE_DEG),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 2.5) }),
    );
    edges.renderOrder = 2;
    scene.add(edges);
  }
  return true;
}

export function renderSingleViewCanvas(meshData: MeshData, options: {
  elevation?: number;
  azimuth?: number;
  ortho?: boolean;
  size?: number;
  edges?: EdgeMode;
  frame?: { min: [number, number, number]; max: [number, number, number] };
  /** Draw a mesh over `renderer.thumbnailMaxTriangles` from a simplified
   *  proxy (see previewProxy.ts). For version thumbnails only — renders an
   *  agent or the user inspects (renderViews, highlights, parts) stay exact. */
  thumbnail?: boolean;
  /** Draw the reference ("ghost") geometry from setReferenceGeometry, when
   *  one is set. The camera still frames the model. */
  reference?: boolean;
} = {}): HTMLCanvasElement {
  const viewSize = options.size ?? 500;

  const geometry = meshDataToGeometry(options.thumbnail ? previewProxy(meshData, getConfig().renderer.thumbnailMaxTriangles) : meshData);
  const scene = createElevationScene(geometry, 0xffffff, options.edges);
  if (options.reference) addReferenceGhost(scene);
  const camera = buildViewCamera(meshData, options);
  const renderer = getOffscreenRenderer(viewSize);

  const annotations = buildOffscreenOverlay(viewSize);
  if (annotations) scene.add(annotations);

  renderer.render(scene, camera);

  const canvas = document.createElement('canvas');
  canvas.width = viewSize;
  canvas.height = viewSize;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(renderer.domElement, 0, 0);

  if (annotations) {
    scene.remove(annotations);
    disposeOffscreenOverlay(annotations);
  }
  disposeScene(scene);
  geometry.dispose();
  return canvas;
}

/** Flat, unlit, aliased REGION render for the photo-match score: returns one
 *  int per pixel — -2 background, -1 a triangle with no region, ≥0 the
 *  triangle's region index from `triRegion` (-3 there drops the triangle,
 *  e.g. an excluded display base). Same camera as renderSingleView /
 *  buildViewCamera. Rendered into a non-multisampled target with a raw
 *  ShaderMaterial so the encoded ids come back bit-exact (no MSAA blending,
 *  no lighting, no colour-space conversion). Rows are top-to-bottom. */
export function renderRegionLabels(meshData: MeshData, triRegion: Int32Array, options: {
  elevation?: number;
  azimuth?: number;
  ortho?: boolean;
  size?: number;
} = {}): { width: number; height: number; labels: Int32Array } {
  const size = options.size ?? 512;
  const { vertProperties, triVerts, numProp, numTri } = meshData;
  let kept = 0;
  for (let t = 0; t < numTri; t++) if (triRegion[t] !== -3) kept++;
  const positions = new Float32Array(kept * 9);
  const ids = new Float32Array(kept * 9);
  let k = 0;
  for (let t = 0; t < numTri; t++) {
    const region = triRegion[t];
    if (region === -3) continue;
    // id+2 so background (alpha 0) and "no region" (-1 → 1) stay distinct;
    // low byte in R, high byte in G.
    const code = Math.max(-1, region) + 2;
    const r = (code & 255) / 255, g = ((code >> 8) & 255) / 255;
    for (let v = 0; v < 3; v++) {
      const vi = triVerts[t * 3 + v];
      positions[k * 9 + v * 3] = vertProperties[vi * numProp];
      positions[k * 9 + v * 3 + 1] = vertProperties[vi * numProp + 1];
      positions[k * 9 + v * 3 + 2] = vertProperties[vi * numProp + 2];
      ids[k * 9 + v * 3] = r; ids[k * 9 + v * 3 + 1] = g; ids[k * 9 + v * 3 + 2] = 0;
    }
    k++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('regionId', new THREE.BufferAttribute(ids, 3));
  const material = new THREE.ShaderMaterial({
    vertexShader: 'attribute vec3 regionId; varying vec3 vId; void main() { vId = regionId; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec3 vId; void main() { gl_FragColor = vec4(vId, 1.0); }',
    side: THREE.DoubleSide,
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = buildViewCamera(meshData, options);
  const renderer = getOffscreenRenderer(size);
  const target = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const buf = new Uint8Array(size * size * 4);
  try {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size, buf);
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    target.dispose();
    disposeScene(scene);
  }
  const labels = new Int32Array(size * size);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size; // GL rows are bottom-up
    for (let x = 0; x < size; x++) {
      const o = (src + x) * 4;
      labels[y * size + x] = buf[o + 3] === 0 ? -2 : (buf[o] | (buf[o + 1] << 8)) - 2;
    }
  }
  return { width: size, height: size, labels };
}

/** Render a single named angle to a PNG data URL. */
export function renderSingleView(meshData: MeshData, options: {
  elevation?: number;
  azimuth?: number;
  ortho?: boolean;
  size?: number;
  edges?: EdgeMode;
  reference?: boolean;
} = {}): string {
  return renderSingleViewCanvas(meshData, options).toDataURL('image/png');
}

/** Render a cross-section at a given Z height as an SVG string */
export interface SliceAnnotations {
  /** Caption across the top, e.g. "y = 0 · seen from −Y (front)". */
  title: string;
  /** World directions pointing right and up in the image, e.g. '+X' / '+Z'. */
  right: string;
  up: string;
  /** Section of the reference ("ghost") geometry through the same plane, in
   *  the same 2D frame — drawn as a dashed outline. */
  reference?: [number, number][][];
}

/** A round length (1, 2 or 5 × 10ⁿ) close to `target`, for a scale bar. */
export function niceLength(target: number): number {
  if (!(target > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(target));
  const m = target / pow;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * pow;
}

function formatLength(n: number): string {
  return Number(n.toPrecision(6)).toString();
}

function contourPath(contour: [number, number][]): string {
  // Flip Y for SVG (SVG Y goes down, our Y goes up).
  return contour.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0].toFixed(3)},${(-pt[1]).toFixed(3)}`).join(' ') + ' Z';
}

/** Render a cross-section (2D contours, +x right / +y up) as an SVG string.
 *  With `annotations` the image also carries a caption, labelled right/up
 *  axis arrows, a scale bar, the section's extents, and the reference
 *  geometry's outline (dashed) — so a reader can tell which way is which and
 *  how big things are without the call's arguments in front of them. */
export function renderSliceSVG(polygons: [number, number][][], boundingBox: { minX: number; maxX: number; minY: number; maxY: number }, size: number = 400, annotations?: SliceAnnotations): string {
  // Frame the model's section plus any reference outline.
  let { minX, maxX, minY, maxY } = boundingBox;
  for (const contour of annotations?.reference ?? []) {
    for (const [x, y] of contour) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const maxDim = Math.max(w, h) || 1;
  const padding = maxDim * 0.1;
  // Annotated images keep a band above (caption) and below (axes, scale).
  const top = annotations ? maxDim * 0.12 : 0;
  const bottom = annotations ? maxDim * 0.16 : 0;
  const vbW = maxDim + padding * 2;
  const vbH = maxDim + padding * 2 + top + bottom;
  // Centre the section in the square-ish frame.
  const vbX = (minX + maxX) / 2 - vbW / 2;
  const vbY = -(minY + maxY) / 2 - (maxDim / 2 + padding) - top;
  const stroke = maxDim * 0.005;

  // One path, even-odd: a hole contour (a hollow wall's inside) stays empty
  // whichever way the slicer wound it.
  const d = polygons.filter(c => c.length >= 2).map(contourPath).join(' ');
  const paths = d ? `<path d="${d}" fill="#4a9eff" fill-opacity="0.3" fill-rule="evenodd" stroke="#2563eb" stroke-width="${stroke}"/>` : '';

  let overlay = '';
  if (annotations) {
    const font = maxDim * 0.045;
    const textAttrs = `font-family="ui-monospace, Menlo, monospace" font-size="${font}" fill="#e4e4e7"`;
    for (const contour of annotations.reference ?? []) {
      if (contour.length < 2) continue;
      overlay += `<path d="${contourPath(contour)}" fill="none" stroke="#34d399" stroke-width="${stroke * 1.5}" stroke-dasharray="${stroke * 6},${stroke * 4}"/>`;
    }
    overlay += `<text x="${vbX + padding * 0.5}" y="${vbY + top * 0.7}" ${textAttrs}>${escapeXml(annotations.title)}</text>`;
    // Axis arrows, bottom-left.
    const ox = vbX + padding * 0.5;
    const oy = vbY + vbH - padding * 0.5;
    const len = maxDim * 0.1;
    const head = len * 0.25;
    const axisStroke = `stroke="#e4e4e7" stroke-width="${stroke * 1.5}" fill="none"`;
    overlay += `<path d="M${ox},${oy} L${ox + len},${oy} M${ox + len - head},${oy - head * 0.6} L${ox + len},${oy} L${ox + len - head},${oy + head * 0.6}" ${axisStroke}/>`;
    overlay += `<path d="M${ox},${oy} L${ox},${oy - len} M${ox - head * 0.6},${oy - len + head} L${ox},${oy - len} L${ox + head * 0.6},${oy - len + head}" ${axisStroke}/>`;
    overlay += `<text x="${ox + len + font * 0.3}" y="${oy + font * 0.35}" ${textAttrs}>${escapeXml(annotations.right)}</text>`;
    overlay += `<text x="${ox - font * 0.6}" y="${oy - len - font * 0.4}" ${textAttrs}>${escapeXml(annotations.up)}</text>`;
    // Scale bar, bottom-right.
    const bar = niceLength(maxDim * 0.25);
    const bx1 = vbX + vbW - padding * 0.5;
    const bx0 = bx1 - bar;
    const by = oy;
    const tick = font * 0.35;
    overlay += `<path d="M${bx0},${by - tick} L${bx0},${by} L${bx1},${by} L${bx1},${by - tick}" ${axisStroke}/>`;
    overlay += `<text x="${(bx0 + bx1) / 2}" y="${by - tick - font * 0.3}" text-anchor="middle" ${textAttrs}>${formatLength(bar)}</text>`;
    // Section extents, bottom-centre.
    const ext = `${formatLength(Number((boundingBox.maxX - boundingBox.minX).toFixed(3)))} × ${formatLength(Number((boundingBox.maxY - boundingBox.minY).toFixed(3)))}`;
    overlay += `<text x="${vbX + vbW / 2}" y="${by + font * 0.35}" text-anchor="middle" ${textAttrs} fill-opacity="0.7">${escapeXml(ext)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${Math.round(size * vbH / vbW)}" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" style="background:#1e1e2e">
    <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#1e1e2e"/>
    ${paths}${overlay}
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
