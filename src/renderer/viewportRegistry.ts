// Leaf registry that lets feature subsystems hook into the viewport's lifecycle
// without the viewport importing them.
//
// The renderer is a low layer; the annotation overlay, session plane, and
// phantom-geometry group are feature layers above it. Previously viewport.ts
// imported those modules to call their init functions, while they imported
// viewport for `requestRender` / camera accessors — a circular dependency and a
// layering inversion. Now subsystems *register* init/resize hooks here (wired in
// viewportSubsystems.ts), and viewport.ts just runs them, so it no longer
// depends on the feature layer.

import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface ViewportContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
}

type InitHook = (ctx: ViewportContext) => void;
type ResizeHook = (widthPx: number, heightPx: number) => void;

const initHooks: InitHook[] = [];
const resizeHooks: ResizeHook[] = [];

/** Register a hook run once when the viewport finishes initialising. */
export function onViewportInit(hook: InitHook): void {
  initHooks.push(hook);
}

/** Register a hook run on every viewport resize (and once at init), with the
 *  drawing-buffer dimensions in device pixels. */
export function onViewportResize(hook: ResizeHook): void {
  resizeHooks.push(hook);
}

/** Called by viewport.ts once the scene/camera/renderer/controls exist. */
export function runViewportInitHooks(ctx: ViewportContext): void {
  for (const hook of initHooks) hook(ctx);
}

/** Called by viewport.ts on init and on every resize. */
export function runViewportResizeHooks(widthPx: number, heightPx: number): void {
  for (const hook of resizeHooks) hook(widthPx, heightPx);
}

// ── Offscreen overlay provider ───────────────────────────────────────────────
// The multi-view thumbnail renderer (multiview.ts) lives in the renderer layer
// but needs the annotation-overlay group to composite marks into its offscreen
// snapshots. The renderer must not import the annotations feature layer, so the
// annotation layer registers a builder here (via viewportSubsystems.ts) and
// multiview pulls the group through this leaf — keeping the dependency
// one-directional, the same inversion used for the init/resize hooks above.

export interface OffscreenOverlayProvider {
  /** Build the overlay group for a square offscreen view of `viewSizePx`
   *  device pixels, or null when there's nothing to draw. */
  build: (viewSizePx: number) => THREE.Group | null;
  dispose: (group: THREE.Group) => void;
}

let offscreenOverlayProvider: OffscreenOverlayProvider | null = null;

export function registerOffscreenOverlayProvider(provider: OffscreenOverlayProvider): void {
  offscreenOverlayProvider = provider;
}

/** Build the annotation overlay group for an offscreen scene, or null when no
 *  provider is registered (e.g. before subsystems wire up) or there's nothing
 *  to draw. Callers must pass the result to {@link disposeOffscreenOverlay}. */
export function buildOffscreenOverlay(viewSizePx: number): THREE.Group | null {
  return offscreenOverlayProvider?.build(viewSizePx) ?? null;
}

export function disposeOffscreenOverlay(group: THREE.Group): void {
  offscreenOverlayProvider?.dispose(group);
}
