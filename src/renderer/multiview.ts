import * as THREE from 'three';
import { createWhiteMaterial, createBlackWireframeMaterial } from './materials';
import type { MeshData } from '../geometry/types';
import { buildStrokesGroup, disposeStrokesGroup } from '../annotations/annotationOverlay';
import { presetIndex } from '../storage/db';

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
export type StandardViewAngle = typeof STANDARD_VIEWS[keyof typeof STANDARD_VIEWS];

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
  { name: 'Upper Front-Right', position: (d) => [d, -d, d],     up: [0, 0, 1] },
  { name: 'Upper Back-Left',   position: (d) => [-d, d, d],     up: [0, 0, 1] },
  { name: 'Under Front-Left',  position: (d) => [-d, -d, -d],   up: [0, 0, 1] },
  { name: 'Under Back-Right',  position: (d) => [d, d, -d],     up: [0, 0, 1] },
];

function meshDataToGeometry(meshData: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  if (meshData.triColors) {
    // Unindex to carry per-triangle colors as per-vertex attributes
    const numTri = meshData.numTri;
    const positions = new Float32Array(numTri * 3 * 3);
    const colors = new Float32Array(numTri * 3 * 3);
    const { vertProperties, triVerts, numProp, triColors } = meshData;

    for (let t = 0; t < numTri; t++) {
      const v0 = triVerts[t * 3];
      const v1 = triVerts[t * 3 + 1];
      const v2 = triVerts[t * 3 + 2];

      for (let c = 0; c < 3; c++) {
        positions[t * 9 + c] = vertProperties[v0 * numProp + c];
        positions[t * 9 + 3 + c] = vertProperties[v1 * numProp + c];
        positions[t * 9 + 6 + c] = vertProperties[v2 * numProp + c];
      }

      const r = triColors[t * 3] / 255;
      const g = triColors[t * 3 + 1] / 255;
      const b = triColors[t * 3 + 2] / 255;
      const painted = (triColors as Uint8Array & { _painted?: Uint8Array })._painted;
      const isPainted = painted ? painted[t] === 1 : (r !== 0 || g !== 0 || b !== 0);
      // Unpainted base is light gray, NOT pure white, so the mesh
      // silhouette is visible against the white render background.
      // Pure white made unpainted parts of a model invisible against
      // the bg — only the painted patches showed, which read as
      // "the renderer is broken" to a model reasoning from the image.
      const cr = isPainted ? r : UNPAINTED_BASE;
      const cg = isPainted ? g : UNPAINTED_BASE;
      const cb = isPainted ? b : UNPAINTED_BASE;

      for (let v = 0; v < 3; v++) {
        colors[t * 9 + v * 3] = cr;
        colors[t * 9 + v * 3 + 1] = cg;
        colors[t * 9 + v * 3 + 2] = cb;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
  } else {
    const positions = new Float32Array(meshData.numVert * 3);
    for (let i = 0; i < meshData.numVert; i++) {
      positions[i * 3] = meshData.vertProperties[i * meshData.numProp];
      positions[i * 3 + 1] = meshData.vertProperties[i * meshData.numProp + 1];
      positions[i * 3 + 2] = meshData.vertProperties[i * meshData.numProp + 2];
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(meshData.triVerts, 1));
    geometry.computeVertexNormals();
  }

  return geometry;
}

let offRenderer: THREE.WebGLRenderer | null = null;
let offRendererDisposeTimer: ReturnType<typeof setTimeout> | null = null;

// Three.js retains compiled shader programs, framebuffers, and texture handles
// inside WebGLRenderer that setSize() does not free. Browsers also cap a tab
// at ~16 live WebGL contexts. We dispose the offscreen renderer after a short
// idle window so GPU memory is reclaimed between user actions; the lazy branch
// in getOffscreenRenderer re-creates it on the next render.
const OFFSCREEN_IDLE_DISPOSE_MS = 10_000;

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
  }, OFFSCREEN_IDLE_DISPOSE_MS);
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

/** Dispose scene contents (meshes, geometries, materials) to prevent WebGL memory leaks */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
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
  const wireMesh = new THREE.Mesh(geometry, createBlackWireframeMaterial());
  scene.add(solidMesh);
  scene.add(wireMesh);

  const box = new THREE.Box3().setFromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  const center = box.getCenter(new THREE.Vector3());
  const bsize = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(bsize.x, bsize.y, bsize.z);
  const d = maxDim * 1.4;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  const renderer = getOffscreenRenderer(viewSize);

  const annotations = buildStrokesGroup(new THREE.Vector2(viewSize, viewSize));
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
    disposeStrokesGroup(annotations);
  }
  disposeScene(scene);
  geometry.dispose();
  return compositeCanvas;
}

// === Attached images for elevation comparison ===

export interface AttachedImage {
  id: string;
  src: string;
  /** Optional user-facing caption. Drives ordering via preset matching. */
  label?: string;
}

let _images: AttachedImage[] = [];

export function setImages(images: AttachedImage[]): void {
  _images = images;
  window.dispatchEvent(new Event('images-changed'));
}

export function clearImages(): void {
  _images = [];
  window.dispatchEvent(new Event('images-changed'));
}

export function getImages(): AttachedImage[] {
  return _images;
}

/** Stable sort: preset-matching labels first in preset order, others keep
 *  their insertion order at the end. */
export function sortImagesByPreset(images: readonly AttachedImage[]): AttachedImage[] {
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

function createElevationScene(geometry: THREE.BufferGeometry, bgColor: number): THREE.Scene {
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
  // Wireframe overlay obscures vertex-color verification on dense
  // organic meshes — at 320px tile size, the 30% black edges of tens
  // of thousands of triangles compound into a dark mass that washes
  // out painted regions. Skip the wireframe when the mesh carries
  // per-triangle colors (the user is in a paint workflow and wants
  // to read colors, not topology). Keep it for uncolored renders
  // where topology IS the subject.
  if (!hasColors) {
    const wireMesh = new THREE.Mesh(geometry, createBlackWireframeMaterial());
    scene.add(wireMesh);
  }
  return scene;
}

/** Render a single view from any camera angle. Returns a data URL (PNG).
 *  For orthographic views, pass ortho: true.
 *  elevation/azimuth are in degrees: elevation 0 = horizon, 90 = top-down.
 *  azimuth 0 = front (-Y), 90 = right (+X), 180 = back (+Y), 270 = left (-X). */
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
}): THREE.Camera {
  const elevation = (options.elevation ?? 30) * Math.PI / 180;
  const azimuth = (options.azimuth ?? 315) * Math.PI / 180;

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
  const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const bsize = new THREE.Vector3(maxX - minX, maxY - minY, maxZ - minZ);
  const maxDim = Math.max(bsize.x, bsize.y, bsize.z);
  const dist = maxDim * 2;

  // Spherical to cartesian (Z-up)
  const cx = dist * Math.cos(elevation) * Math.sin(azimuth);
  const cy = dist * Math.cos(elevation) * (-Math.cos(azimuth));
  const cz = dist * Math.sin(elevation);

  let camera: THREE.Camera;
  if (options.ortho) {
    const halfExtent = maxDim * 0.7;
    const orthoCamera = new THREE.OrthographicCamera(-halfExtent, halfExtent, halfExtent, -halfExtent, 0.1, 1000);
    orthoCamera.position.set(center.x + cx, center.y + cy, center.z + cz);
    orthoCamera.up.set(0, 0, 1);
    orthoCamera.lookAt(center);
    orthoCamera.updateProjectionMatrix();
    camera = orthoCamera;
  } else {
    const perspCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    perspCamera.position.set(center.x + cx, center.y + cy, center.z + cz);
    perspCamera.up.set(0, 0, 1);
    perspCamera.lookAt(center);
    perspCamera.updateProjectionMatrix();
    camera = perspCamera;
  }
  return camera;
}

export function renderSingleView(meshData: MeshData, options: {
  elevation?: number;
  azimuth?: number;
  ortho?: boolean;
  size?: number;
} = {}): string {
  const viewSize = options.size ?? 500;

  const geometry = meshDataToGeometry(meshData);
  const scene = createElevationScene(geometry, 0xffffff);
  const camera = buildViewCamera(meshData, options);
  const renderer = getOffscreenRenderer(viewSize);

  const annotations = buildStrokesGroup(new THREE.Vector2(viewSize, viewSize));
  if (annotations) scene.add(annotations);

  renderer.render(scene, camera);

  const canvas = document.createElement('canvas');
  canvas.width = viewSize;
  canvas.height = viewSize;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(renderer.domElement, 0, 0);

  if (annotations) {
    scene.remove(annotations);
    disposeStrokesGroup(annotations);
  }
  disposeScene(scene);
  geometry.dispose();
  return canvas.toDataURL('image/png');
}

/** Render a cross-section at a given Z height as an SVG string */
export function renderSliceSVG(polygons: [number, number][][], boundingBox: { minX: number; maxX: number; minY: number; maxY: number }, size: number = 400): string {
  const { minX, maxX, minY, maxY } = boundingBox;
  const w = maxX - minX;
  const h = maxY - minY;
  const maxDim = Math.max(w, h);
  const padding = maxDim * 0.1;
  const vbX = minX - padding;
  const vbW = maxDim + padding * 2;
  const vbH = maxDim + padding * 2;

  let paths = '';
  for (const contour of polygons) {
    if (contour.length < 2) continue;
    // Flip Y for SVG (SVG Y goes down, our Y goes up)
    const d = contour.map((pt, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      return `${cmd}${pt[0].toFixed(2)},${(-pt[1]).toFixed(2)}`;
    }).join(' ') + ' Z';
    paths += `<path d="${d}" fill="#4a9eff" fill-opacity="0.3" stroke="#2563eb" stroke-width="${maxDim * 0.005}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vbX} ${-maxY - padding} ${vbW} ${vbH}" style="background:#1e1e2e">
    <rect x="${vbX}" y="${-maxY - padding}" width="${vbW}" height="${vbH}" fill="#1e1e2e"/>
    ${paths}
  </svg>`;
}
