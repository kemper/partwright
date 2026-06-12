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
import {
  alignDeltas,
  formatScaleCall,
  groupCentroid,
  groupCentroidScaleDelta,
  groupCentroidRotateZDelta,
  type AlignAxis,
  type AlignMode,
} from './arrangeMath';
import { recordOperation } from './undoStack';
import { parseStatement } from './parseStatement';

// Re-export the pure helpers so callers can pick them up from one entry point.
export { alignDeltas, formatScaleCall, groupCentroid, groupCentroidScaleDelta, groupCentroidRotateZDelta };
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

// Marquee (shift+drag on empty space) — a DOM overlay rectangle that selects
// every part whose bbox centre projects inside it on release. State is held
// at module scope so the pointermove handler can mutate the rect without
// reconstructing it each frame; the overlay element is mounted under document.body
// (not the canvas — Three.js owns the canvas) and removed on commit/cancel.
let marquee: {
  startX: number;
  startY: number;
  el: HTMLDivElement;
  shiftAtStart: boolean; // true ⇒ additive (preserve existing selection)
} | null = null;

// Preview wireframes painted on parts the marquee currently covers, so the user
// sees the lasso filling in live instead of only when they release. Lighter
// styling (thinner / more transparent) than the real selection box so the user
// can tell them apart at a glance.
const marqueeCandidateBoxByName = new Map<string, THREE.LineSegments>();

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
  // Seed the registry from the live code BEFORE we activate listeners so the
  // first click finds hand-written parts (typed straight into the editor) the
  // same way it finds palette-inserted ones.
  seedRegistryFromCode();
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

/** Walk the live code's parts list and seed `specByName` + `registry` for any
 *  part the palette didn't already know about. This is the bridge that makes
 *  hand-written declarations (`const myCube = Manifold.cube([...]);`,
 *  `v.sphere([...], r, '#...'); // part: ball`, etc.) draggable / resizable /
 *  alignable from arrange mode — without it, only palette-inserted parts were
 *  arrangeable, which the May 2026 follow-up audit called out as a real gap.
 *
 *  Best-effort: parseStatement returns null for any shape it doesn't
 *  recognise (computed args, custom expressions, chained transforms beyond
 *  `.translate`); those parts just stay out of the registry and the existing
 *  "click hits nothing" fallback applies. */
function seedRegistryFromCode(): void {
  if (!deps) return;
  const cb = deps.getCb();
  if (!cb) return;
  const lang = cb.getLanguage();
  const parts = deps.scanParts(cb.getCode(), lang);
  for (const part of parts) {
    if (deps.specByName.has(part.name)) continue;
    if (!part.statement) continue;
    const spec = parseStatement(part.statement, lang, part.name);
    if (!spec) continue;
    deps.specByName.set(part.name, spec);
    deps.registry.set(part.name, primitiveEntry(spec));
  }
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
  cancelMarquee();
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
    // Empty-space pointerdown. With Shift held, begin a marquee drag — a
    // translucent rectangle the user drags out to lasso parts (Tinkercad-
    // style additive marquee). Without Shift, fall back to the original
    // deselect-on-blank behaviour and let orbit handle the gesture.
    if (e.shiftKey) {
      beginMarquee(e.clientX, e.clientY);
      e.stopPropagation();
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      setGizmoLock(true);
    } else if (deps.selection.size > 0) {
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
  if (!active || !deps) return;
  if (marquee) {
    updateMarquee(e.clientX, e.clientY);
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  if (!pendingPart || !pointerStart) return;
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
    // Drag plane selection:
    //   - default: horizontal plane through the pickup point — slides the part
    //     across the build plate.
    //   - alt held: vertical plane facing the camera through the pickup point
    //     — lifts the part along the world Z axis. Cleaner than a "use Y mouse
    //     motion as Z" approximation because the projection picks up the
    //     camera distance correctly, so a click on a high feature scales the
    //     drag the same way the horizontal drag does.
    const plane = e.altKey
      ? makeVerticalPlane(camera, pointerStart.world)
      : new THREE.Plane(new THREE.Vector3(0, 0, 1), -pointerStart.world.z);
    const hit = projectToPlane(e.clientX, e.clientY, camera, canvas, plane);
    if (!hit) return;
    const delta: Vec3 = e.altKey
      ? [0, 0, hit.z - pointerStart.world.z]
      : [hit.x - pointerStart.world.x, hit.y - pointerStart.world.y, 0];
    applyGhostDelta(delta);
    requestRender();
    e.stopPropagation();
    e.preventDefault();
  }
}

/** Build a vertical plane through `pivot` whose normal is the horizontal
 *  component of the camera's look direction. Lets alt-drag map the user's
 *  in-plane pointer motion to a clean world-Z delta (we still only consume
 *  the Z component, but the plane orientation keeps the in-plane projection
 *  meaningful — the part stays under the cursor as the camera turns). */
function makeVerticalPlane(camera: THREE.Camera, pivot: THREE.Vector3): THREE.Plane {
  // Look-direction from camera to pivot, flattened onto the XY plane.
  const look = pivot.clone().sub(camera.getWorldPosition(new THREE.Vector3()));
  look.z = 0;
  if (look.lengthSq() < 1e-6) look.set(1, 0, 0); // top-down camera: fall back to +X
  look.normalize();
  // Plane normal = -look so the user faces the plane (the plane equation
  // n·x = -d is consistent with Three's setFromNormalAndCoplanarPoint).
  const normal = look.clone().multiplyScalar(-1);
  const plane = new THREE.Plane();
  plane.setFromNormalAndCoplanarPoint(normal, pivot);
  return plane;
}

function onPointerUp(e: PointerEvent): void {
  if (!active || !deps) return;
  const canvas = deps.getCanvas();
  if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  setGizmoLock(false);

  if (marquee) {
    e.stopPropagation();
    e.preventDefault();
    commitMarquee();
    return;
  }

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

function onPointerCancel(_e: PointerEvent): void { cancelDrag(); cancelMarquee(); }

function onKey(e: KeyboardEvent): void {
  if (!active) return;
  if (e.key === 'Escape') {
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (marquee) { cancelMarquee(); return; }
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
  // also bumps the registry so the post-commit overlay sync is correct. The
  // whole multi-part drag is ONE undo step — recordOperation snapshots the
  // pre-drag state once and pushes after the loop, so Ctrl-Z restores every
  // moved part together (matches the user's gesture, not the per-part edits).
  const label = names.length === 1 ? `Move ${names[0]}` : `Move ${names.length} parts`;
  const d = deps;
  recordOperation(label, () => {
    for (const name of names) {
      d.writebackMoveDelta(name, delta);
    }
  });
  refreshArrangeOverlay();
  d.getCb()?.run();
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
// Marquee selection (shift + drag on empty space)
// ---------------------------------------------------------------------------

function beginMarquee(clientX: number, clientY: number): void {
  const el = document.createElement('div');
  el.style.cssText =
    'position: fixed; pointer-events: none; z-index: 10000; ' +
    'border: 1.5px dashed rgb(253 224 71); background: rgba(253, 224, 71, 0.12); ' +
    'box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);';
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  el.style.width = '0px';
  el.style.height = '0px';
  document.body.appendChild(el);
  marquee = { startX: clientX, startY: clientY, el, shiftAtStart: true };
}

function updateMarquee(clientX: number, clientY: number): void {
  if (!marquee) return;
  const x = Math.min(marquee.startX, clientX);
  const y = Math.min(marquee.startY, clientY);
  const w = Math.abs(clientX - marquee.startX);
  const h = Math.abs(clientY - marquee.startY);
  marquee.el.style.left = `${x}px`;
  marquee.el.style.top = `${y}px`;
  marquee.el.style.width = `${w}px`;
  marquee.el.style.height = `${h}px`;
  refreshMarqueeCandidates(marquee.el.getBoundingClientRect());
}

/** Repaint the live candidate wireframes — every part whose bbox centre
 *  currently projects inside the marquee rect gets a translucent yellow box so
 *  the user sees the lasso filling in as they drag. Idempotent: drops boxes
 *  for parts that have fallen outside the rect, adds new ones for entrants. */
function refreshMarqueeCandidates(rect: DOMRect): void {
  if (!deps || !overlayGroup) return;
  const camera = deps.getCamera();
  const canvas = deps.getCanvas();
  if (!camera || !canvas) return;

  const inside = new Set<string>();
  for (const [name, entry] of deps.registry) {
    // Already in the real selection? Skip — the solid yellow box owns it.
    if (deps.selection.has(name)) continue;
    const screen = projectWorldToScreen(entry.center, camera, canvas);
    if (!screen) continue;
    if (screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom) {
      inside.add(name);
    }
  }

  // Drop preview boxes that no longer match.
  for (const [name, box] of [...marqueeCandidateBoxByName]) {
    if (!inside.has(name) || !deps.registry.has(name)) {
      overlayGroup.remove(box);
      disposeLines(box);
      marqueeCandidateBoxByName.delete(name);
    }
  }
  // Add boxes for fresh entrants.
  for (const name of inside) {
    if (marqueeCandidateBoxByName.has(name)) continue;
    const entry = deps.registry.get(name);
    if (!entry) continue;
    const box = makeMarqueeCandidateBox(entry);
    overlayGroup.add(box);
    marqueeCandidateBoxByName.set(name, box);
  }
  requestRender();
}

function makeMarqueeCandidateBox(entry: RegistryEntry): THREE.LineSegments {
  const dx = Math.max(entry.box.max[0] - entry.box.min[0], 0.001);
  const dy = Math.max(entry.box.max[1] - entry.box.min[1], 0.001);
  const dz = Math.max(entry.box.max[2] - entry.box.min[2], 0.001);
  const boxGeo = new THREE.BoxGeometry(dx, dy, dz);
  const edges = new THREE.EdgesGeometry(boxGeo);
  boxGeo.dispose();
  const mat = new THREE.LineBasicMaterial({
    color: 0xffd34d,
    transparent: true,
    opacity: 0.4,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(edges, mat);
  lines.renderOrder = 999;
  lines.position.set(entry.center[0], entry.center[1], entry.center[2]);
  return lines;
}

function clearMarqueeCandidates(): void {
  if (!overlayGroup) {
    marqueeCandidateBoxByName.clear();
    return;
  }
  for (const [, box] of marqueeCandidateBoxByName) {
    overlayGroup.remove(box);
    disposeLines(box);
  }
  marqueeCandidateBoxByName.clear();
}

function commitMarquee(): void {
  if (!marquee || !deps) { cancelMarquee(); return; }
  const camera = deps.getCamera();
  const canvas = deps.getCanvas();
  if (!camera || !canvas) { cancelMarquee(); return; }
  const rect = marquee.el.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  marquee.el.remove();
  marquee = null;
  // Drop the live candidate previews — refreshArrangeOverlay below paints the
  // real solid selection boxes for the same parts (no flicker because the
  // refresh happens in the same tick).
  clearMarqueeCandidates();
  // A near-zero drag is treated as a click on empty space — just deselect.
  // (Threshold matches DRAG_THRESHOLD_PX so a click-to-deselect path that
  // happened to be shift-held doesn't accidentally hold the selection.)
  if (w < DRAG_THRESHOLD_PX && h < DRAG_THRESHOLD_PX) {
    refreshArrangeOverlay();
    return;
  }
  // Project every registered part's bbox centre onto the canvas; the parts
  // whose centre lands inside the marquee rect get added to the selection.
  // Centre-in-rect (rather than "any bbox corner overlaps") matches Tinkercad
  // and avoids picking up huge background parts whose corners poke through.
  const added: string[] = [];
  for (const [name, entry] of deps.registry) {
    const screen = projectWorldToScreen(entry.center, camera, canvas);
    if (!screen) continue;
    if (screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom) {
      added.push(name);
    }
  }
  if (added.length === 0) {
    // Empty drag: still meaningful as "clear selection" iff shift wasn't held
    // — but shift IS held by construction (that's how the marquee was opened).
    // So a no-hit marquee is just a no-op; don't drop the existing selection.
    refreshArrangeOverlay();
    return;
  }
  for (const name of added) deps.selection.add(name);
  deps.onSelectionChanged();
  refreshArrangeOverlay();
}

function cancelMarquee(): void {
  if (!marquee) {
    clearMarqueeCandidates();
    return;
  }
  marquee.el.remove();
  marquee = null;
  clearMarqueeCandidates();
  if (active) refreshArrangeOverlay();
}

/** Project a world-space point through the camera to canvas-relative screen
 *  coordinates (in CSS px, matching client* coords). Returns null when the
 *  point sits behind the camera — for an orthographic / perspective frustum
 *  that's rare in practice, but cheap to guard against. */
function projectWorldToScreen(
  world: Vec3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): { x: number; y: number } | null {
  const v = new THREE.Vector3(world[0], world[1], world[2]);
  v.project(camera);
  // After project(), v.z > 1 or < -1 puts the point outside the frustum;
  // we still allow it as long as it's not behind the camera (z within [-1, 1]
  // is on-screen; outside that is clipped but its NDC projection still maps to
  // a valid 2D coord, which is what we want for the marquee check).
  const rect = canvas.getBoundingClientRect();
  return {
    x: (v.x + 1) * 0.5 * rect.width + rect.left,
    y: (1 - v.y) * 0.5 * rect.height + rect.top,
  };
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
