// Tinkercad-style Arrange mode for the insert palette.
//
// A persistent viewport tool (like Paint): toggle on → the real, merged model
// stays on screen with its real colours and real booleans, but pointer events
// switch from orbit-the-camera to grab-and-move-shapes. The user can:
//   - click a shape to select it (shift-click to add/remove from a multi-select),
//   - drag a selected shape to slide it around (a translucent ghost previews the
//     new position; on release the code is rewritten and the engine re-runs so
//     the real union/intersect/subtract updates),
//   - resize the selection per-axis (X/Y/Z scale inputs in the palette),
//   - align 2+ selected to min / center / max along any axis,
//   - Group / Subtract / Intersect / Duplicate / Mirror / Delete the selection
//     (those reuse the palette's existing selection-driven actions).
//
// This module owns the canvas pointer listener, the selection-box overlay, and
// the drag-ghost previews. It does NOT own the selection Set itself — that's
// the insert palette's Set so all the existing selection-driven actions
// (Operations, Edit selection, Mirror picker) keep working unchanged. The
// palette gives us read/write access through `deps.selection`.

import * as THREE from 'three';
import { getScene, setGizmoLock, requestRender } from '../renderer/viewport';
import { primitiveEntry, pickPart, type RegistryEntry } from './spatial';
import { type PrimitiveSpec, type Vec3, type InsertLanguage } from './codegen';
import { alignDeltas, formatScaleCall, type AlignAxis, type AlignMode } from './arrangeMath';

// Re-export the pure helpers so callers can pick them up from one entry point.
export { alignDeltas, formatScaleCall };
export type { AlignAxis, AlignMode };

export interface ScannedPart {
  name: string;
  range?: { from: number; to: number };
  statement?: string;
}

export interface ArrangeModeDeps {
  /** Live viewport handles. Callers re-evaluate each enter (camera/canvas can
   *  change across session reload). */
  getCanvas: () => HTMLCanvasElement | null;
  getCamera: () => THREE.Camera | null;
  getMeshGroup: () => THREE.Group;
  /** The merged-model object root we raycast for click-select. */
  getCb: () => {
    getLanguage(): InsertLanguage;
    getCode(): string;
    setCode(code: string): void;
    run(): void;
    showToast(msg: string, opts?: { variant?: 'neutral' | 'warn' | 'success' }): void;
  } | null;
  /** Spatial registry (part-name → bbox/center) — populated by the palette as
   *  primitives are emitted. Shared map, not a snapshot: we read on demand. */
  registry: Map<string, RegistryEntry>;
  /** Full primitive spec by name (for building drag-ghost geometry). */
  specByName: Map<string, PrimitiveSpec>;
  /** The palette's selection Set — we mutate it directly so the panel's chip
   *  strip + selection-driven action buttons re-paint via `onSelectionChanged`. */
  selection: Set<string>;
  /** Called after any change to `selection` so the panel rerenders. */
  onSelectionChanged: () => void;
  /** Code-side `// part: <name>` scanner (already implemented for each engine
   *  in the palette). We use it to look up a part's statement range for
   *  voxel/scad writeback during drag. */
  scanParts: (code: string, lang: InsertLanguage) => ScannedPart[];
  /** Write the position delta for a named part back into the code (per-engine
   *  translate or voxel re-emit). Owned by the palette to keep its `cb` closure
   *  intact; we just call it. Returns true on commit. */
  writebackMoveDelta: (name: string, delta: Vec3) => boolean;
  /** Bump the in-memory registry bbox for a moved part (so the bounding-box
   *  outline tracks the new position without waiting for a re-run). */
  shiftRegistryEntry: (name: string, delta: Vec3) => void;
}

let deps: ArrangeModeDeps | null = null;
let active = false;

// Overlay group lives under the scene; carries selection wireframes + drag
// ghosts. Re-created on enter so it always sits above the live mesh group.
let overlayGroup: THREE.Group | null = null;
const boxByName = new Map<string, THREE.LineSegments>();
const ghostByName = new Map<string, THREE.Mesh>();

// Pointer/drag bookkeeping. `pendingPart` is the part the pointer landed on
// before we know whether it's a click (select) or a drag (move). The drag
// threshold (px) keeps a stray jitter from churning the editor.
let pendingPart: string | null = null;
let pointerStart: { x: number; y: number; world: THREE.Vector3 } | null = null;
let dragNames: string[] = [];
let dragBaseline = new Map<string, Vec3>(); // pre-drag centres for each ghost
const DRAG_THRESHOLD_PX = 4;
let dragging = false;

export function initArrangeMode(d: ArrangeModeDeps): void {
  deps = d;
}

export function isArrangeActive(): boolean {
  return active;
}

export function enterArrangeMode(): void {
  if (!deps || active) return;
  const canvas = deps.getCanvas();
  if (!canvas) {
    deps.getCb()?.showToast('Open a model first to enter Arrange mode.', { variant: 'warn' });
    return;
  }
  active = true;
  overlayGroup = new THREE.Group();
  overlayGroup.renderOrder = 999;
  getScene().add(overlayGroup);

  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  canvas.addEventListener('pointermove', onPointerMove, { capture: true });
  canvas.addEventListener('pointerup', onPointerUp, { capture: true });
  canvas.addEventListener('pointercancel', onPointerCancel, { capture: true });
  document.addEventListener('keydown', onKey);

  refreshArrangeOverlay();
  deps.getCb()?.showToast(
    'Arrange on — click to select • shift-click to add • drag to move • Esc to exit.',
    { variant: 'neutral' },
  );
  requestRender();
}

export function exitArrangeMode(): void {
  if (!deps || !active) return;
  active = false;
  const canvas = deps.getCanvas();
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown, { capture: true });
    canvas.removeEventListener('pointermove', onPointerMove, { capture: true });
    canvas.removeEventListener('pointerup', onPointerUp, { capture: true });
    canvas.removeEventListener('pointercancel', onPointerCancel, { capture: true });
  }
  document.removeEventListener('keydown', onKey);

  cancelDrag();
  if (overlayGroup) {
    overlayGroup.parent?.remove(overlayGroup);
    disposeOverlayGroup(overlayGroup);
    overlayGroup = null;
  }
  boxByName.clear();
  ghostByName.clear();
  setGizmoLock(false);
  requestRender();
}

/** Repaint the selection wireframes for the current `deps.selection`. Idempotent:
 *  drops boxes for parts no longer selected (or vanished from the registry) and
 *  adds new ones. Called on enter, on every selection change from the palette,
 *  and after a code re-run (so registry-shift updates show). */
export function refreshArrangeOverlay(): void {
  if (!active || !overlayGroup || !deps) return;

  for (const [name, box] of [...boxByName]) {
    if (!deps.selection.has(name) || !deps.registry.has(name)) {
      overlayGroup.remove(box);
      disposeLines(box);
      boxByName.delete(name);
    }
  }
  for (const name of deps.selection) {
    if (boxByName.has(name)) continue;
    const entry = deps.registry.get(name);
    if (!entry) continue;
    const box = makeBoundingBox(entry);
    overlayGroup.add(box);
    boxByName.set(name, box);
  }
  for (const [name, box] of boxByName) {
    const entry = deps.registry.get(name);
    if (entry) syncBoxToEntry(box, entry);
  }
  requestRender();
}

function makeBoundingBox(entry: RegistryEntry): THREE.LineSegments {
  const dx = Math.max(entry.box.max[0] - entry.box.min[0], 0.001);
  const dy = Math.max(entry.box.max[1] - entry.box.min[1], 0.001);
  const dz = Math.max(entry.box.max[2] - entry.box.min[2], 0.001);
  const boxGeo = new THREE.BoxGeometry(dx, dy, dz);
  const edges = new THREE.EdgesGeometry(boxGeo);
  boxGeo.dispose();
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(edges, mat);
  lines.renderOrder = 1000;
  syncBoxToEntry(lines, entry);
  return lines;
}

function syncBoxToEntry(lines: THREE.LineSegments, entry: RegistryEntry): void {
  lines.position.set(entry.center[0], entry.center[1], entry.center[2]);
  const dx = Math.max(entry.box.max[0] - entry.box.min[0], 0.001);
  const dy = Math.max(entry.box.max[1] - entry.box.min[1], 0.001);
  const dz = Math.max(entry.box.max[2] - entry.box.min[2], 0.001);
  lines.scale.set(dx / lines.userData.dx || 1, dy / lines.userData.dy || 1, dz / lines.userData.dz || 1);
  // Cache the base extents in userData so a later sync can scale relative to
  // the originally-baked geometry (we don't rebuild the EdgesGeometry on every
  // drag step).
  if (!lines.userData.dx) {
    lines.userData.dx = dx;
    lines.userData.dy = dy;
    lines.userData.dz = dz;
    lines.scale.set(1, 1, 1);
  }
}

// ---------------------------------------------------------------------------
// Pointer flow: click-to-select, threshold-then-drag, commit on release
// ---------------------------------------------------------------------------

function onPointerDown(e: PointerEvent): void {
  if (!active || !deps || e.button !== 0) return;
  const canvas = deps.getCanvas();
  const camera = deps.getCamera();
  if (!canvas || !camera) return;

  const hit = pickHit(e.clientX, e.clientY, camera, canvas);
  if (!hit) {
    // Empty-space click: clear the selection (matches Tinkercad's deselect-on-blank)
    // but let orbit pan still happen — don't capture the pointer.
    if (deps.selection.size > 0) {
      deps.selection.clear();
      deps.onSelectionChanged();
      refreshArrangeOverlay();
    }
    return;
  }

  // Hit on a part: capture the pointer + suppress orbit (we own this gesture).
  pendingPart = hit.name;
  pointerStart = { x: e.clientX, y: e.clientY, world: hit.point.clone() };
  e.stopPropagation();
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  setGizmoLock(true);
}

function onPointerMove(e: PointerEvent): void {
  if (!active || !deps || !pendingPart || !pointerStart) return;
  const canvas = deps.getCanvas();
  const camera = deps.getCamera();
  if (!canvas || !camera) return;

  if (!dragging) {
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    // Threshold crossed → upgrade to a drag. If the pending part isn't already
    // selected, make it the selection (Tinkercad-style: drag selects + drags).
    if (!deps.selection.has(pendingPart)) {
      if (!e.shiftKey) deps.selection.clear();
      deps.selection.add(pendingPart);
      deps.onSelectionChanged();
      refreshArrangeOverlay();
    }
    beginDrag();
  }

  if (dragging) {
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -pointerStart.world.z);
    const hit = projectToPlane(e.clientX, e.clientY, camera, canvas, plane);
    if (!hit) return;
    const delta: Vec3 = [hit.x - pointerStart.world.x, hit.y - pointerStart.world.y, 0];
    applyGhostDelta(delta);
    requestRender();
    e.stopPropagation();
    e.preventDefault();
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!active || !deps) return;
  const canvas = deps.getCanvas();
  if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  setGizmoLock(false);

  if (dragging) {
    e.stopPropagation();
    e.preventDefault();
    commitDrag();
  } else if (pendingPart) {
    // Below-threshold = click → select. Shift extends; bare click replaces.
    e.stopPropagation();
    e.preventDefault();
    if (e.shiftKey) {
      if (deps.selection.has(pendingPart)) deps.selection.delete(pendingPart);
      else deps.selection.add(pendingPart);
    } else {
      deps.selection.clear();
      deps.selection.add(pendingPart);
    }
    deps.onSelectionChanged();
    refreshArrangeOverlay();
  }
  pendingPart = null;
  pointerStart = null;
  dragging = false;
}

function onPointerCancel(_e: PointerEvent): void { cancelDrag(); }

function onKey(e: KeyboardEvent): void {
  if (!active) return;
  if (e.key === 'Escape') {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (dragging) { cancelDrag(); return; }
    if (deps && deps.selection.size > 0) {
      deps.selection.clear();
      deps.onSelectionChanged();
      refreshArrangeOverlay();
      return;
    }
    exitArrangeMode();
  }
}

function beginDrag(): void {
  if (!deps || !overlayGroup) return;
  dragging = true;
  dragNames = [...deps.selection];
  dragBaseline.clear();
  for (const name of dragNames) {
    const entry = deps.registry.get(name);
    const spec = deps.specByName.get(name);
    if (!entry || !spec) continue;
    dragBaseline.set(name, [...entry.center] as Vec3);
    const ghost = makeGhost(spec, entry);
    overlayGroup.add(ghost);
    ghostByName.set(name, ghost);
    // Dim the selection box during drag so the moving ghost reads as the
    // primary cue (otherwise the static box catches the eye).
    const box = boxByName.get(name);
    if (box) (box.material as THREE.LineBasicMaterial).opacity = 0.35;
  }
}

function applyGhostDelta(delta: Vec3): void {
  for (const [name, ghost] of ghostByName) {
    const base = dragBaseline.get(name);
    if (!base) continue;
    ghost.position.set(base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]);
  }
  // The selection box should also track the drag so the user sees the new
  // position bound while the ghost shows the geometry.
  for (const [name, box] of boxByName) {
    const base = dragBaseline.get(name);
    if (!base) continue;
    box.position.set(base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]);
  }
}

function commitDrag(): void {
  if (!deps) { cancelDrag(); return; }
  // Compute the delta from the first ghost (all share the same world delta),
  // then snapshot dragNames before cleanup — cleanupGhosts() clears the list
  // and the writeback below needs it.
  let delta: Vec3 = [0, 0, 0];
  for (const [name, ghost] of ghostByName) {
    const base = dragBaseline.get(name);
    if (!base) continue;
    delta = [ghost.position.x - base[0], ghost.position.y - base[1], ghost.position.z - base[2]];
    break;
  }
  const names = [...dragNames];
  cleanupGhosts();
  if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0) {
    refreshArrangeOverlay();
    return;
  }
  // Apply the same delta to every dragged part via the palette's per-engine
  // writeback (handles voxel snap, scad statement, js .translate). The palette
  // also bumps the registry so the post-commit overlay sync is correct.
  for (const name of names) {
    deps.writebackMoveDelta(name, delta);
  }
  refreshArrangeOverlay();
  deps.getCb()?.run();
}

function cancelDrag(): void {
  cleanupGhosts();
  dragging = false;
  pendingPart = null;
  pointerStart = null;
  if (active) refreshArrangeOverlay();
}

function cleanupGhosts(): void {
  if (!overlayGroup) return;
  for (const [, ghost] of ghostByName) {
    overlayGroup.remove(ghost);
    ghost.geometry.dispose();
    (ghost.material as THREE.Material).dispose();
  }
  ghostByName.clear();
  dragNames = [];
  dragBaseline.clear();
  // Restore selection-box opacity after a drag completes/cancels.
  for (const [, box] of boxByName) {
    (box.material as THREE.LineBasicMaterial).opacity = 0.95;
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function pickHit(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): { name: string; point: THREE.Vector3 } | null {
  if (!deps) return null;
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  // Raycast the real merged model — that's the live geometry, paint and all.
  const hits = ray.intersectObject(deps.getMeshGroup(), true);
  if (hits.length === 0) return null;
  const point = hits[0].point;
  const validNames = new Set(deps.registry.keys());
  // Generous bbox tolerance for the click-vs-bbox compare: cheap and robust to
  // booleans that shave a few mm off the original primitive.
  const name = pickPart([point.x, point.y, point.z], deps.registry, validNames, 1.0);
  if (!name) return null;
  return { name, point };
}

function projectToPlane(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  plane: THREE.Plane,
): THREE.Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hit = new THREE.Vector3();
  return ray.ray.intersectPlane(plane, hit) ? hit : null;
}

function makeGhost(spec: PrimitiveSpec, entry: RegistryEntry): THREE.Mesh {
  const geo = buildProxyGeometry(spec);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0.55,
    roughness: 0.6,
    metalness: 0,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(entry.center[0], entry.center[1], entry.center[2]);
  mesh.renderOrder = 999;
  return mesh;
}

/** Build a Three.js geometry that visually represents a palette primitive.
 *  Used only as the drag-ghost; the real engine output is what actually renders
 *  the merged model. Y-up cylinders are rotated to our Z-up convention. */
function buildProxyGeometry(spec: PrimitiveSpec): THREE.BufferGeometry {
  switch (spec.kind) {
    case 'cube':
      return new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
    case 'sphere':
      return new THREE.SphereGeometry(spec.radius, 32, 20);
    case 'cylinder': {
      const g = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 40);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'cone': {
      const g = new THREE.CylinderGeometry(Math.max(spec.radiusTop, 1e-4), spec.radiusBottom, spec.height, 40);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'torus': {
      const seg = Math.max(4, Math.floor(spec.segments));
      return new THREE.TorusGeometry(spec.majorRadius, spec.tubeRadius, 16, seg);
    }
    case 'tube': {
      const g = new THREE.CylinderGeometry(spec.outerRadius, spec.outerRadius, spec.height, 40);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'wedge': {
      const [x, y, z] = spec.size;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(x, 0); shape.lineTo(0, y); shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: z, bevelEnabled: false });
      if (spec.center) g.translate(-x / 2, -y / 2, -z / 2);
      return g;
    }
    case 'pyramid': {
      const g = new THREE.ConeGeometry(spec.baseSize / Math.SQRT2, spec.height, 4);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'polygon': {
      const g = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, Math.max(3, spec.sides));
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'hemisphere': {
      const g = new THREE.SphereGeometry(spec.radius, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'tetrahedron':
      return new THREE.TetrahedronGeometry((spec.size / 2) * Math.sqrt(3));
    case 'star': {
      const n = Math.max(3, Math.floor(spec.points));
      const shape = new THREE.Shape();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? spec.outerRadius : spec.innerRadius;
        if (i === 0) shape.moveTo(r * Math.cos(a), r * Math.sin(a));
        else shape.lineTo(r * Math.cos(a), r * Math.sin(a));
      }
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: spec.height, bevelEnabled: false });
      if (spec.center) g.translate(0, 0, -spec.height / 2);
      return g;
    }
  }
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

function disposeOverlayGroup(group: THREE.Group): void {
  for (const c of [...group.children]) {
    if (c instanceof THREE.LineSegments) disposeLines(c);
    else if (c instanceof THREE.Mesh) {
      c.geometry.dispose();
      (c.material as THREE.Material).dispose();
    }
    group.remove(c);
  }
}

function disposeLines(l: THREE.LineSegments): void {
  l.geometry.dispose();
  (l.material as THREE.Material).dispose();
}

// Re-export the spec-based bbox helper so the palette doesn't need to import it
// twice for the shared registry maintenance path.
export { primitiveEntry };
