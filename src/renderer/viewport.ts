import * as THREE from 'three';
import { Timer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { MeshData } from '../geometry/types';
import { createDefaultMaterial, createWireframeMaterial } from './materials';
import { initPhantomGroup } from './phantomGeometry';
import { initMeasureOverlay } from './measureOverlay';
import { initOrientationGizmo, renderGizmo, updateGizmo, disposeGizmo, isGizmoAnimating } from './orientationGizmo';
import { initDimensionLines, updateDimensionLines, disposeDimensionLines, setDimensionsVisible as setDimensionsVisibleImpl, isDimensionsVisible } from './dimensionLines';
import { initAnnotationOverlay, setLiveResolution as setAnnotationResolution } from '../annotations/annotationOverlay';
import { configureSessionPlane } from '../annotations/sessionPlane';
import { getTheme, onThemeChange, type Theme } from '../ui/theme';
import { getConfig } from '../config/appConfig';

const VIEWPORT_BG = { dark: 0x1a1a2e, light: 0xededed } as const;
const GRID_COLORS = { dark: { major: 0x444444, minor: 0x333333 }, light: { major: 0xb0b0b0, minor: 0xc8c8c8 } } as const;
function bgFor(theme: Theme): number { return VIEWPORT_BG[theme]; }

function makeGrid(theme: Theme): THREE.GridHelper {
  const c = GRID_COLORS[theme];
  const g = new THREE.GridHelper(40, 40, c.major, c.minor);
  g.rotation.x = Math.PI / 2;
  g.visible = false;
  return g;
}

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let controls: OrbitControls;
let meshGroup: THREE.Group;
let animationId: number;

// === WebGL context-loss recovery ===
// The GPU can drop the WebGL context (driver reset, tab backgrounded too long,
// OOM). Three.js auto-recompiles its programs on restore, so we must NOT
// recreate the renderer — we only pause the render loop while lost and resume
// it on restore. preventDefault() on the lost event is REQUIRED for the
// browser to fire 'restored' at all.
let contextLost = false;
let onContextLost: (() => void) | null = null;
let onContextRestored: (() => void) | null = null;

/** Hook fired when the WebGL context is lost (recoverable) and again when it
 *  is restored. Lets the host surface a toast without viewport importing the
 *  toast module (mirrors setOnMeshUpdate). */
export function setOnContextLost(fn: () => void): void { onContextLost = fn; }
export function setOnContextRestored(fn: () => void): void { onContextRestored = fn; }

// === On-demand rendering ===
// The render loop only paints a frame when something actually changed, instead
// of re-rendering an idle scene 60×/second. The `needsRender` flag (set by
// `requestRender()`) marks the next frame dirty; OrbitControls 'change' events,
// recent pointer activity over the canvas, and the gizmo's snap animation keep
// it painting through interactions and inertia. On a heavy model this is the
// difference between constant GPU churn and only working when the view moves.
let needsRender = true;
let lastPointerActivity = 0;
const POINTER_GRACE_MS = 350;

// === Adaptive resolution ===
// Full (capped) device pixel ratio when the camera is still; a reduced ratio
// while actively orbiting/panning/zooming, where the lower fragment count keeps
// interaction smooth on dense meshes and the softer image is invisible mid-
// motion. Restored to full res the instant interaction ends.
let interacting = false;
let cssWidth = 0;
let cssHeight = 0;
function baseDpr(): number {
  return Math.min(window.devicePixelRatio || 1, getConfig().renderer.maxPixelRatio);
}
function applyRenderScale(scale: number): void {
  if (!renderer) return;
  renderer.setPixelRatio(baseDpr() * scale);
  if (cssWidth > 0 && cssHeight > 0) renderer.setSize(cssWidth, cssHeight, false);
}

/** Mark the viewport dirty so the next animation frame renders. Call after any
 *  scene change not already driven by camera motion — geometry swaps, clipping,
 *  overlays, theme, paint highlights. Cheap and idempotent (just sets a flag). */
export function requestRender(): void {
  needsRender = true;
}

// Orbit lock state — when locked, rotate/pan are disabled but zoom always works,
// so wheel/two-finger-scroll keeps zooming the camera in every mode.
let measureLock = false;
let userLock = false;
let gizmoLock = false;

// Pointer suppressors — capture-phase pointerdown veto for OrbitControls.
// Lets paint mode let orbit handle clicks that miss the model while keeping
// model-hit clicks for painting.
type PointerSuppressor = (event: PointerEvent) => boolean;
const pointerSuppressors: PointerSuppressor[] = [];

const raycasterForHit = new THREE.Raycaster();
const ndcForHit = new THREE.Vector2();

// Grid plane
let grid: THREE.GridHelper;

// Mesh edge (wireframe) overlay visibility. Hidden by default so the model
// reads cleanly; paint mode forces it on (see paintMode.ts) and the viewport
// toggle button lets the user override either way.
let wireframeVisible = false;
let wireframeChangeListener: ((visible: boolean) => void) | null = null;

// Clipping plane state
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); // clips above Z
let clippingEnabled = false;
let clipZ = 0;
let modelBounds: { min: number; max: number } = { min: 0, max: 10 };

// Back-face cap material — shows the cut face in a different color. Used as a
// TEMPLATE only: each cap mesh gets its own clone (capMaterial.clone()) so that
// updateMesh's disposal loop, which disposes every child mesh's material, frees
// the per-cap clone and never this shared singleton (disposing it would leave
// the next cap rendering with a dead material).
const capMaterial = new THREE.MeshPhongMaterial({
  color: 0xff6b6b,
  shininess: 20,
  side: THREE.BackSide,
  clippingPlanes: [clipPlane],
});

// Clip plane visualization — translucent disc at the cut height
let clipPlaneHelper: THREE.Mesh | null = null;

export function initViewport(container: HTMLElement): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
} {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(bgFor(getTheme()));

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(15, 15, 15);
  camera.up.set(0, 0, 1);

  const canvas = document.createElement('canvas');
  canvas.classList.add('viewport-canvas');
  canvas.id = 'viewport';
  container.appendChild(canvas);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(baseDpr());
  renderer.localClippingEnabled = true;

  // WebGL context-loss recovery. preventDefault() on 'lost' is what lets the
  // browser restore the context; while lost we cancel the RAF loop so we don't
  // spin calling render() on a dead context. On 'restored' three has already
  // recompiled its GLSL, so we just resume the loop and force a repaint.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    if (animationId !== undefined) cancelAnimationFrame(animationId);
    onContextLost?.();
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    needsRender = true;
    onContextRestored?.();
    // Restart the render loop (it was cancelled on loss).
    animate();
  }, false);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.target.set(0, 0, 0);

  // On-demand rendering hooks: 'change' fires on every camera move (including
  // each damping/inertia step), so the loop keeps painting until motion settles.
  // 'start'/'end' bracket an active drag/zoom for the adaptive-resolution drop.
  controls.addEventListener('change', () => { needsRender = true; });
  controls.addEventListener('start', () => {
    interacting = true;
    applyRenderScale(getConfig().renderer.interactionRenderScale);
    needsRender = true;
  });
  controls.addEventListener('end', () => {
    interacting = false;
    applyRenderScale(1);
    needsRender = true;
  });

  // Any pointer activity anywhere in the viewport region may drive a scene
  // change that isn't a camera move (paint hover/drag, measure, gizmo hover,
  // annotation drawing, and clicks on the overlay controls that sit over the
  // canvas), so keep painting for a short grace window around it. Bound to the
  // container (not just the canvas) so overlay-button clicks count too. Passive
  // + capture: purely observational, never interferes with the real handlers.
  const markPointerActivity = () => {
    lastPointerActivity = performance.now();
    needsRender = true;
  };
  for (const evt of ['pointerdown', 'pointermove', 'pointerup', 'wheel'] as const) {
    container.addEventListener(evt, markPointerActivity, { capture: true, passive: true });
  }

  // Capture-phase pointerdown gives paint tools the chance to veto OrbitControls'
  // pointerdown per-event (e.g. let orbit handle clicks that miss the model).
  canvas.addEventListener('pointerdown', (event) => {
    for (const fn of pointerSuppressors) {
      if (fn(event)) {
        event.stopImmediatePropagation();
        return;
      }
    }
  }, { capture: true });

  // Capture-phase wheel forwarder — re-dispatches wheel events that land on
  // viewport overlays (paint picker panel, toolbar buttons, ...) onto the
  // canvas so OrbitControls' zoom keeps working regardless of cursor location.
  // Scrollable descendants still consume the wheel.
  container.addEventListener('wheel', (event) => {
    if (event.target === canvas) return; // OrbitControls owns canvas wheels
    let el: HTMLElement | null = event.target as HTMLElement;
    while (el && el !== container) {
      if (isVerticallyScrollable(el)) return;
      el = el.parentElement;
    }
    event.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      bubbles: true,
      cancelable: true,
    }));
  }, { capture: true, passive: false });

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dir1.position.set(10, -10, 15);
  scene.add(dir1);

  const dir2 = new THREE.DirectionalLight(0xffffff, 0.3);
  dir2.position.set(-10, 10, -5);
  scene.add(dir2);

  // Grid on XY plane (hidden by default)
  grid = makeGrid(getTheme());
  scene.add(grid);

  // Re-tint scene + grid when theme flips
  onThemeChange((theme) => {
    (scene.background as THREE.Color).set(bgFor(theme));
    const wasVisible = grid.visible;
    scene.remove(grid);
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    grid = makeGrid(theme);
    grid.visible = wasVisible;
    scene.add(grid);
    needsRender = true;
  });

  meshGroup = new THREE.Group();
  scene.add(meshGroup);

  // Phantom geometry group (for reference/fitment overlays)
  initPhantomGroup(scene);

  // Measure overlay group
  initMeasureOverlay(scene, camera, renderer);

  // Orientation gizmo (XYZ axes indicator)
  initOrientationGizmo(camera, canvas, controls);

  // Bounding box dimension annotations
  initDimensionLines(scene);

  // Freehand annotation overlay (drawn surface marks)
  initAnnotationOverlay(scene);
  configureSessionPlane(controls);

  // ResizeObserver
  const observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    if (width === 0 || height === 0) return;
    cssWidth = width;
    cssHeight = height;
    applyRenderScale(interacting ? getConfig().renderer.interactionRenderScale : 1);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    setAnnotationResolution(width * window.devicePixelRatio, height * window.devicePixelRatio);
    needsRender = true;
  });
  observer.observe(container);

  // Initialize annotation resolution to current canvas size so the first
  // strokes drawn before any resize event fire still get correct widths.
  setAnnotationResolution(
    canvas.width || container.clientWidth * window.devicePixelRatio,
    canvas.height || container.clientHeight * window.devicePixelRatio,
  );

  // Animate
  const timer = new Timer();
  function animate(timestamp?: number) {
    // While the GL context is lost, stop the loop entirely — the 'restored'
    // handler restarts it. (Guard in addition to the cancelAnimationFrame in
    // the lost handler in case a queued frame fires before that runs.)
    if (contextLost) return;
    animationId = requestAnimationFrame(animate);
    timer.update(timestamp);
    const delta = timer.getDelta();
    updateGizmo(delta);
    syncOrbitState();
    // controls.update() applies damping and synchronously fires 'change' (which
    // sets needsRender) whenever the camera actually moves, so inertia keeps the
    // loop painting until it settles.
    controls.update();
    const pointerActive = performance.now() - lastPointerActivity < POINTER_GRACE_MS;
    if (needsRender || pointerActive || isGizmoAnimating()) {
      renderer.render(scene, camera);
      renderGizmo(renderer);
      needsRender = false;
    }
  }
  animate();

  return { scene, camera, renderer };
}

/** Fired after every mesh update with the displayed mesh, so the host can keep
 *  a live readout (e.g. triangle count) in sync without hooking every call site. */
let onMeshUpdate: ((mesh: MeshData) => void) | null = null;
export function setOnMeshUpdate(fn: (mesh: MeshData) => void): void {
  onMeshUpdate = fn;
}

export function updateMesh(meshData: MeshData, options?: { skipAutoFrame?: boolean }): void {
  // Clear previous
  while (meshGroup.children.length > 0) {
    const child = meshGroup.children[0];
    meshGroup.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mat = child.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else if (mat) mat.dispose();
    }
  }

  const geometry = meshGLToBufferGeometry(meshData);
  const hasColors = geometry.hasAttribute('color');

  const solidMat = createDefaultMaterial(hasColors);
  const wireMat = createWireframeMaterial();

  // Apply clipping planes to materials
  if (clippingEnabled) {
    solidMat.clippingPlanes = [clipPlane];
    wireMat.clippingPlanes = [clipPlane];
  }

  const solidMesh = new THREE.Mesh(geometry, solidMat);
  const wireMesh = new THREE.Mesh(geometry, wireMat);
  wireMesh.name = 'wireframe';
  wireMesh.visible = wireframeVisible;

  meshGroup.add(solidMesh);
  meshGroup.add(wireMesh);

  // Back-face cap mesh (shows cut face when clipping)
  if (clippingEnabled) {
    const capGeometry = geometry.clone();
    const capMesh = new THREE.Mesh(capGeometry, capMaterial.clone());
    capMesh.name = 'clip-cap';
    meshGroup.add(capMesh);
  }

  // Auto-frame the camera (skip when only colors changed)
  const box = new THREE.Box3().setFromObject(meshGroup);

  if (!options?.skipAutoFrame) {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Update model bounds for clip slider
    modelBounds = { min: box.min.z, max: box.max.z };

    // Position grid at the bottom of the model
    grid.position.z = box.min.z;

    // Update bounding box dimension annotations
    updateDimensionLines(box);

    controls.target.copy(center);
    camera.position.set(
      center.x + maxDim * 1.2,
      center.y - maxDim * 1.2,
      center.z + maxDim * 1.2,
    );
    // Adapt the clip planes to the model size. With a fixed far plane a large
    // model (e.g. scaled to ~890mm) auto-frames the camera far enough away that
    // the geometry falls beyond the frustum and disappears; a fixed near plane
    // would z-fight on tiny models. Scale both with the model's largest dim.
    if (maxDim > 0) {
      camera.near = Math.max(0.05, maxDim * 0.005);
      camera.far = Math.max(1000, maxDim * 50);
      camera.updateProjectionMatrix();
    }
    controls.update();

    // Update clip plane position if clipping
    if (clippingEnabled) {
      updateClipPlaneVisual();
    }
  }

  needsRender = true;
  onMeshUpdate?.(meshData);
}

// === Clipping API ===

export function setClipping(enabled: boolean): void {
  clippingEnabled = enabled;

  meshGroup.children.forEach(child => {
    if (child instanceof THREE.Mesh) {
      if (child.name === 'clip-cap') {
        child.visible = enabled;
        return;
      }
      const mat = child.material as THREE.Material;
      if (mat) {
        (mat as THREE.MeshPhongMaterial | THREE.MeshBasicMaterial).clippingPlanes = enabled ? [clipPlane] : [];
        mat.needsUpdate = true;
      }
    }
  });

  if (enabled) {
    // Default to 75% height on first enable
    if (clipZ === 0) {
      clipZ = modelBounds.min + (modelBounds.max - modelBounds.min) * 0.75;
    }
    clipPlane.constant = clipZ;

    // Add cap mesh if not present
    const hasCap = meshGroup.children.some(c => c.name === 'clip-cap');
    if (!hasCap) {
      const solidChild = meshGroup.children[0];
      if (solidChild instanceof THREE.Mesh) {
        const capGeometry = solidChild.geometry.clone();
        const capMesh = new THREE.Mesh(capGeometry, capMaterial.clone());
        capMesh.name = 'clip-cap';
        meshGroup.add(capMesh);
      }
    }

    updateClipPlaneVisual();
  } else {
    removeClipPlaneVisual();
  }
  needsRender = true;
}

export function setClipZ(z: number): void {
  clipZ = z;
  clipPlane.constant = z;
  updateClipPlaneVisual();
  needsRender = true;
}

export function getClipState(): { enabled: boolean; z: number; min: number; max: number } {
  return { enabled: clippingEnabled, z: clipZ, min: modelBounds.min, max: modelBounds.max };
}

function updateClipPlaneVisual() {
  removeClipPlaneVisual();
  needsRender = true;

  if (!clippingEnabled) return;

  // Create a translucent disc at the clip height
  const range = Math.max(modelBounds.max - modelBounds.min, 1);
  const radius = range * 1.5;
  const planeGeo = new THREE.CircleGeometry(radius, 64);
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0xff6b6b,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  clipPlaneHelper = new THREE.Mesh(planeGeo, planeMat);
  clipPlaneHelper.name = 'clip-plane-helper';
  const box = new THREE.Box3().setFromObject(meshGroup);
  const center = box.getCenter(new THREE.Vector3());
  clipPlaneHelper.position.set(center.x, center.y, clipZ);
  // The disc lies in XY plane by default, which is what we want for Z-clipping
  scene.add(clipPlaneHelper);
}

function removeClipPlaneVisual() {
  if (clipPlaneHelper) {
    scene.remove(clipPlaneHelper);
    clipPlaneHelper.geometry.dispose();
    (clipPlaneHelper.material as THREE.Material).dispose();
    clipPlaneHelper = null;
  }
}

function meshGLToBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  if (mesh.triColors) {
    // With per-triangle colors, we must unindex (duplicate vertices per triangle)
    // so each triangle's 3 vertices can carry that triangle's color.
    const numTri = mesh.numTri;
    const positions = new Float32Array(numTri * 3 * 3);
    const colors = new Float32Array(numTri * 3 * 3);
    const { vertProperties, triVerts, numProp, triColors } = mesh;

    for (let t = 0; t < numTri; t++) {
      const v0 = triVerts[t * 3];
      const v1 = triVerts[t * 3 + 1];
      const v2 = triVerts[t * 3 + 2];

      // Positions
      for (let c = 0; c < 3; c++) {
        positions[t * 9 + c] = vertProperties[v0 * numProp + c];
        positions[t * 9 + 3 + c] = vertProperties[v1 * numProp + c];
        positions[t * 9 + 6 + c] = vertProperties[v2 * numProp + c];
      }

      // Colors (same for all 3 vertices of the triangle)
      const r = triColors[t * 3] / 255;
      const g = triColors[t * 3 + 1] / 255;
      const b = triColors[t * 3 + 2] / 255;

      // Check if this triangle is painted (has a color region)
      const painted = (triColors as Uint8Array & { _painted?: Uint8Array })._painted;
      const isPainted = painted ? painted[t] === 1 : (r !== 0 || g !== 0 || b !== 0);

      // Unpainted triangles get the default blue (#4a9eff)
      const cr = isPainted ? r : 0x4a / 255;
      const cg = isPainted ? g : 0x9e / 255;
      const cb = isPainted ? b : 0xff / 255;

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
    // No colors — use indexed geometry (original path)
    const positions = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++) {
      positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
      positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
      positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
    geometry.computeVertexNormals();
  }

  return geometry;
}

export function getScene(): THREE.Scene {
  return scene;
}

/** Run `fn` (typically a GLB export pass that serializes `getScene()`) with the
 *  display mesh's geometry temporarily swapped to one carrying `coloredMesh`'s
 *  fully-baked triangle colors, then restore the original geometry no matter how
 *  `fn` settles.
 *
 *  GLB export reads the live scene, whose colors come from the viewport's
 *  visibility-aware coloring (paint toggle off → no colors; a hidden region →
 *  skipped). Exports must bake ALL regions regardless of those UI flags, matching
 *  OBJ/3MF. Callers pass `applyTriColors(currentMeshData)` so the swapped geometry
 *  is the unindexed, per-triangle-colored layout the exporter should serialize.
 *  When the mesh has no color regions, `applyTriColors` returns it unchanged and
 *  the swapped geometry is the same uncolored layout as the display — so the
 *  no-paint case is unaffected. */
export async function withExportColors<T>(coloredMesh: MeshData, fn: () => Promise<T>): Promise<T> {
  // The solid + wireframe meshes share one geometry object (see updateMesh); the
  // clip-cap holds a clone. Swap every meshGroup child that references the solid
  // geometry to the colored one, then restore on the way out.
  const solid = meshGroup.children.find(
    (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name !== 'wireframe' && c.name !== 'clip-cap',
  );
  if (!solid) return fn();

  const original = solid.geometry as THREE.BufferGeometry;
  const exportGeometry = meshGLToBufferGeometry(coloredMesh);
  const swapped: THREE.Mesh[] = [];
  for (const child of meshGroup.children) {
    if (child instanceof THREE.Mesh && child.geometry === original) {
      child.geometry = exportGeometry;
      swapped.push(child);
    }
  }
  try {
    return await fn();
  } finally {
    for (const child of swapped) child.geometry = original;
    exportGeometry.dispose();
  }
}

export function getCamera(): THREE.PerspectiveCamera {
  return camera;
}

export function getRenderer(): THREE.WebGLRenderer {
  return renderer;
}

export function getCameraState(): { azimuth: number; elevation: number; distance: number; target: [number, number, number] } {
  const dir = camera.position.clone().sub(controls.target);
  const distance = Math.round(dir.length() * 100) / 100;
  const elevation = Math.round(Math.asin(dir.z / dir.length()) * 180 / Math.PI * 100) / 100;
  const azimuth = Math.round((((Math.atan2(dir.x, -dir.y) * 180 / Math.PI) % 360) + 360) % 360 * 100) / 100;
  return {
    azimuth,
    elevation,
    distance,
    target: [
      Math.round(controls.target.x * 100) / 100,
      Math.round(controls.target.y * 100) / 100,
      Math.round(controls.target.z * 100) / 100,
    ],
  };
}

export function getCanvas(): HTMLCanvasElement {
  return renderer.domElement;
}

export function getMeshGroup(): THREE.Group {
  return meshGroup;
}

// === Orbit lock API ===

// Locks gate rotate + pan; zoom is intentionally always enabled so
// wheel / two-finger-scroll zooms the camera in every mode.
function syncOrbitState(): void {
  const animating = isGizmoAnimating();
  const rotatePanLocked = animating || measureLock || userLock || gizmoLock;
  controls.enabled = !animating;
  controls.enableRotate = !rotatePanLocked;
  controls.enablePan = !rotatePanLocked;
  controls.enableZoom = !animating;
}

export function setMeasureLock(locked: boolean): void {
  measureLock = locked;
  syncOrbitState();
}

const userOrbitLockListeners: Array<(locked: boolean) => void> = [];

export function setUserOrbitLock(locked: boolean): void {
  if (userLock === locked) return;
  userLock = locked;
  syncOrbitState();
  for (const fn of userOrbitLockListeners) fn(locked);
}

export function isUserOrbitLocked(): boolean {
  return userLock;
}

export function onUserOrbitLockChange(fn: (locked: boolean) => void): () => void {
  userOrbitLockListeners.push(fn);
  return () => {
    const i = userOrbitLockListeners.indexOf(fn);
    if (i >= 0) userOrbitLockListeners.splice(i, 1);
  };
}

/** Transient lock raised by TransformControls (paint Box gizmo) while a handle
 *  is being hovered or dragged so OrbitControls doesn't rotate at the same time. */
export function setGizmoLock(locked: boolean): void {
  if (gizmoLock === locked) return;
  gizmoLock = locked;
  syncOrbitState();
}

/** Register a capture-phase pointerdown veto. Returning true stops the event
 *  from reaching OrbitControls so the caller can own the drag. */
export function addPointerSuppressor(fn: PointerSuppressor): () => void {
  pointerSuppressors.push(fn);
  return () => {
    const i = pointerSuppressors.indexOf(fn);
    if (i >= 0) pointerSuppressors.splice(i, 1);
  };
}

/** Raycast the visible model (first child of the mesh group) and report
 *  whether the screen-space pointer lands on a triangle. */
export function isPointerOverModel(event: { clientX: number; clientY: number }): boolean {
  if (!meshGroup || meshGroup.children.length === 0) return false;
  const solid = meshGroup.children[0];
  if (!(solid instanceof THREE.Mesh)) return false;
  const rect = renderer.domElement.getBoundingClientRect();
  ndcForHit.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  ndcForHit.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycasterForHit.setFromCamera(ndcForHit, camera);
  return raycasterForHit.intersectObject(solid).length > 0;
}

function isVerticallyScrollable(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  const overflowY = style.overflowY;
  return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
}

export function setDimensionsVisible(visible: boolean): void {
  setDimensionsVisibleImpl(visible);
  needsRender = true;
}
export { isDimensionsVisible };

// === Grid visibility API ===

export function setGridVisible(visible: boolean): void {
  grid.visible = visible;
  needsRender = true;
}

export function isGridVisible(): boolean {
  return grid.visible;
}

// === Wireframe (mesh edge) visibility API ===

export function setWireframeVisible(visible: boolean): void {
  if (wireframeVisible === visible) return;
  wireframeVisible = visible;
  meshGroup.children.forEach(child => {
    if (child.name === 'wireframe') child.visible = visible;
  });
  needsRender = true;
  wireframeChangeListener?.(visible);
}

export function isWireframeVisible(): boolean {
  return wireframeVisible;
}

/** Subscribe to wireframe visibility changes so UI (the toggle button) stays
 *  in sync whether the change came from the button or from paint mode. */
export function onWireframeChange(cb: (visible: boolean) => void): void {
  wireframeChangeListener = cb;
}

export function dispose(): void {
  cancelAnimationFrame(animationId);
  disposeGizmo();
  disposeDimensionLines();
  controls.dispose();
  renderer.dispose();
}
