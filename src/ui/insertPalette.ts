// Insert palette — a floating panel over the viewport for click-to-insert
// shapes and boolean operations. Toggled from the toolbar "Insert" button.
//
// Shapes (cube/sphere/cylinder/cone) open a parameter modal and emit a
// snippet in the session's active language (manifold-js or OpenSCAD). Boolean
// operations (union/subtract/intersect) collect operands three ways:
//   1. From a list of named parts scanned from the code
//   2. By clicking the model in the 3D viewport
//   3. By wrapping the current editor selection
//
// All code generation lives in src/insert/codegen.ts + controller.ts; this
// module is the DOM/orchestration layer.

import * as THREE from 'three';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import {
  createToolPanelHeader,
  TOOL_PANEL_CLASS,
  TOOL_TOGGLE_IDLE,
  TOOL_TOGGLE_ACTIVE,
} from './toolPanel';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { openViewportPanel, closeViewportPanel, type ViewportPanel } from './viewportPanelRegistry';
import { viewportToolsMount } from './popoverMenu';
import { getScene, getMeshGroup } from '../renderer/viewport';
import {
  emitPrimitive,
  emitPrimitiveVoxel,
  emitOperationJs,
  emitOperationScad,
  emitOperationBrep,
  emitEnclosure,
  scanParts,
  shapesFor,
  supportsBooleanOps,
  uniqueName,
  sanitizeName,
  baseNameFor,
  ENCLOSURE_BASE_NAME,
  VOXEL_DEFAULT_COLOR,
  type PrimitiveKind,
  type BooleanOpKind,
  type MirrorAxis,
  type PrimitiveSpec,
  type EnclosureKind,
  type EnclosureSpec,
  type InsertLanguage,
  type Vec3,
} from '../insert/codegen';
import {
  addManagedDeclaration,
  appendScadStatement,
  replaceScadRanges,
  appendVoxelStatement,
  ensureVoxelScaffold,
  replaceVoxelStatement,
  voxelGridVar,
  setPartTranslateDeltaJs,
  setPartTranslateDeltaScad,
  setPartScaleJs,
  setPartScaleScad,
  mirrorPartJs,
  mirrorPartScad,
  duplicatePartJs,
  duplicatePartScad,
  removeManagedPart,
  removeScadStatement,
} from '../insert/controller';
import { primitiveEntry, unionBoxes, pickPart, translateEntry, type RegistryEntry } from '../insert/spatial';
import {
  initArrangeMode,
  enterArrangeMode,
  exitArrangeMode,
  isArrangeActive,
  refreshArrangeOverlay,
  alignDeltas,
  type AlignAxis,
  type AlignMode,
} from '../insert/arrangeMode';
import {
  initUndoStack,
  subscribeUndoStack,
  recordOperation,
  undo as undoOp,
  redo as redoOp,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
  clearUndoHistory,
} from '../insert/undoStack';
import type { MeshData } from '../geometry/types';

export interface InsertPaletteCallbacks {
  getLanguage: () => InsertLanguage;
  getCode: () => string;
  /** Replace the whole document (formats via setValue). */
  setCode: (code: string) => void;
  getSelection: () => { from: number; to: number; text: string };
  run: (code?: string) => void;
  showToast: (msg: string, opts?: { variant?: 'neutral' | 'warn' | 'success' }) => void;
  getMeshData: () => MeshData | null;
  getCamera: () => THREE.Camera | null;
  getCanvas: () => HTMLCanvasElement | null;
}

// Spatial registry mapping a part name → its center/bbox, recorded when we
// emit a primitive. Used only to resolve a viewport click back to a part for
// the "Click in 3D view" operand mode. It's a convenience: entries are
// reconciled against the live code (deleted names drop out), and a click that
// matches nothing falls back with a hint, so a stale registry never corrupts
// anything — the code stays the source of truth.
const registry = new Map<string, RegistryEntry>();

// Full spec for each palette-created primitive, keyed by name. Build mode renders
// these as individually-movable proxies. Operation results have no spec (they're
// combinations, not scene leaves). In-memory for now (prototype) — persistence is
// the open "source of truth" decision.
const specByName = new Map<string, PrimitiveSpec>();

let cb: InsertPaletteCallbacks | null = null;
let panel: HTMLElement | null = null;
// The DOM node the panel mounts into, captured at init; the panel itself is
// appended lazily on first open (keeps its hidden `role="dialog"` out of the
// app-wide modal selector until it's actually used).
let panelHost: HTMLElement | null = null;

// Multi-select state: parts the user has marked (via 3D-pick select mode or
// the "+" buttons next to operands) so the quick-action buttons can operate on
// them without going through the operand-picker modal. Persists across panel
// open/close so the user can iterate.
const selection = new Set<string>();
// DOM refs for live UI updates when the selection changes.
let selectionStripEl: HTMLElement | null = null;
let quickActionsEl: HTMLElement | null = null;

// Auto-combine: when on (default), each inserted shape folds into the engine's
// visible union (Manifold.union / BREP.fuseAll) so you see it; when off, the
// shape is added to the code + registered for pick/move but not shown until you
// explicitly Union it. Only meaningful for the single-return engines
// (manifold-js / replicad) — scad & voxel union implicitly.
let autoCombine = true;

// Refs to the sections that show/hide per active engine, repainted by
// refreshForLanguage() on open + on language change.
let shapeBtnByKind: Partial<Record<PrimitiveKind, HTMLButtonElement>> = {};
let shapeSectionEl: HTMLElement | null = null;
let opsSectionEl: HTMLElement | null = null;
let enclosureSectionEl: HTMLElement | null = null;
let autoCombineRowEl: HTMLElement | null = null;
let mirrorBtnEl: HTMLButtonElement | null = null;
let combineHintEl: HTMLElement | null = null;

// Arrange-mode UI refs. The toggle button reflects the persistent on/off state
// of arrange mode; the size + align sections appear when 1+ / 2+ parts are
// selected and the user is in arrange mode (or simply has a selection — the
// resize/align actions work whether or not arrange mode is active, since they
// operate on the same selection Set).
let arrangeToggleBtn: HTMLButtonElement | null = null;
let sizeSectionEl: HTMLElement | null = null;
let alignSectionEl: HTMLElement | null = null;
let sizeInputs: [HTMLInputElement, HTMLInputElement, HTMLInputElement] | null = null;
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;

const RESULT_BASE: Record<BooleanOpKind, string> = {
  union: 'merged',
  subtract: 'cut',
  intersect: 'overlap',
};

const OP_LABEL: Record<BooleanOpKind, string> = {
  union: '∪ Union',
  subtract: '∖ Subtract',
  intersect: '∩ Intersect',
};

const OP_TITLE: Record<BooleanOpKind, string> = {
  union: 'Union',
  subtract: 'Subtract',
  intersect: 'Intersect',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let toolBtn: HTMLButtonElement | null = null;

/** Registry entry so the shared viewport-panel registry can close us when
 *  another tool (Paint, Voxel, Surface, etc.) opens — and vice versa. */
const insertRegistryEntry: ViewportPanel = { close(): void { if (isInsertPaletteOpen()) closeInsertPalette(); } };

function onInsertEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // Defer to any open modal dialog stacked on top of the panel.
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  closeInsertPalette();
}

export function initInsertPalette(container: HTMLElement, callbacks: InsertPaletteCallbacks): void {
  cb = callbacks;

  // The toolbar button. Lives in the Tools popover next to Paint / Simplify /
  // Measure so it's always visible regardless of editor-pane collapse state.
  toolBtn = document.createElement('button');
  toolBtn.id = 'btn-insert';
  toolBtn.className = TOOL_TOGGLE_IDLE;
  toolBtn.textContent = '➕ Insert';
  toolBtn.title = 'Insert shapes and boolean operations as code';
  toolBtn.addEventListener('click', toggleInsertPalette);
  // Sit before the paint button when the Tools popover already exists so the
  // toolbar reads Insert · Paint · Simplify · Measure · …
  const mount = viewportToolsMount(container);
  const paintBtn = mount.querySelector('#paint-toggle');
  if (paintBtn) mount.insertBefore(toolBtn, paintBtn);
  else mount.appendChild(toolBtn);

  panel = buildPanel();
  // The panel anchors to the positioned viewport pane (clipControls' parent),
  // the same place every shared tool panel docks. It is mounted *lazily* on
  // first open (see openInsertPalette), not here: the panel carries
  // `role="dialog"` (shared tool-panel chrome), and an always-present hidden
  // dialog makes the app-wide `[role="dialog"]` modal selector ambiguous in
  // every test — so, like the other viewport panels, it only enters the DOM
  // once actually opened.
  panelHost = container.parentElement ?? container;

  // Arrange-mode wiring. The module is a singleton like Paint — initialise
  // once with our deps; entering/exiting toggles the canvas listener + overlay.
  initArrangeMode({
    getCanvas: () => callbacks.getCanvas(),
    getCamera: () => callbacks.getCamera(),
    getMeshGroup,
    getCb: () => cb,
    registry,
    specByName,
    selection,
    onSelectionChanged: rerenderSelectionUI,
    scanParts,
    writebackMoveDelta: writePartTranslateDelta,
    shiftRegistryEntry: bumpRegistryFor,
  });

  // Undo / redo stack — shared across the palette and arrangeMode. The stack
  // operates on the same registry / specByName / selection these modules
  // already mutate; restoring a snapshot clears-and-refills them in place so
  // every existing reference (the chip-strip renderer, the bounding-box
  // overlay, the SCAD scanner) keeps working unchanged.
  initUndoStack({
    getCode: () => callbacks.getCode(),
    setCode: (c) => callbacks.setCode(c),
    registry,
    specByName,
    selection,
    run: () => callbacks.run(),
    onAfterRestore: () => { rerenderSelectionUI(); refreshArrangeOverlay(); updateUndoRedoButtons(); },
  });
  subscribeUndoStack(updateUndoRedoButtons);

  // Sessions don't share registry/spec state. Without a reset, a part named
  // `box` from session A would persist into session B and either contaminate
  // 3D-pick (stale bbox) or trip `pruneSelection` only if the name *also*
  // appears in B's code. Clear everything on session change so each session
  // starts from a blank palette-side cache.
  window.addEventListener('session-changed', resetInsertPaletteState);
}

/** Drop palette-side caches that don't carry between sessions: the selection
 *  set, the spatial registry, the spec-by-name map. Also closes the panel so
 *  a stale chip strip doesn't paint over the new session's empty state. */
function resetInsertPaletteState(): void {
  // Tear down any in-flight select/pick session and exit arrange mode first:
  // a session switch mid-interaction would otherwise leak the canvas + key
  // listeners owned by those flows. Each cleanup nulls itself, so calling them
  // is safe whether or not one is active.
  exitArrangeMode();
  selectSessionCleanup?.();
  pickCleanup?.();
  selection.clear();
  registry.clear();
  specByName.clear();
  // Drop the undo history too — its snapshots refer to the previous session's
  // code/registry/spec maps; carrying them across would let Ctrl-Z reach into
  // the old session's state, breaking the per-session isolation rule.
  clearUndoHistory();
  if (isInsertPaletteOpen()) closeInsertPalette();
  rerenderSelectionUI();
  updateArrangeToggleState();
  updateUndoRedoButtons();
}

function isInsertPaletteOpen(): boolean {
  return !!panel && !panel.classList.contains('hidden');
}

function setToolBtnState(active: boolean): void {
  if (!toolBtn) return;
  // Match paintUI.ts's pattern (line 203 on main): assign the whole class
  // string rather than tokenizing & swapping. Avoids regex drift if either
  // shared constant gains a class with internal whitespace later.
  toolBtn.className = active ? TOOL_TOGGLE_ACTIVE : TOOL_TOGGLE_IDLE;
}

// Arrange toggle styling — paints a prominent blue button at the top of the
// palette (it's the headline action). Active state inverts to a brighter,
// outlined treatment so the user knows pointer events are now arrange events.
const ARRANGE_TOGGLE_IDLE =
  'w-full px-2 py-2 rounded text-xs font-medium text-zinc-100 bg-blue-600/80 hover:bg-blue-600 border border-blue-500/60 transition-colors mb-1';
const ARRANGE_TOGGLE_ACTIVE =
  'w-full px-2 py-2 rounded text-xs font-medium text-zinc-900 bg-amber-300 hover:bg-amber-200 border border-amber-400 transition-colors mb-1';

function updateArrangeToggleState(): void {
  if (!arrangeToggleBtn) return;
  const on = isArrangeActive();
  arrangeToggleBtn.className = on ? ARRANGE_TOGGLE_ACTIVE : ARRANGE_TOGGLE_IDLE;
  arrangeToggleBtn.textContent = on ? '✥ Arrange — ON · click again to exit' : '✥ Arrange';
}

function updateUndoRedoButtons(): void {
  if (undoBtn) {
    const lbl = peekUndoLabel();
    undoBtn.disabled = !canUndo();
    undoBtn.title = lbl ? `Undo: ${lbl}` : 'Nothing to undo';
  }
  if (redoBtn) {
    const lbl = peekRedoLabel();
    redoBtn.disabled = !canRedo();
    redoBtn.title = lbl ? `Redo: ${lbl}` : 'Nothing to redo';
  }
}

function openInsertPalette(): void {
  if (!panel) return;
  // Lazy first mount — keeps the hidden dialog out of the DOM until used.
  if (!panel.parentElement && panelHost) panelHost.appendChild(panel);
  refreshForLanguage();
  panel.classList.remove('hidden');
  setInitialPanelPosition(panel);
  setToolBtnState(true);
  openViewportPanel(insertRegistryEntry);
  document.addEventListener('keydown', onInsertEscape);
}

/** Show/hide the per-engine sections (shape buttons, ops, enclosure, auto-
 *  combine, mirror) for the active language. Driven on open + on language
 *  change so a session that switches engines reflects what that engine can do.
 *  The mesh engines do everything; BREP omits sketch-only shapes; voxel omits
 *  whole-solid booleans + mirror + the SDF-less shapes. */
function refreshForLanguage(): void {
  if (!cb) return;
  const lang = cb.getLanguage();
  const shapes = new Set(shapesFor(lang));
  for (const kind of Object.keys(shapeBtnByKind) as PrimitiveKind[]) {
    shapeBtnByKind[kind]?.classList.toggle('hidden', !shapes.has(kind));
  }
  opsSectionEl?.classList.toggle('hidden', !supportsBooleanOps(lang));
  // Enclosure builders are a manifold-js (api.enclosure) feature.
  enclosureSectionEl?.classList.toggle('hidden', lang !== 'manifold-js');
  // The auto-combine toggle only governs the single-return engines.
  autoCombineRowEl?.classList.toggle('hidden', !isManagedLang(lang));
  // Mirror is in-place reflection: voxel grids can't reflect, and replicad's
  // BrepShape has no `.mirror`, so hide it for both.
  mirrorBtnEl?.classList.toggle('hidden', lang === 'voxel' || lang === 'replicad');
  updateCombineHint();
}

/** Whether `lang` manages a single `return` we fold parts into (vs the
 *  implicit-union statement engines scad/voxel). */
function isManagedLang(lang: InsertLanguage): lang is 'manifold-js' | 'replicad' {
  return lang === 'manifold-js' || lang === 'replicad';
}

function updateCombineHint(): void {
  if (!combineHintEl || !cb) return;
  const lang = cb.getLanguage();
  if (isManagedLang(lang)) {
    combineHintEl.textContent = autoCombine
      ? 'New shapes join the scene as a union so you see them — turn off Auto-combine to add parts without showing them, then Union explicitly.'
      : 'Auto-combine is off: inserted parts are added to the code and selectable, but not shown until you Union them.';
  } else if (lang === 'voxel') {
    combineHintEl.textContent = 'Every shape fills the same voxel grid (union is automatic). Use Move to arrange, or Delete to remove a fill.';
  } else {
    combineHintEl.textContent = 'Top-level shapes union automatically. Use the ops to subtract/intersect, or Move to arrange them.';
  }
}

function closeInsertPalette(): void {
  if (!panel || !isInsertPaletteOpen()) return;
  // Closing the palette also exits arrange mode — otherwise the canvas pointer
  // listener would keep stealing clicks from orbit-camera with no visible toggle
  // for the user to flip back off.
  if (isArrangeActive()) exitArrangeMode();
  updateArrangeToggleState();
  panel.classList.add('hidden');
  setToolBtnState(false);
  closeViewportPanel(insertRegistryEntry);
  document.removeEventListener('keydown', onInsertEscape);
}

export function toggleInsertPalette(): void {
  if (isInsertPaletteOpen()) closeInsertPalette();
  else openInsertPalette();
}

/** Show / hide the toolbar Insert button. All four engines now have insert
 *  codegen, so this is normally `true`; it stays a guard for any future
 *  language without palette support. Called from the language-change handler,
 *  which also repaints the per-engine sections via the open path. */
export function setInsertPaletteAvailable(available: boolean): void {
  if (!toolBtn) return;
  toolBtn.classList.toggle('hidden', !available);
  if (!available && isInsertPaletteOpen()) closeInsertPalette();
  // Reflect the new engine's capabilities if the panel is currently open.
  else if (available && isInsertPaletteOpen()) refreshForLanguage();
}

// ---------------------------------------------------------------------------
// Public API surface — drives the palette's tool behaviours from
// `window.partwright` (and the in-app AI). Keeps the UI <-> JS-API parity rule
// from CLAUDE.md: anything you can click here should also be callable in code.
// ---------------------------------------------------------------------------

/** Programmatic equivalent of clicking the ✥ Arrange toggle ON. Opens the
 *  palette panel if needed so chip-strip / Undo / Size / Align UI is visible
 *  for whatever follow-up calls hit. Idempotent. */
export function apiEnterArrange(): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (!isInsertPaletteOpen()) openInsertPalette();
  if (!isArrangeActive()) {
    enterArrangeMode();
    updateArrangeToggleState();
  }
  return { ok: isArrangeActive() };
}

/** Programmatic equivalent of clicking the toggle OFF. */
export function apiExitArrange(): void {
  if (isArrangeActive()) {
    exitArrangeMode();
    updateArrangeToggleState();
  }
}

export function apiIsArrangeActive(): boolean { return isArrangeActive(); }

/** Replace the arrange-mode selection with `names`. Names are matched against
 *  the live code's scanned parts (so a typo just produces an empty selection).
 *  Returns the names that actually matched. */
export function apiSetSelection(names: readonly string[]): string[] {
  if (!cb) return [];
  const valid = new Set(scanParts(cb.getCode(), cb.getLanguage()).map(p => p.name));
  selection.clear();
  const matched: string[] = [];
  for (const name of names) {
    if (valid.has(name)) { selection.add(name); matched.push(name); }
  }
  rerenderSelectionUI();
  return matched;
}

/** Add `names` to the current selection without clearing existing entries.
 *  Mirrors shift-click. Returns names that matched live parts. */
export function apiAddToSelection(names: readonly string[]): string[] {
  if (!cb) return [];
  const valid = new Set(scanParts(cb.getCode(), cb.getLanguage()).map(p => p.name));
  const matched: string[] = [];
  for (const name of names) {
    if (valid.has(name)) { selection.add(name); matched.push(name); }
  }
  rerenderSelectionUI();
  return matched;
}

/** Drop everything from the selection — equivalent to clicking empty space in
 *  arrange mode without Shift held. */
export function apiClearSelection(): void {
  if (selection.size === 0) return;
  selection.clear();
  rerenderSelectionUI();
}

/** Snapshot the current selection — the names the UI is treating as the
 *  active group. */
export function apiGetSelection(): string[] { return [...selection]; }

/** Run the undo stack's `undo()` and surface its label as a toast (matches
 *  the panel button). Returns the undone op's label, or null. */
export function apiUndo(): string | null {
  const label = undoOp();
  if (label && cb) cb.showToast(`Undid: ${label}`, { variant: 'neutral' });
  return label;
}

export function apiRedo(): string | null {
  const label = redoOp();
  if (label && cb) cb.showToast(`Redid: ${label}`, { variant: 'neutral' });
  return label;
}

export function apiCanUndo(): boolean { return canUndo(); }
export function apiCanRedo(): boolean { return canRedo(); }

/** Resize the current selection — same call applyResize uses, exposed for
 *  scripted edits. `scale` may be uniform-or-anisotropic. */
export function apiResizeSelection(scale: Vec3): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (selection.size === 0) return { ok: false, reason: 'no selection' };
  applyResize(scale);
  return { ok: true };
}

/** Align the current selection on `axis` to `mode` (min / center / max). */
export function apiAlignSelection(axis: AlignAxis, mode: AlignMode): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (selection.size < 2) return { ok: false, reason: 'need 2+ parts' };
  applyAlign(axis, mode);
  return { ok: true };
}

/** Group the current selection — same union the palette's ∪ button drives.
 *  Engine-aware: voxel grids union implicitly, so this is a no-op there. */
export function apiGroupSelection(): { ok: boolean; reason?: string } {
  return apiBooleanSelection('union');
}

export function apiSubtractSelection(): { ok: boolean; reason?: string } {
  return apiBooleanSelection('subtract');
}

export function apiIntersectSelection(): { ok: boolean; reason?: string } {
  return apiBooleanSelection('intersect');
}

function apiBooleanSelection(op: BooleanOpKind): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (selection.size < 2) return { ok: false, reason: 'need 2+ parts' };
  const lang = cb.getLanguage();
  if (lang === 'voxel') return { ok: false, reason: 'voxel grids union implicitly' };
  const liveParts = scanParts(cb.getCode(), lang);
  const partByName = new Map(liveParts.map(p => [p.name, p]));
  const operands: Operand[] = [];
  for (const name of selection) {
    const part = partByName.get(name);
    if (!part) continue;
    operands.push({ name: part.name, statement: part.statement, range: part.range });
  }
  if (operands.length < 2) return { ok: false, reason: 'selection lost in code' };
  applyOperation(op, operands, lang);
  selection.clear();
  rerenderSelectionUI();
  return { ok: true };
}

export function apiDeleteSelection(): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (selection.size === 0) return { ok: false, reason: 'no selection' };
  applyQuickDelete();
  return { ok: true };
}

export function apiDuplicateSelection(): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (selection.size === 0) return { ok: false, reason: 'no selection' };
  applyQuickDuplicate();
  return { ok: true };
}

export function apiMirrorSelection(axis: MirrorAxis): { ok: boolean; reason?: string } {
  if (!cb) return { ok: false, reason: 'insert palette not initialized' };
  if (selection.size === 0) return { ok: false, reason: 'no selection' };
  applyQuickMirror(axis);
  return { ok: true };
}

/** List the parts arrange mode currently knows about, with their bboxes.
 *  Includes both palette-inserted parts and hand-written parts the parser
 *  could resolve (arrange enters once to seed). Returns an array so external
 *  callers don't get a live reference to the internal Map. */
export function apiListParts(): Array<{ name: string; box: RegistryEntry['box']; center: RegistryEntry['center'] }> {
  return [...registry.entries()].map(([name, entry]) => ({ name, box: entry.box, center: entry.center }));
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5 mt-1';
  el.textContent = text;
  return el;
}

function paletteButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className =
    'flex-1 min-w-[60px] px-2 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700/60 hover:bg-zinc-600 border border-zinc-600/60 transition-colors';
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function buildPanel(): HTMLElement {
  // Standard tool-panel chrome: shell + draggable header + scrollable body.
  // The shell is a long-lived singleton: open()/close() toggle the `hidden`
  // class rather than re-mounting, so the chip strip's DOM refs survive.
  const shell = document.createElement('div');
  shell.id = 'insert-palette-panel';
  shell.className = `hidden ${TOOL_PANEL_CLASS} w-[18rem] max-w-[calc(100vw-1rem)] max-h-[calc(100%-3.5rem)] select-none`;
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'false');
  shell.setAttribute('aria-label', 'Insert');

  const header = createToolPanelHeader('Insert', closeInsertPalette, 'Close insert palette');
  shell.appendChild(header);
  attachViewportPanelDrag(header, shell);

  // Sections below populate the scrollable body, not the chrome shell itself.
  // Aliasing back to `p` keeps the (large) section-build code below readable.
  const p = document.createElement('div');
  p.className = 'flex-1 min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-1.5 text-sm text-zinc-200';
  shell.appendChild(p);

  // --- Undo / Redo (coarse-grained palette-operation history) ---
  // One stack entry per Tinkercad-style action (insert / move / resize / align
  // / boolean / duplicate / mirror / delete), independent of CodeMirror's
  // per-text-edit history so a single drag is one Ctrl+Z away from being
  // reversed. Buttons sit at the top of the panel so they're always reachable.
  const historyRow = document.createElement('div');
  historyRow.className = 'flex items-stretch gap-1 mb-1';
  undoBtn = document.createElement('button');
  undoBtn.id = 'insert-undo';
  undoBtn.className = 'flex-1 px-2 py-1.5 rounded text-xs font-medium text-zinc-100 bg-zinc-700/60 hover:bg-zinc-600 border border-zinc-600/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  undoBtn.textContent = '↶ Undo';
  undoBtn.title = 'Undo the last palette operation';
  undoBtn.addEventListener('click', () => {
    const label = undoOp();
    if (label && cb) cb.showToast(`Undid: ${label}`, { variant: 'neutral' });
  });
  redoBtn = document.createElement('button');
  redoBtn.id = 'insert-redo';
  redoBtn.className = undoBtn.className;
  redoBtn.textContent = '↷ Redo';
  redoBtn.title = 'Redo the last undone palette operation';
  redoBtn.addEventListener('click', () => {
    const label = redoOp();
    if (label && cb) cb.showToast(`Redid: ${label}`, { variant: 'neutral' });
  });
  historyRow.append(undoBtn, redoBtn);
  p.appendChild(historyRow);

  // --- Arrange toggle (Tinkercad-style direct manipulation) ---
  // A persistent toggle (NOT a modal session): when on, clicking a shape in the
  // real viewport selects it, shift-click extends, drag moves it in realtime
  // with a translucent ghost preview, and release commits → engine re-runs so
  // the boolean updates for real. The merged model stays visible the whole
  // time. The same selection drives the Size, Align, Operations, and Edit
  // selection rows below — so Group/Subtract/Intersect/Duplicate/Mirror/Delete
  // act on whatever you grab in 3D.
  arrangeToggleBtn = document.createElement('button');
  arrangeToggleBtn.id = 'insert-arrange-toggle';
  arrangeToggleBtn.className = ARRANGE_TOGGLE_IDLE;
  arrangeToggleBtn.textContent = '✥ Arrange';
  arrangeToggleBtn.title =
    'Arrange: click shapes in the viewport to select • shift-click to multi-select • drag a selected shape to move it • adjust Size / Align below • Esc to exit.';
  arrangeToggleBtn.addEventListener('click', () => {
    if (isArrangeActive()) exitArrangeMode();
    else enterArrangeMode();
    updateArrangeToggleState();
  });
  p.appendChild(arrangeToggleBtn);

  // --- Shapes ---
  shapeSectionEl = document.createElement('div');
  shapeSectionEl.appendChild(sectionLabel('Shapes'));
  const shapeRow = document.createElement('div');
  shapeRow.className = 'grid grid-cols-4 gap-1 mb-1';
  const shapeBtns: [PrimitiveKind, string, string][] = [
    ['cube', '◼ Cube', 'Insert a cube / box'],
    ['sphere', '● Sphere', 'Insert a sphere'],
    ['cylinder', '▮ Cylinder', 'Insert a cylinder'],
    ['cone', '▲ Cone', 'Insert a cone'],
    ['torus', '◯ Torus', 'Insert a torus (ring)'],
    ['tube', '⌬ Tube', 'Insert a hollow cylinder / pipe'],
    ['hemisphere', '◐ Dome', 'Insert a hemisphere'],
    ['tetrahedron', '◭ Tet', 'Insert a regular tetrahedron'],
    ['pyramid', '⛰ Pyramid', 'Insert a square-base pyramid'],
    ['wedge', '◣ Wedge', 'Insert a right-triangle prism'],
    ['polygon', '⬢ N-gon', 'Insert a regular polygon prism'],
    ['star', '✦ Star', 'Insert a star prism'],
  ];
  shapeBtnByKind = {};
  for (const [kind, label, title] of shapeBtns) {
    const btn = paletteButton(label, title, () => openPrimitiveModal(kind));
    shapeBtnByKind[kind] = btn;
    shapeRow.appendChild(btn);
  }
  shapeSectionEl.appendChild(shapeRow);

  // Auto-combine toggle — folds new shapes into the visible union (managed-
  // return engines only). Hidden for scad/voxel, which union implicitly.
  autoCombineRowEl = document.createElement('label');
  autoCombineRowEl.className = 'flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer select-none mb-1';
  const autoCb = document.createElement('input');
  autoCb.type = 'checkbox';
  autoCb.id = 'insert-auto-combine';
  autoCb.checked = autoCombine;
  autoCb.className = 'accent-blue-500 w-3.5 h-3.5';
  autoCb.addEventListener('change', () => {
    autoCombine = autoCb.checked;
    updateCombineHint();
  });
  const autoCbLabel = document.createElement('span');
  autoCbLabel.textContent = 'Auto-combine new shapes';
  autoCombineRowEl.append(autoCb, autoCbLabel);
  shapeSectionEl.appendChild(autoCombineRowEl);
  p.appendChild(shapeSectionEl);

  // --- Enclosures ("containers": parametric project boxes / shells) ---
  enclosureSectionEl = document.createElement('div');
  enclosureSectionEl.appendChild(sectionLabel('Enclosure'));
  const encRow = document.createElement('div');
  encRow.className = 'flex flex-wrap gap-1.5';
  encRow.appendChild(paletteButton('▣ Box', 'Two-part project box (base + lid) via api.enclosure.box', () => openEnclosureModal('box')));
  encRow.appendChild(paletteButton('⊓ Shell', 'Single open-top rounded shell via api.enclosure.shell', () => openEnclosureModal('shell')));
  encRow.appendChild(paletteButton('⊥ Standoff', 'PCB mounting post via api.enclosure.standoff', () => openEnclosureModal('standoff')));
  enclosureSectionEl.appendChild(encRow);
  p.appendChild(enclosureSectionEl);

  // --- Selection strip (chips + Select / Clear buttons) ---
  p.appendChild(sectionLabel('Selection'));
  selectionStripEl = document.createElement('div');
  selectionStripEl.id = 'insert-selection-strip';
  selectionStripEl.className = 'flex flex-wrap items-center gap-1 min-h-[26px] p-1 bg-zinc-900/60 border border-zinc-700 rounded mb-1';
  p.appendChild(selectionStripEl);
  const selBtnRow = document.createElement('div');
  selBtnRow.className = 'flex gap-1.5 mb-1';
  selBtnRow.appendChild(paletteButton('🎯 Select', 'Click shapes in the 3D view to select them', startSelectMode));
  const clearBtn = paletteButton('⟲ Clear', 'Empty the selection', () => {
    selection.clear();
    rerenderSelectionUI();
  });
  selBtnRow.appendChild(clearBtn);
  p.appendChild(selBtnRow);

  // --- Size (per-axis scale factor; 1+ selected) ---
  sizeSectionEl = document.createElement('div');
  sizeSectionEl.appendChild(sectionLabel('Size'));
  const sizeRow = document.createElement('div');
  sizeRow.className = 'flex items-center gap-1.5 mb-1';
  const labels: Array<['X' | 'Y' | 'Z', string]> = [['X', 'X scale factor'], ['Y', 'Y scale factor'], ['Z', 'Z scale factor']];
  const builtInputs: HTMLInputElement[] = [];
  for (const [axis, hint] of labels) {
    const wrap = document.createElement('div');
    wrap.className = 'flex items-center gap-1 flex-1';
    const lab = document.createElement('span');
    lab.className = 'text-[10px] text-zinc-400 w-3';
    lab.textContent = axis;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = '0.1';
    inp.min = '0.01';
    inp.value = '1';
    inp.title = hint;
    inp.className = 'flex-1 min-w-0 bg-zinc-900 border border-zinc-600 rounded px-1.5 py-1 text-[11px] text-zinc-100 text-right';
    inp.dataset.axis = axis;
    wrap.append(lab, inp);
    sizeRow.appendChild(wrap);
    builtInputs.push(inp);
  }
  sizeInputs = [builtInputs[0], builtInputs[1], builtInputs[2]];
  sizeSectionEl.appendChild(sizeRow);
  const sizeBtnRow = document.createElement('div');
  sizeBtnRow.className = 'flex gap-1.5 mb-1';
  const applySizeBtn = paletteButton('✓ Apply size', 'Scale the selected parts by these factors', () => {
    const sx = Math.max(0.001, parseFloat(sizeInputs![0].value) || 1);
    const sy = Math.max(0.001, parseFloat(sizeInputs![1].value) || 1);
    const sz = Math.max(0.001, parseFloat(sizeInputs![2].value) || 1);
    applyResize([sx, sy, sz]);
    // Reset back to 1 so the next Apply is relative to the current size,
    // not stacked onto the previous factor (matches user mental model).
    sizeInputs![0].value = '1';
    sizeInputs![1].value = '1';
    sizeInputs![2].value = '1';
  });
  const resetSizeBtn = paletteButton('⟲ 1×', 'Reset the factors to 1', () => {
    sizeInputs![0].value = '1';
    sizeInputs![1].value = '1';
    sizeInputs![2].value = '1';
  });
  sizeBtnRow.append(applySizeBtn, resetSizeBtn);
  sizeSectionEl.appendChild(sizeBtnRow);
  p.appendChild(sizeSectionEl);

  // --- Align (2+ selected) ---
  alignSectionEl = document.createElement('div');
  alignSectionEl.appendChild(sectionLabel('Align'));
  const alignGrid = document.createElement('div');
  alignGrid.className = 'grid grid-cols-3 gap-1 mb-1';
  // Three rows (X, Y, Z) × three modes (min / center / max).
  // Symbols: ┤ ┼ ├ for the visual surface cue.
  const axisRows: Array<[AlignAxis, string]> = [['x', 'X'], ['y', 'Y'], ['z', 'Z']];
  const modes: Array<[AlignMode, string, string]> = [
    ['min', '⊣', 'min surface (left / front / bottom)'],
    ['center', '⊢⊣', 'center'],
    ['max', '⊢', 'max surface (right / back / top)'],
  ];
  for (const [axis, axisLabel] of axisRows) {
    for (const [mode, glyph, hint] of modes) {
      const btn = paletteButton(
        `${axisLabel} ${glyph}`,
        `Align selected parts on ${axisLabel} — ${hint}`,
        () => applyAlign(axis, mode),
      );
      alignGrid.appendChild(btn);
    }
  }
  alignSectionEl.appendChild(alignGrid);
  p.appendChild(alignSectionEl);

  // --- Boolean operations ---
  opsSectionEl = document.createElement('div');
  opsSectionEl.appendChild(sectionLabel('Operations'));
  const opRow = document.createElement('div');
  opRow.className = 'flex flex-wrap gap-1.5';
  (['union', 'subtract', 'intersect'] as BooleanOpKind[]).forEach(op => {
    opRow.appendChild(
      paletteButton(
        OP_LABEL[op],
        `${OP_TITLE[op]} — uses the current selection when it has 2+ parts, otherwise opens the operand picker.`,
        () => beginOperation(op),
      ),
    );
  });
  opsSectionEl.appendChild(opRow);
  p.appendChild(opsSectionEl);

  // --- Quick-edit row (selection-driven) ---
  p.appendChild(sectionLabel('Edit selection'));
  quickActionsEl = document.createElement('div');
  quickActionsEl.className = 'flex flex-wrap gap-1.5';
  quickActionsEl.appendChild(paletteButton('⎘ Duplicate', 'Clone the selected parts (offset along +X)', applyQuickDuplicate));
  mirrorBtnEl = paletteButton('▥ Mirror', 'Flip the selected parts in place', openMirrorPicker);
  quickActionsEl.appendChild(mirrorBtnEl);
  quickActionsEl.appendChild(paletteButton('✕ Delete', 'Remove the selected parts from the code', applyQuickDelete));
  p.appendChild(quickActionsEl);

  combineHintEl = document.createElement('div');
  combineHintEl.className = 'text-[10px] text-zinc-500 leading-tight mt-2';
  p.appendChild(combineHintEl);

  // Paint the selection strip + quick-action disabled-state, and the
  // per-engine section visibility.
  setTimeout(() => { rerenderSelectionUI(); refreshForLanguage(); }, 0);

  return shell;
}

// ---------------------------------------------------------------------------
// Move / Resize / Align — shared writeback used by Arrange-mode drag and the
// Size/Align buttons. Extracted to module scope so Arrange's pointer handlers
// can call writebackMoveDelta without re-creating the closure (and so a single
// implementation covers every per-engine quirk: scad statement re-emit, voxel
// integer snap, js/brep `.translate([…])` append).
// ---------------------------------------------------------------------------

/** Persist a position delta for a named part: rewrite the code's translate,
 *  bump the in-memory spec, and shift the registry bbox. Returns true on
 *  commit. Voxel deltas are snapped to whole voxels so spec/code/registry
 *  stay on the integer lattice and don't drift across repeated drags. */
function writePartTranslateDelta(name: string, delta: Vec3): boolean {
  if (!cb) return false;
  if (Math.abs(delta[0]) < 1e-5 && Math.abs(delta[1]) < 1e-5 && Math.abs(delta[2]) < 1e-5) return false;
  const lang = cb.getLanguage();
  let eff: Vec3 = delta;
  let newCode: string;
  if (lang === 'scad') {
    const part = scanParts(cb.getCode(), 'scad').find(p => p.name === name);
    if (!part?.range) {
      cb.showToast('Could not locate that part in the SCAD code.', { variant: 'warn' });
      return false;
    }
    newCode = setPartTranslateDeltaScad(cb.getCode(), part.range, delta);
  } else if (lang === 'voxel') {
    eff = [Math.round(delta[0]), Math.round(delta[1]), Math.round(delta[2])];
    if (eff[0] === 0 && eff[1] === 0 && eff[2] === 0) return false;
    const spec = specByName.get(name);
    const part = scanParts(cb.getCode(), 'voxel').find(p => p.name === name);
    if (!spec || !part?.range) {
      cb.showToast('Could not locate that voxel shape in the code.', { variant: 'warn' });
      return false;
    }
    const old = spec.position ?? [0, 0, 0];
    const moved = { ...spec, position: [old[0] + eff[0], old[1] + eff[1], old[2] + eff[2]] as Vec3 } as PrimitiveSpec;
    const colour = /'(#[0-9a-fA-F]{3,8})'/.exec(part.statement ?? '');
    const stmt = emitPrimitiveVoxel(moved, voxelGridVar(cb.getCode()), colour ? colour[1] : VOXEL_DEFAULT_COLOR);
    newCode = replaceVoxelStatement(cb.getCode(), part.range, stmt);
  } else {
    newCode = setPartTranslateDeltaJs(cb.getCode(), name, delta);
  }
  cb.setCode(newCode);
  const spec = specByName.get(name);
  if (spec) {
    const p = spec.position ?? [0, 0, 0];
    spec.position = [p[0] + eff[0], p[1] + eff[1], p[2] + eff[2]];
  }
  const entry = registry.get(name);
  if (entry) registry.set(name, translateEntry(entry, eff));
  return true;
}

/** Shift the registry bbox for a single part by `delta`. Exposed to arrangeMode
 *  so the bounding-box overlay can preview a moved position without waiting for
 *  the engine re-run. Idempotent: no-op when the part isn't in the registry. */
function bumpRegistryFor(name: string, delta: Vec3): void {
  const entry = registry.get(name);
  if (!entry) return;
  registry.set(name, translateEntry(entry, delta));
}

/** Scale a palette-inserted part in place: insert (or compound) a `.scale([…])`
 *  into the part's chain via the per-engine codegen, then update the in-memory
 *  spec so further drags/rebuilds see the new dimensions. Skips parts without
 *  a known spec (hand-written, no palette provenance) with a toast — resize
 *  needs the spec to track the new size and to rebuild the registry bbox.
 *
 *  Voxel falls back to spec rewrite + re-emit (voxel statements bake their
 *  dimensions into integer args — there's no chain to wrap), with the geometric
 *  mean of any anisotropic factors for rotationally-symmetric primitives so a
 *  sphere/torus stays watertight at integer lattice resolution. */
function applyResize(scale: Vec3): void {
  if (!cb) return;
  if (scale[0] === 1 && scale[1] === 1 && scale[2] === 1) return;
  if (scale[0] <= 0 || scale[1] <= 0 || scale[2] <= 0) {
    cb.showToast('Scale factors must be positive.', { variant: 'warn' });
    return;
  }
  const lang = cb.getLanguage();
  const names = [...selection];
  if (names.length === 0) return;
  const skipped: string[] = [];
  let appliedAny = false;
  const label = `Resize ${fmtScale(scale)} · ${names.length === 1 ? names[0] : `${names.length} parts`}`;
  const c = cb; // capture non-null `cb` once; the recordOperation lambda below uses this.
  recordOperation(label, () => {
    for (const name of names) {
      if (lang === 'voxel') {
        const spec = specByName.get(name);
        const part = scanParts(c.getCode(), 'voxel').find(p => p.name === name);
        if (!spec || !part?.range) { skipped.push(name); continue; }
        const scaled = scaleSpecForVoxel(spec, scale);
        const colour = /'(#[0-9a-fA-F]{3,8})'/.exec(part.statement ?? '');
        const stmt = emitPrimitiveVoxel(scaled, voxelGridVar(c.getCode()), colour ? colour[1] : VOXEL_DEFAULT_COLOR);
        c.setCode(replaceVoxelStatement(c.getCode(), part.range, stmt));
        specByName.set(name, scaled);
        registry.set(name, primitiveEntry(scaled));
        appliedAny = true;
      } else if (lang === 'scad') {
        const part = scanParts(c.getCode(), 'scad').find(p => p.name === name);
        if (!part?.range) { skipped.push(name); continue; }
        c.setCode(setPartScaleScad(c.getCode(), part.range, scale));
        bumpRegistryAfterScale(name, scale);
        appliedAny = true;
      } else {
        // manifold-js + replicad
        const code = c.getCode();
        const updated = setPartScaleJs(code, name, scale);
        if (updated === code) { skipped.push(name); continue; }
        c.setCode(updated);
        bumpRegistryAfterScale(name, scale);
        appliedAny = true;
      }
    }
    if (skipped.length > 0) {
      c.showToast(
        skipped.length === names.length
          ? 'Resize could not locate the selected parts in the code.'
          : `Resized ${names.length - skipped.length}; skipped ${skipped.length} (no matching declaration).`,
        { variant: skipped.length === names.length ? 'warn' : 'neutral' },
      );
    }
    if (appliedAny) {
      c.run();
      refreshArrangeOverlay();
    }
  });
}

function fmtScale(s: Vec3): string {
  // Compact "2× / 2×3×1 / 0.5×" rendering for the undo label so the tooltip
  // stays readable. Uniform → one factor; per-axis → triple.
  if (s[0] === s[1] && s[1] === s[2]) return `${s[0]}×`;
  return `${s[0]}×${s[1]}×${s[2]}`;
}

/** For voxel-engine resize, rewrite the spec's dimensions directly — voxel
 *  statements bake their bbox into integer coordinate args, so there's no
 *  `.scale` chain to splice. Rotationally-symmetric primitives can't be split
 *  anisotropically at the grid level, so they take the geometric mean of the
 *  in-plane factors. */
function scaleSpecForVoxel(spec: PrimitiveSpec, s: Vec3): PrimitiveSpec {
  const gm = (...idx: number[]): number => Math.pow(idx.reduce((a, i) => a * s[i], 1), 1 / idx.length);
  switch (spec.kind) {
    case 'cube':
      return { ...spec, size: [spec.size[0] * s[0], spec.size[1] * s[1], spec.size[2] * s[2]] };
    case 'sphere':
      return { ...spec, radius: spec.radius * gm(0, 1, 2) };
    case 'cylinder':
      return { ...spec, radius: spec.radius * gm(0, 1), height: spec.height * s[2] };
    case 'torus':
      return { ...spec, majorRadius: spec.majorRadius * gm(0, 1), tubeRadius: spec.tubeRadius * gm(0, 1, 2) };
    default:
      return spec;
  }
}

/** After a `.scale([sx,sy,sz])` is applied, the part's bbox grows around its
 *  origin. For palette-inserted parts whose spec keeps a known centroid this is
 *  the cleanest update: scale the bbox extents around `entry.center` (the
 *  shape's anchor before any explicit translate). Hand-written parts with no
 *  spec still get a registry update so the overlay tracks them at the new size. */
function bumpRegistryAfterScale(name: string, scale: Vec3): void {
  const entry = registry.get(name);
  if (!entry) return;
  const c = entry.center;
  const min: Vec3 = [
    c[0] + (entry.box.min[0] - c[0]) * scale[0],
    c[1] + (entry.box.min[1] - c[1]) * scale[1],
    c[2] + (entry.box.min[2] - c[2]) * scale[2],
  ];
  const max: Vec3 = [
    c[0] + (entry.box.max[0] - c[0]) * scale[0],
    c[1] + (entry.box.max[1] - c[1]) * scale[1],
    c[2] + (entry.box.max[2] - c[2]) * scale[2],
  ];
  registry.set(name, { box: { min, max }, center: c });
  const spec = specByName.get(name);
  if (spec) {
    // Track the scale in the spec's ambient dimensions where applicable so a
    // follow-up drag emits coordinates consistent with the new size. For
    // shapes without a single dimensions slot we leave the spec unchanged —
    // the bbox above is what arrange-mode actually queries.
    if (spec.kind === 'cube' || spec.kind === 'wedge') {
      spec.size = [spec.size[0] * scale[0], spec.size[1] * scale[1], spec.size[2] * scale[2]];
    }
  }
}

/** Align 2+ selected parts to a common surface (min / center / max) along an
 *  axis. The reference point is the union of all selected bboxes, matching
 *  Tinkercad's "align to selection". For each part we emit the translate delta
 *  through the per-engine path (so e.g. SCAD wraps with a leading `translate`
 *  if there isn't one already). */
function applyAlign(axis: AlignAxis, mode: AlignMode): void {
  if (!cb || selection.size < 2) return;
  const deltas = alignDeltas(selection, registry, axis, mode);
  if (deltas.size === 0) return;
  recordOperation(`Align ${axis.toUpperCase()} ${mode}`, () => {
    let anyApplied = false;
    for (const [name, delta] of deltas) {
      if (writePartTranslateDelta(name, delta)) anyApplied = true;
    }
    if (anyApplied) {
      cb!.run();
      refreshArrangeOverlay();
    }
  });
}

// ---------------------------------------------------------------------------
// Selection state (drives quick-action ops)
// ---------------------------------------------------------------------------

/** Prune any names that no longer exist in the live code. Also drops stale
 *  registry / spec entries so the in-memory state can't outgrow what's actually
 *  in the editor — covers session switches, version rollbacks, and direct code
 *  edits that delete a part. */
function pruneSelection(): void {
  if (!cb) return;
  const valid = new Set(scanParts(cb.getCode(), cb.getLanguage()).map(p => p.name));
  for (const name of selection) if (!valid.has(name)) selection.delete(name);
  for (const name of [...registry.keys()]) if (!valid.has(name)) registry.delete(name);
  for (const name of [...specByName.keys()]) if (!valid.has(name)) specByName.delete(name);
}

function rerenderSelectionUI(): void {
  if (!selectionStripEl) return;
  pruneSelection();
  selectionStripEl.replaceChildren();
  if (selection.size === 0) {
    const hint = document.createElement('span');
    hint.className = 'text-[11px] text-zinc-500 px-1';
    hint.textContent = 'Empty — use 🎯 Select to pick parts in 3D.';
    selectionStripEl.appendChild(hint);
  } else {
    for (const name of selection) {
      const chip = document.createElement('span');
      chip.className =
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-emerald-900/40 border border-emerald-700/50 text-emerald-100';
      chip.textContent = name;
      const x = document.createElement('button');
      x.className = 'text-emerald-200 hover:text-white';
      x.textContent = '×';
      x.title = `Remove ${name} from selection`;
      x.addEventListener('click', () => {
        selection.delete(name);
        rerenderSelectionUI();
      });
      chip.appendChild(x);
      selectionStripEl.appendChild(chip);
    }
  }
  if (quickActionsEl) {
    const enabled = selection.size > 0;
    for (const btn of Array.from(quickActionsEl.querySelectorAll('button'))) {
      btn.disabled = !enabled;
      btn.classList.toggle('opacity-50', !enabled);
      btn.classList.toggle('cursor-not-allowed', !enabled);
    }
  }
  // Size: 1+ selected; Align: 2+ selected. Hidden otherwise so the panel stays
  // dense for the common "nothing selected yet" state.
  sizeSectionEl?.classList.toggle('hidden', selection.size === 0);
  alignSectionEl?.classList.toggle('hidden', selection.size < 2);
  refreshArrangeOverlay();
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function fieldRow(label: string): { row: HTMLElement; controls: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'flex items-center justify-between gap-3';
  const lab = document.createElement('label');
  lab.className = 'text-xs text-zinc-300 shrink-0';
  lab.textContent = label;
  const controls = document.createElement('div');
  controls.className = 'flex items-center gap-1';
  row.appendChild(lab);
  row.appendChild(controls);
  return { row, controls };
}

function numberInput(value: number, width = 'w-16'): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = String(value);
  input.className = `${width} bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 text-right`;
  return input;
}

function numField(parent: HTMLElement, label: string, value: number): () => number {
  const { row, controls } = fieldRow(label);
  const input = numberInput(value);
  controls.appendChild(input);
  parent.appendChild(row);
  return () => parseFloat(input.value) || 0;
}

function vec3Field(parent: HTMLElement, label: string, value: Vec3): () => Vec3 {
  const { row, controls } = fieldRow(label);
  const inputs = value.map(v => {
    const i = numberInput(v, 'w-12');
    controls.appendChild(i);
    return i;
  });
  parent.appendChild(row);
  return () => inputs.map(i => parseFloat(i.value) || 0) as Vec3;
}

function checkField(parent: HTMLElement, label: string, checked: boolean): () => boolean {
  const { row, controls } = fieldRow(label);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.className = 'accent-blue-500 w-4 h-4';
  controls.appendChild(input);
  parent.appendChild(row);
  return () => input.checked;
}

function textField(parent: HTMLElement, label: string, value: string): () => string {
  const { row, controls } = fieldRow(label);
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.className = 'w-32 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100';
  controls.appendChild(input);
  parent.appendChild(row);
  return () => input.value;
}

function selectField(
  parent: HTMLElement,
  label: string,
  options: [value: string, text: string][],
  value: string,
): () => string {
  const { row, controls } = fieldRow(label);
  const sel = document.createElement('select');
  sel.className = 'bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100';
  for (const [val, text] of options) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    if (val === value) opt.selected = true;
    sel.appendChild(opt);
  }
  controls.appendChild(sel);
  parent.appendChild(row);
  return () => sel.value;
}

// ---------------------------------------------------------------------------
// Primitive modals
// ---------------------------------------------------------------------------

function existingNames(): string[] {
  if (!cb) return [];
  return scanParts(cb.getCode(), cb.getLanguage()).map(p => p.name);
}

function intField(parent: HTMLElement, label: string, value: number, min = 3): () => number {
  const { row, controls } = fieldRow(label);
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '1';
  input.min = String(min);
  input.value = String(value);
  input.className = 'w-16 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 text-right';
  controls.appendChild(input);
  parent.appendChild(row);
  return () => Math.max(min, Math.floor(parseFloat(input.value) || min));
}

/** Build the per-kind parameter fields and return a function that constructs
 *  the matching PrimitiveSpec when the user clicks Insert. */
function buildPrimitiveForm(
  body: HTMLElement,
  kind: PrimitiveKind,
): (name: string, position: Vec3) => PrimitiveSpec {
  switch (kind) {
    case 'cube': {
      const getSize = vec3Field(body, 'Size (x, y, z)', [10, 10, 10]);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({ kind: 'cube', name, size: getSize(), center: getCenter(), position });
    }
    case 'sphere': {
      const getRadius = numField(body, 'Radius', 6);
      return (name, position) => ({ kind: 'sphere', name, radius: getRadius(), position });
    }
    case 'cylinder': {
      const getHeight = numField(body, 'Height', 20);
      const getRadius = numField(body, 'Radius', 5);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({
        kind: 'cylinder', name, height: getHeight(), radius: getRadius(), center: getCenter(), position,
      });
    }
    case 'cone': {
      const getHeight = numField(body, 'Height', 20);
      const getR1 = numField(body, 'Bottom radius', 6);
      const getR2 = numField(body, 'Top radius', 0);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({
        kind: 'cone', name, height: getHeight(), radiusBottom: getR1(), radiusTop: getR2(),
        center: getCenter(), position,
      });
    }
    case 'torus': {
      const getMajor = numField(body, 'Major radius (ring)', 12);
      const getTube = numField(body, 'Tube radius', 3);
      const getSeg = intField(body, 'Segments', 48, 4);
      return (name, position) => ({
        kind: 'torus', name, majorRadius: getMajor(), tubeRadius: getTube(), segments: getSeg(), position,
      });
    }
    case 'tube': {
      const getHeight = numField(body, 'Height', 20);
      const getOuter = numField(body, 'Outer radius', 8);
      const getInner = numField(body, 'Inner radius', 5);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({
        kind: 'tube', name, height: getHeight(), outerRadius: getOuter(), innerRadius: getInner(),
        center: getCenter(), position,
      });
    }
    case 'wedge': {
      const getSize = vec3Field(body, 'Size (x, y, z)', [10, 10, 10]);
      const getCenter = checkField(body, 'Center bbox at origin', false);
      return (name, position) => ({ kind: 'wedge', name, size: getSize(), center: getCenter(), position });
    }
    case 'pyramid': {
      const getBase = numField(body, 'Base side', 10);
      const getHeight = numField(body, 'Height', 12);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({
        kind: 'pyramid', name, baseSize: getBase(), height: getHeight(), center: getCenter(), position,
      });
    }
    case 'polygon': {
      const getSides = intField(body, 'Sides', 6, 3);
      const getRadius = numField(body, 'Radius', 6);
      const getHeight = numField(body, 'Height', 10);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({
        kind: 'polygon', name, sides: getSides(), radius: getRadius(), height: getHeight(),
        center: getCenter(), position,
      });
    }
    case 'hemisphere': {
      const getRadius = numField(body, 'Radius', 6);
      const getCenter = checkField(body, 'Center bbox at origin', false);
      return (name, position) => ({
        kind: 'hemisphere', name, radius: getRadius(), center: getCenter(), position,
      });
    }
    case 'tetrahedron': {
      const getSize = numField(body, 'Bounding-cube edge', 10);
      return (name, position) => ({ kind: 'tetrahedron', name, size: getSize(), position });
    }
    case 'star': {
      const getPoints = intField(body, 'Points', 5, 3);
      const getOuter = numField(body, 'Outer radius', 8);
      const getInner = numField(body, 'Inner radius', 3);
      const getHeight = numField(body, 'Height', 6);
      const getCenter = checkField(body, 'Center at origin', true);
      return (name, position) => ({
        kind: 'star', name, points: getPoints(), outerRadius: getOuter(), innerRadius: getInner(),
        height: getHeight(), center: getCenter(), position,
      });
    }
  }
}

function openPrimitiveModal(kind: PrimitiveKind): void {
  if (!cb) return;

  const shell = createModalShell({ title: `Insert ${kind}`, maxWidth: 'sm' });
  const lang = cb.getLanguage();
  const buildSpec = buildPrimitiveForm(shell.body, kind);

  const getPosition = vec3Field(shell.body, 'Position (x, y, z)', [0, 0, 0]);
  const defaultName = uniqueName(baseNameFor(kind), existingNames());
  const getName = textField(shell.body, 'Name', defaultName);

  const cancel = document.createElement('button');
  cancel.className = BUTTON_CANCEL;
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', shell.close);

  const create = document.createElement('button');
  create.className = BUTTON_PRIMARY;
  create.textContent = 'Insert';
  create.addEventListener('click', () => {
    const name = uniqueName(sanitizeName(getName()), existingNames());
    const position = getPosition();
    const spec = buildSpec(name, position);
    shell.close();
    applyPrimitive(spec, lang);
  });

  shell.footer.appendChild(cancel);
  shell.footer.appendChild(create);
}

function applyPrimitive(spec: PrimitiveSpec, lang: InsertLanguage): void {
  if (!cb) return;
  recordOperation(`Insert ${spec.kind} "${spec.name}"`, () => {
    const code = cb!.getCode();

    if (lang === 'scad') {
      cb!.setCode(appendScadStatement(code, emitPrimitive(spec, lang)));
    } else if (lang === 'voxel') {
      // Voxel: scaffold a grid if needed, emit the fill against it, append before
      // the return. Union is implicit (every fill accumulates into the grid).
      const { code: scaffolded, gridVar } = ensureVoxelScaffold(code);
      const stmt = emitPrimitiveVoxel(spec, gridVar, VOXEL_DEFAULT_COLOR);
      cb!.setCode(appendVoxelStatement(scaffolded, stmt));
    } else {
      // manifold-js / replicad: fold the part into the managed visible union
      // (never dropping existing geometry). Auto-combine off inserts the const
      // but leaves the return alone until the user combines explicitly.
      const result = addManagedDeclaration(code, emitPrimitive(spec, lang), {
        lang, addNames: [spec.name], combine: autoCombine,
      });
      cb!.setCode(result.code);
      if (!result.returnSet) {
        cb!.showToast(`Added "${spec.name}" — not shown yet. Union it (or turn on Auto-combine) to combine.`, { variant: 'neutral' });
      }
    }

    registry.set(spec.name, primitiveEntry(spec));
    specByName.set(spec.name, spec);
    cb!.run(cb!.getCode());
  });
}

// ---------------------------------------------------------------------------
// Enclosure inserts (api.enclosure — manifold-js only)
// ---------------------------------------------------------------------------

/** A parametric enclosure insert: a small modal whose Insert builds an
 *  `EnclosureSpec` and an approximate bounding `size` (for 3D-pick). */
function openEnclosureModal(kind: EnclosureKind): void {
  if (!cb) return;
  const modal = createModalShell({ title: `Insert ${kind}`, maxWidth: 'sm' });
  const taken = existingNames();
  let build: (() => { spec: EnclosureSpec; size: Vec3 }) | null = null;

  if (kind === 'box') {
    const getSize = vec3Field(modal.body, 'Outer size (x, y, z)', [60, 40, 30]);
    const getWall = numField(modal.body, 'Wall', 2);
    const getRadius = numField(modal.body, 'Corner radius', 3);
    const getType = selectField(modal.body, 'Lid type', [['lip', 'Lip (press-fit)'], ['screw', 'Screw bosses']], 'lip');
    build = () => {
      const base = uniqueName(ENCLOSURE_BASE_NAME.box, taken);
      const lid = uniqueName('lid', [...taken, base]);
      const size = getSize();
      return { spec: { kind: 'box', base, lid, size, wall: getWall(), radius: getRadius(), type: getType() as 'lip' | 'screw' }, size };
    };
  } else if (kind === 'shell') {
    const getSize = vec3Field(modal.body, 'Outer size (x, y, z)', [40, 40, 25]);
    const getWall = numField(modal.body, 'Wall', 2);
    const getRadius = numField(modal.body, 'Corner radius', 4);
    const getOpen = selectField(modal.body, 'Top', [['top', 'Open top'], ['none', 'Sealed']], 'top');
    const getName = textField(modal.body, 'Name', uniqueName(ENCLOSURE_BASE_NAME.shell, taken));
    build = () => {
      const name = uniqueName(sanitizeName(getName()), taken);
      const size = getSize();
      return { spec: { kind: 'shell', name, size, wall: getWall(), radius: getRadius(), open: getOpen() as 'top' | 'none' }, size };
    };
  } else {
    const getScrew = textField(modal.body, 'Screw size', 'M3');
    const getHeight = numField(modal.body, 'Height', 6);
    const getBore = selectField(modal.body, 'Bore', [['tap', 'Tap (self-tapping)'], ['through', 'Through (clearance)']], 'tap');
    const getName = textField(modal.body, 'Name', uniqueName(ENCLOSURE_BASE_NAME.standoff, taken));
    build = () => {
      const name = uniqueName(sanitizeName(getName()), taken);
      const height = getHeight();
      return { spec: { kind: 'standoff', name, screwSize: getScrew().trim() || 'M3', height, bore: getBore() as 'tap' | 'through' }, size: [8, 8, height] };
    };
  }

  const cancel = document.createElement('button');
  cancel.className = BUTTON_CANCEL;
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', modal.close);

  const create = document.createElement('button');
  create.className = BUTTON_PRIMARY;
  create.textContent = 'Insert';
  create.addEventListener('click', () => {
    const built = build!();
    modal.close();
    applyEnclosure(built.spec, built.size);
  });

  modal.footer.appendChild(cancel);
  modal.footer.appendChild(create);
}

function applyEnclosure(spec: EnclosureSpec, size: Vec3): void {
  if (!cb) return;
  recordOperation(`Insert enclosure ${spec.kind}`, () => {
    const { decl, names } = emitEnclosure(spec);
    // Enclosures are manifold-js only; fold their part(s) into the managed union.
    const result = addManagedDeclaration(cb!.getCode(), decl, {
      lang: 'manifold-js', addNames: names, combine: autoCombine,
    });
    cb!.setCode(result.code);
    // Approximate AABB for 3D-pick: footprint x×y, base on z=0. (Enclosure parts
    // carry no PrimitiveSpec, so they're pickable/operand-able but not draggable
    // in build mode — they're recipe parts, positioned via code.)
    const min: Vec3 = [-size[0] / 2, -size[1] / 2, 0];
    const max: Vec3 = [size[0] / 2, size[1] / 2, size[2]];
    for (const name of names) registry.set(name, { box: { min, max }, center: [0, 0, size[2] / 2] });
    if (!result.returnSet) {
      cb!.showToast(`Added ${names.join(' + ')} — not shown yet. Union to combine.`, { variant: 'neutral' });
    }
    cb!.run(cb!.getCode());
  });
}

// ---------------------------------------------------------------------------
// Geometry registry (for 3D-view operand picking)
// ---------------------------------------------------------------------------

function unionEntries(names: string[]): RegistryEntry | null {
  const entries = names.map(n => registry.get(n)).filter((e): e is RegistryEntry => !!e);
  return unionBoxes(entries);
}

/** Resolve a world-space point to the best-matching registered part name. */
function resolvePartAtPoint(point: Vec3, validNames: Set<string>): string | null {
  return pickPart(point, registry, validNames);
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

interface Operand {
  /** Display label / JS variable / SCAD part name. */
  name: string;
  /** SCAD: the statement (or selection) text that becomes a block child. */
  statement?: string;
  /** SCAD: source character range to splice out (parts and selections both). */
  range?: { from: number; to: number };
  /** JS: a raw expression to use instead of a bare name (wrap-selection). */
  expr?: string;
}

function beginOperation(op: BooleanOpKind): void {
  if (!cb) return;
  // If the selection already has enough parts, skip the operand-picker modal
  // and apply the op immediately. Order matches the selection (insertion order).
  if (selection.size >= 2) {
    const liveParts = scanParts(cb.getCode(), cb.getLanguage());
    const partByName = new Map(liveParts.map(p => [p.name, p]));
    const operands: Operand[] = [];
    for (const name of selection) {
      const part = partByName.get(name);
      if (!part) continue;
      operands.push({ name: part.name, statement: part.statement, range: part.range });
    }
    if (operands.length >= 2) {
      applyOperation(op, operands, cb.getLanguage());
      selection.clear();
      rerenderSelectionUI();
      return;
    }
  }
  openOperationModal(op, []);
}

function openOperationModal(op: BooleanOpKind, operands: Operand[]): void {
  if (!cb) return;
  const lang = cb.getLanguage();
  const shell = createModalShell({ title: `${OP_TITLE[op]} shapes`, maxWidth: 'sm' });

  // --- Selected operands (ordered chips) ---
  const selWrap = document.createElement('div');
  selWrap.className = 'flex flex-col gap-1';
  const selTitle = document.createElement('div');
  selTitle.className = 'text-[10px] uppercase tracking-wider text-zinc-500 font-semibold';
  selTitle.textContent = 'Selected operands';
  selWrap.appendChild(selTitle);
  const chips = document.createElement('div');
  chips.className = 'flex flex-wrap gap-1 min-h-[26px] p-1 bg-zinc-900/60 border border-zinc-700 rounded';
  selWrap.appendChild(chips);
  shell.body.appendChild(selWrap);

  const renderChips = () => {
    chips.replaceChildren();
    if (operands.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'text-[11px] text-zinc-500 px-1';
      empty.textContent = 'None yet — add from the list, the 3D view, or the selection.';
      chips.appendChild(empty);
      return;
    }
    operands.forEach((o, idx) => {
      const chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] bg-blue-900/40 border border-blue-700/50 text-blue-100';
      const baseTag = op === 'subtract' && idx === 0 ? ' (base)' : '';
      chip.textContent = `${o.name}${baseTag}`;
      const x = document.createElement('button');
      x.className = 'text-blue-300 hover:text-white';
      x.textContent = '×';
      x.addEventListener('click', () => {
        operands.splice(idx, 1);
        renderChips();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  };
  renderChips();

  // --- Add from list ---
  const liveParts = scanParts(cb.getCode(), lang);
  const validNames = new Set(liveParts.map(p => p.name));

  const listTitle = document.createElement('div');
  listTitle.className = 'text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mt-1';
  listTitle.textContent = 'Parts in your code';
  shell.body.appendChild(listTitle);

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-1 max-h-40 overflow-y-auto';
  if (liveParts.length === 0) {
    const none = document.createElement('div');
    none.className = 'text-[11px] text-zinc-500';
    none.textContent = 'No parts detected. Insert some shapes first.';
    list.appendChild(none);
  }
  liveParts.forEach(part => {
    const btn = document.createElement('button');
    btn.className = 'text-left text-xs text-zinc-200 px-2 py-1 rounded bg-zinc-700/40 hover:bg-zinc-600 border border-zinc-700 transition-colors truncate';
    btn.textContent = part.name;
    btn.title = part.statement ?? part.name;
    btn.addEventListener('click', () => {
      operands.push({ name: part.name, statement: part.statement, range: part.range });
      renderChips();
    });
    list.appendChild(btn);
  });
  shell.body.appendChild(list);

  // --- Other sources ---
  const sources = document.createElement('div');
  sources.className = 'flex flex-wrap gap-1.5 mt-1';

  const pickBtn = document.createElement('button');
  pickBtn.className = BUTTON_CANCEL + ' text-xs';
  pickBtn.textContent = '🎯 Pick in 3D view';
  pickBtn.title = 'Close this dialog and click shapes in the viewport';
  pickBtn.addEventListener('click', () => {
    shell.close();
    startPickSession(op, operands, validNames);
  });
  sources.appendChild(pickBtn);

  const selBtn = document.createElement('button');
  selBtn.className = BUTTON_CANCEL + ' text-xs';
  selBtn.textContent = '⌷ Use editor selection';
  selBtn.title = 'Add the currently selected code as an operand';
  selBtn.addEventListener('click', () => {
    const sel = cb!.getSelection();
    if (!sel.text.trim()) {
      cb!.showToast('Nothing is selected in the editor.', { variant: 'warn' });
      return;
    }
    operands.push({
      name: `selection (${sel.text.trim().slice(0, 16)}…)`,
      statement: sel.text.trim(),
      range: { from: sel.from, to: sel.to },
      expr: `(${sel.text.trim()})`,
    });
    renderChips();
  });
  sources.appendChild(selBtn);
  shell.body.appendChild(sources);

  // --- Footer ---
  const cancel = document.createElement('button');
  cancel.className = BUTTON_CANCEL;
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', shell.close);

  const create = document.createElement('button');
  create.className = BUTTON_PRIMARY;
  create.textContent = `Create ${OP_TITLE[op].toLowerCase()}`;
  create.addEventListener('click', () => {
    if (operands.length < 2) {
      cb!.showToast('Pick at least two operands.', { variant: 'warn' });
      return;
    }
    shell.close();
    applyOperation(op, operands, lang);
  });

  shell.footer.appendChild(cancel);
  shell.footer.appendChild(create);
}

function applyOperation(op: BooleanOpKind, operands: Operand[], lang: InsertLanguage): void {
  if (!cb) return;
  // Voxel grids union implicitly and can't subtract/intersect whole solids, so
  // the palette hides the Operations row there — guard defensively anyway.
  if (lang === 'voxel') return;
  const code = cb.getCode();
  const resultName = uniqueName(RESULT_BASE[op], existingNames());

  recordOperation(`${op[0].toUpperCase() + op.slice(1)} ${operands.length} parts → ${resultName}`, () => {
    try {
      if (lang === 'scad') {
        const ranges = operands.map(o => o.range).filter((r): r is { from: number; to: number } => !!r);
        const statements = operands.map(o => o.statement ?? o.name);
        if (ranges.length !== operands.length) {
          cb!.showToast('Each SCAD operand must come from the code (list, 3D pick, or selection).', { variant: 'warn' });
          return;
        }
        if (rangesOverlap(ranges)) {
          cb!.showToast('Operands overlap in the code — pick distinct statements.', { variant: 'warn' });
          return;
        }
        const block = emitOperationScad(op, statements, resultName);
        cb!.setCode(replaceScadRanges(code, ranges, block));
      } else {
        // manifold-js / replicad: build `const <result> = a.<op>(b)…;` then fold
        // the result into the managed union *in place of* its operands (so they
        // don't linger in the visible union alongside the merged result).
        const names = operands.map(o => o.expr ?? o.name);
        const snippet = lang === 'replicad'
          ? emitOperationBrep(op, names, resultName)
          : emitOperationJs(op, names, resultName);
        const result = addManagedDeclaration(code, snippet, {
          lang, addNames: [resultName], replaceNames: operands.map(o => o.name), combine: true,
        });
        cb!.setCode(result.code);
      }
    } catch (e) {
      cb!.showToast(e instanceof Error ? e.message : 'Could not create operation.', { variant: 'warn' });
      return;
    }

    const merged = unionEntries(operands.map(o => o.name));
    if (merged) registry.set(resultName, merged);
    cb!.run(cb!.getCode());
    cb!.showToast(`Created "${resultName}".`, { variant: 'success' });
  });
}

function rangesOverlap(ranges: { from: number; to: number }[]): boolean {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 3D-view pick session
// ---------------------------------------------------------------------------

let pickCleanup: (() => void) | null = null;

function startPickSession(op: BooleanOpKind, operands: Operand[], validNames: Set<string>): void {
  if (!cb) return;
  const canvas = cb.getCanvas();
  const camera = cb.getCamera();
  const mesh = cb.getMeshData();
  if (!canvas || !camera || !mesh) {
    cb.showToast('No model to pick from. Run your code first.', { variant: 'warn' });
    openOperationModal(op, operands);
    return;
  }
  if (registry.size === 0) {
    cb.showToast('Nothing is registered for picking. Insert shapes via the palette, then pick them here.', {
      variant: 'warn',
    });
    openOperationModal(op, operands);
    return;
  }

  closeInsertPalette();

  // Floating instruction bar (non-blocking, so canvas stays clickable).
  const bar = document.createElement('div');
  bar.className =
    'fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/95 border border-zinc-600 shadow-xl text-xs text-zinc-100';
  const msg = document.createElement('span');
  const count = () => `Click shapes for ${OP_TITLE[op].toLowerCase()} — ${operands.length} selected`;
  msg.textContent = count();
  bar.appendChild(msg);

  const doneBtn = document.createElement('button');
  doneBtn.className = BUTTON_PRIMARY + ' !py-1';
  doneBtn.textContent = 'Done';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = BUTTON_CANCEL + ' !py-1';
  cancelBtn.textContent = 'Cancel';
  bar.appendChild(doneBtn);
  bar.appendChild(cancelBtn);
  document.body.appendChild(bar);

  const raycaster = new THREE.Raycaster();
  const geometry = meshDataToGeometry(mesh);
  const tempMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  let downX = 0;
  let downY = 0;
  const onDown = (e: PointerEvent) => {
    downX = e.clientX;
    downY = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    // Treat as a click only if the pointer barely moved (so orbit-drag still rotates).
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = raycaster.intersectObject(tempMesh);
    if (hits.length === 0) return;
    const pt: Vec3 = [hits[0].point.x, hits[0].point.y, hits[0].point.z];
    const name = resolvePartAtPoint(pt, validNames);
    if (!name) {
      cb!.showToast('Could not match that spot to an inserted part.', { variant: 'warn' });
      return;
    }
    operands.push({ name, statement: partStatementFor(name), range: partRangeFor(name) });
    msg.textContent = count();
    cb!.showToast(`Added "${name}".`, { variant: 'neutral' });
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  pickCleanup = () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    geometry.dispose();
    (tempMesh.material as THREE.Material).dispose();
    bar.remove();
    pickCleanup = null;
  };

  doneBtn.addEventListener('click', () => {
    pickCleanup?.();
    openOperationModal(op, operands);
  });
  cancelBtn.addEventListener('click', () => {
    pickCleanup?.();
    openOperationModal(op, operands);
  });
}

// SCAD operands need a statement + range; recover them from the live scan by name.
function partStatementFor(name: string): string | undefined {
  if (!cb || cb.getLanguage() !== 'scad') return undefined;
  return scanParts(cb.getCode(), 'scad').find(p => p.name === name)?.statement;
}
function partRangeFor(name: string): { from: number; to: number } | undefined {
  if (!cb || cb.getLanguage() !== 'scad') return undefined;
  return scanParts(cb.getCode(), 'scad').find(p => p.name === name)?.range;
}


// ---------------------------------------------------------------------------
// Multi-select 3D-pick session (Stage B: Tinkercad-style click-to-select)
// ---------------------------------------------------------------------------

let selectSessionCleanup: (() => void) | null = null;

function startSelectMode(): void {
  if (!cb) return;
  if (selectSessionCleanup) return; // already running
  const canvas = cb.getCanvas();
  const camera = cb.getCamera();
  const mesh = cb.getMeshData();
  if (!canvas || !camera || !mesh) {
    cb.showToast('No model to pick from. Run your code first.', { variant: 'warn' });
    return;
  }
  if (registry.size === 0) {
    cb.showToast('Nothing is registered for picking yet. Insert shapes via the palette first.', { variant: 'warn' });
    return;
  }

  const validNames = new Set(scanParts(cb.getCode(), cb.getLanguage()).map(p => p.name));
  // Drop any stale entries (parts that were renamed / deleted in the code).
  for (const name of selection) if (!validNames.has(name)) selection.delete(name);

  // Tuck the palette out of the way so its panel doesn't intercept canvas
  // clicks while the user is picking parts. The strip re-renders on Done.
  closeInsertPalette();

  const scene = getScene();
  const highlightGroup = new THREE.Group();
  scene.add(highlightGroup);

  const refreshHighlights = (): void => {
    // Dispose the wireframes we built last time before swapping them out —
    // otherwise every toggle click leaks one BoxGeometry + LineBasicMaterial.
    while (highlightGroup.children.length > 0) {
      const c = highlightGroup.children[0];
      if (c instanceof THREE.LineSegments) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
      highlightGroup.remove(c);
    }
    for (const name of selection) {
      const entry = registry.get(name);
      if (!entry) continue;
      const sx = entry.box.max[0] - entry.box.min[0];
      const sy = entry.box.max[1] - entry.box.min[1];
      const sz = entry.box.max[2] - entry.box.min[2];
      const geo = new THREE.BoxGeometry(Math.max(0.01, sx), Math.max(0.01, sy), Math.max(0.01, sz));
      const edges = new THREE.EdgesGeometry(geo);
      const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2 }));
      wire.position.set(entry.center[0], entry.center[1], entry.center[2]);
      wire.renderOrder = 999;
      highlightGroup.add(wire);
      geo.dispose();
    }
  };
  refreshHighlights();

  // Floating instruction bar.
  const bar = document.createElement('div');
  bar.className =
    'fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/95 border border-zinc-600 shadow-xl text-xs text-zinc-100';
  const msg = document.createElement('span');
  const updateMsg = (): void => { msg.textContent = `Click shapes to toggle selection — ${selection.size} selected`; };
  updateMsg();
  bar.appendChild(msg);
  const doneBtn = document.createElement('button');
  doneBtn.className = BUTTON_PRIMARY + ' !py-1';
  doneBtn.textContent = 'Done';
  bar.appendChild(doneBtn);
  document.body.appendChild(bar);

  const raycaster = new THREE.Raycaster();
  const geometry = meshDataToGeometry(mesh);
  const tempMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

  let downX = 0;
  let downY = 0;
  const onDown = (e: PointerEvent): void => { downX = e.clientX; downY = e.clientY; };
  const onUp = (e: PointerEvent): void => {
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = raycaster.intersectObject(tempMesh);
    if (hits.length === 0) return;
    const pt: Vec3 = [hits[0].point.x, hits[0].point.y, hits[0].point.z];
    const name = pickPart(pt, registry, validNames);
    if (!name) {
      cb!.showToast('Could not match that spot to an inserted part.', { variant: 'warn' });
      return;
    }
    if (selection.has(name)) selection.delete(name);
    else selection.add(name);
    updateMsg();
    refreshHighlights();
    rerenderSelectionUI();
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  const endSession = (): void => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    geometry.dispose();
    (tempMesh.material as THREE.Material).dispose();
    for (const c of [...highlightGroup.children]) {
      if (c instanceof THREE.LineSegments) {
        c.geometry.dispose();
        (c.material as THREE.Material).dispose();
      }
    }
    highlightGroup.parent?.remove(highlightGroup);
    bar.remove();
    selectSessionCleanup = null;
    // Reopen the palette so the user sees the resulting chip strip + can act on it.
    openInsertPalette();
    rerenderSelectionUI();
  };

  doneBtn.addEventListener('click', endSession);
  selectSessionCleanup = endSession;
}

// ---------------------------------------------------------------------------
// Quick-action ops (Duplicate / Mirror / Delete on selected parts)
// ---------------------------------------------------------------------------

function applyQuickDuplicate(): void {
  if (!cb) return;
  if (selection.size === 0) {
    cb.showToast('Nothing selected — pick parts with 🎯 Select first.', { variant: 'warn' });
    return;
  }
  const c = cb;
  recordOperation(`Duplicate ${selection.size} part${selection.size === 1 ? '' : 's'}`, () => {
  const lang = c.getLanguage();
  // Offset each duplicate along +X by 1.1× the part's X extent so the copy
  // sits next to the original instead of overlapping.
  const newNames: string[] = [];
  for (const name of [...selection]) {
    const entry = registry.get(name);
    const dx = entry ? (entry.box.max[0] - entry.box.min[0]) * 1.1 : 10;
    const offset: Vec3 = [dx, 0, 0];
    let code = c.getCode();
    const newName = uniqueName(`${name}_copy`, existingNames());
    if (lang === 'scad') {
      const part = scanParts(code, 'scad').find(p => p.name === name);
      if (!part?.range) continue;
      code = duplicatePartScad(code, part.range, newName, offset);
    } else if (lang === 'voxel') {
      // Re-emit the fill at the offset position under the new name (the common
      // tail below records its spec/registry, same as the manifold-js path).
      const origSpec = specByName.get(name);
      const part = scanParts(code, 'voxel').find(p => p.name === name);
      if (!origSpec || !part) continue;
      const pos = origSpec.position ?? [0, 0, 0];
      const dupSpec = { ...origSpec, name: newName, position: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]] as Vec3 } as PrimitiveSpec;
      const colour = /'(#[0-9a-fA-F]{3,8})'/.exec(part.statement ?? '');
      code = appendVoxelStatement(code, emitPrimitiveVoxel(dupSpec, voxelGridVar(code), colour ? colour[1] : VOXEL_DEFAULT_COLOR));
    } else {
      // manifold-js + replicad: `const copy = orig.translate([dx,0,0]);`.
      code = duplicatePartJs(code, name, newName, offset);
    }
    c.setCode(code);
    const origSpec = specByName.get(name);
    if (origSpec) {
      const pos = origSpec.position ?? [0, 0, 0];
      const dupSpec = { ...origSpec, name: newName, position: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]] as Vec3 };
      specByName.set(newName, dupSpec);
      registry.set(newName, primitiveEntry(dupSpec));
    } else {
      const orig = registry.get(name);
      if (orig) registry.set(newName, translateEntry(orig, offset));
    }
    newNames.push(newName);
  }
  selection.clear();
  for (const n of newNames) selection.add(n);
  rerenderSelectionUI();
  c.run(c.getCode());
  if (newNames.length > 0) {
    c.showToast(`Duplicated ${newNames.length} part${newNames.length === 1 ? '' : 's'}.`, { variant: 'success' });
  }
  });
}

function openMirrorPicker(): void {
  if (!cb) return;
  if (selection.size === 0) {
    cb.showToast('Nothing selected — pick parts with 🎯 Select first.', { variant: 'warn' });
    return;
  }
  const shell = createModalShell({ title: 'Mirror selection', maxWidth: 'sm' });
  const info = document.createElement('div');
  info.className = 'text-xs text-zinc-300';
  info.textContent = `Flip ${selection.size} part${selection.size === 1 ? '' : 's'} in place across the chosen axis.`;
  shell.body.appendChild(info);
  const row = document.createElement('div');
  row.className = 'flex gap-1.5 mt-2';
  (['x', 'y', 'z'] as MirrorAxis[]).forEach(axis => {
    const btn = document.createElement('button');
    btn.className = BUTTON_PRIMARY;
    btn.textContent = `Mirror ${axis.toUpperCase()}`;
    btn.addEventListener('click', () => {
      shell.close();
      applyQuickMirror(axis);
    });
    row.appendChild(btn);
  });
  shell.body.appendChild(row);

  const cancel = document.createElement('button');
  cancel.className = BUTTON_CANCEL;
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', shell.close);
  shell.footer.appendChild(cancel);
}

function applyQuickMirror(axisKey: MirrorAxis): void {
  if (!cb) return;
  recordOperation(`Mirror ${axisKey.toUpperCase()}`, () => {
    const axis: Vec3 = axisKey === 'x' ? [1, 0, 0] : axisKey === 'y' ? [0, 1, 0] : [0, 0, 1];
    const lang = cb!.getLanguage();
    let count = 0;
    for (const name of [...selection]) {
      let code = cb!.getCode();
      if (lang === 'scad') {
        const part = scanParts(code, 'scad').find(p => p.name === name);
        if (!part?.range) continue;
        code = mirrorPartScad(code, part.range, axis);
      } else {
        code = mirrorPartJs(code, name, axis);
      }
      cb!.setCode(code);
      count++;
    }
    rerenderSelectionUI();
    cb!.run(cb!.getCode());
    if (count > 0) {
      cb!.showToast(`Mirrored ${count} part${count === 1 ? '' : 's'} across ${axisKey.toUpperCase()}.`, { variant: 'success' });
    }
  });
}

function applyQuickDelete(): void {
  if (!cb) return;
  if (selection.size === 0) {
    cb.showToast('Nothing selected — pick parts with 🎯 Select first.', { variant: 'warn' });
    return;
  }
  recordOperation(`Delete ${selection.size} part${selection.size === 1 ? '' : 's'}`, () => {
    const lang = cb!.getLanguage();
    let count = 0;
    for (const name of [...selection]) {
      let code = cb!.getCode();
      if (lang === 'scad' || lang === 'voxel') {
        // Statement engines: drop the tagged statement (re-scan each iteration
        // since prior deletions shift offsets).
        const part = scanParts(code, lang).find(p => p.name === name);
        if (!part?.range) continue;
        code = removeScadStatement(code, part.range);
      } else {
        // manifold-js + replicad: remove the declaration *and* prune the name
        // from the managed union so no dangling reference remains.
        code = removeManagedPart(code, name, lang);
      }
      cb!.setCode(code);
      registry.delete(name);
      specByName.delete(name);
      count++;
    }
    selection.clear();
    rerenderSelectionUI();
    cb!.run(cb!.getCode());
    if (count > 0) {
      cb!.showToast(`Deleted ${count} part${count === 1 ? '' : 's'}.`, { variant: 'success' });
    }
  });
}

function meshDataToGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(mesh.numVert * 3);
  for (let i = 0; i < mesh.numVert; i++) {
    positions[i * 3] = mesh.vertProperties[i * mesh.numProp];
    positions[i * 3 + 1] = mesh.vertProperties[i * mesh.numProp + 1];
    positions[i * 3 + 2] = mesh.vertProperties[i * mesh.numProp + 2];
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.triVerts, 1));
  return geometry;
}
