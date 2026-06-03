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
