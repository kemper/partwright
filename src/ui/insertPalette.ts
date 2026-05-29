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
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { getScene, getMeshGroup, setGizmoLock } from '../renderer/viewport';
import {
  emitPrimitive,
  emitOperationJs,
  emitOperationScad,
  scanParts,
  uniqueName,
  sanitizeName,
  baseNameFor,
  type PrimitiveKind,
  type BooleanOpKind,
  type MirrorAxis,
  type PrimitiveSpec,
  type InsertLanguage,
  type Vec3,
} from '../insert/codegen';
import {
  addJsDeclaration,
  appendScadStatement,
  replaceScadRanges,
  setPartTranslateDeltaJs,
  setPartTranslateDeltaScad,
  mirrorPartJs,
  mirrorPartScad,
  duplicatePartJs,
  duplicatePartScad,
  removeJsDeclaration,
  removeScadStatement,
} from '../insert/controller';
import { primitiveEntry, unionBoxes, pickPart, translateEntry, type RegistryEntry } from '../insert/spatial';
import type { MeshData } from '../geometry/types';

export interface InsertPaletteCallbacks {
  getLanguage: () => InsertLanguage;
  getCode: () => string;
  /** Replace the whole document (formats via setValue). */
  setCode: (code: string) => void;
  getSelection: () => { from: number; to: number; text: string };
  run: (code?: string) => void;
  isLocked: () => boolean;
  showToast: (msg: string, opts?: { variant?: 'neutral' | 'warn' | 'success' }) => void;
  getMeshData: () => MeshData | null;
  getCamera: () => THREE.Camera | null;
  getCanvas: () => HTMLCanvasElement | null;
  /** Called right before the panel opens so other overlays (e.g. paint) close. */
  onOpen?: () => void;
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

// Multi-select state: parts the user has marked (via 3D-pick select mode or
// the "+" buttons next to operands) so the quick-action buttons can operate on
// them without going through the operand-picker modal. Persists across panel
// open/close so the user can iterate.
const selection = new Set<string>();
// DOM refs for live UI updates when the selection changes.
let selectionStripEl: HTMLElement | null = null;
let quickActionsEl: HTMLElement | null = null;

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

export function initInsertPalette(container: HTMLElement, callbacks: InsertPaletteCallbacks): void {
  cb = callbacks;

  // The toolbar button. Lives next to Paint / Simplify / Measure in the
  // viewport overlay so it's always visible regardless of editor-pane
  // collapse state — and keeps the `#btn-insert` id existing tests depend on.
  const btn = document.createElement('button');
  btn.id = 'btn-insert';
  btn.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  btn.textContent = '➕ Insert';
  btn.title = 'Insert shapes and boolean operations as code';
  btn.addEventListener('click', toggleInsertPalette);
  // Sit before the paint button when present so the toolbar reads
  // Insert · Paint · Simplify · Measure · …
  const paintBtn = container.querySelector('#paint-toggle');
  if (paintBtn) container.insertBefore(btn, paintBtn);
  else container.appendChild(btn);

  panel = buildPanel();
  container.appendChild(panel);
}

function isInsertPaletteOpen(): boolean {
  return !!panel && !panel.classList.contains('hidden');
}

function openInsertPalette(): void {
  if (!panel) return;
  cb?.onOpen?.();
  panel.classList.remove('hidden');
}

function closeInsertPalette(): void {
  panel?.classList.add('hidden');
}

export function toggleInsertPalette(): void {
  if (isInsertPaletteOpen()) closeInsertPalette();
  else openInsertPalette();
}

/** Show / hide the editor-header Insert button. Called from the language-
 *  change handler so the palette only appears for languages whose codegen we
 *  support (manifold-js + scad) — voxel and replicad sessions hide it. */
export function setInsertPaletteAvailable(available: boolean): void {
  const btn = document.getElementById('btn-insert');
  if (!btn) return;
  btn.classList.toggle('hidden', !available);
  if (!available && isInsertPaletteOpen()) closeInsertPalette();
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
  const p = document.createElement('div');
  p.id = 'insert-palette-panel';
  p.className =
    'hidden absolute top-10 right-2 z-30 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl';
  p.style.minWidth = '220px';
  p.style.maxWidth = '260px';

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between mb-1';
  const title = document.createElement('div');
  title.className = 'text-xs font-semibold text-zinc-100';
  title.textContent = 'Insert';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-400 hover:text-zinc-200 text-xs px-1';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', closeInsertPalette);
  header.appendChild(title);
  header.appendChild(closeBtn);
  p.appendChild(header);

  p.appendChild(sectionLabel('Shapes'));
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
  for (const [kind, label, title] of shapeBtns) {
    shapeRow.appendChild(paletteButton(label, title, () => openPrimitiveModal(kind)));
  }
  p.appendChild(shapeRow);

  // --- Selection strip (chips + Select / Clear buttons) ---
  p.appendChild(sectionLabel('Selection'));
  selectionStripEl = document.createElement('div');
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

  // --- Boolean operations ---
  p.appendChild(sectionLabel('Operations'));
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
  p.appendChild(opRow);

  // --- Quick-edit row (selection-driven) ---
  p.appendChild(sectionLabel('Edit selection'));
  quickActionsEl = document.createElement('div');
  quickActionsEl.className = 'flex flex-wrap gap-1.5';
  quickActionsEl.appendChild(paletteButton('⎘ Duplicate', 'Clone the selected parts (offset along +X)', applyQuickDuplicate));
  quickActionsEl.appendChild(paletteButton('▥ Mirror', 'Flip the selected parts in place', openMirrorPicker));
  quickActionsEl.appendChild(paletteButton('✕ Delete', 'Remove the selected parts from the code', applyQuickDelete));
  p.appendChild(quickActionsEl);

  p.appendChild(sectionLabel('Scene'));
  const editRow = document.createElement('div');
  editRow.className = 'flex flex-wrap gap-1.5';
  editRow.appendChild(
    paletteButton('⛶ Build scene', 'Show the inserted shapes separately and drag them around (Tinkercad-style)', startBuildSession),
  );
  p.appendChild(editRow);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500 leading-tight mt-2';
  hint.textContent = 'New shapes join the scene as a union — use the ops above (or Build) to combine, move, or remove them.';
  p.appendChild(hint);

  // Paint the selection strip and the disabled-state of the quick actions.
  setTimeout(rerenderSelectionUI, 0);

  return p;
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
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }

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
  const snippet = emitPrimitive(spec, lang);
  const code = cb.getCode();

  if (lang === 'scad') {
    cb.setCode(appendScadStatement(code, snippet));
  } else {
    // Primitive inserts are additive by default: if the return is a part
    // chain we extend it with `.add(<newName>)` so adding a second shape
    // doesn't hide the first. A hand-written / complex return is left alone
    // (returnSet=false) and the user gets a hint.
    const result = addJsDeclaration(code, snippet, spec.name, 'addOrReplace');
    cb.setCode(result.code);
    if (!result.returnSet) {
      cb.showToast(
        `Added "${spec.name}". Your existing return is custom — combine it with an operation or edit the code to include "${spec.name}".`,
        { variant: 'neutral' },
      );
    }
  }

  registry.set(spec.name, primitiveEntry(spec));
  specByName.set(spec.name, spec);
  cb.run(cb.getCode());
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
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }
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
  const code = cb.getCode();
  const resultName = uniqueName(RESULT_BASE[op], existingNames());

  try {
    if (lang === 'scad') {
      const ranges = operands.map(o => o.range).filter((r): r is { from: number; to: number } => !!r);
      const statements = operands.map(o => o.statement ?? o.name);
      if (ranges.length !== operands.length) {
        cb.showToast('Each SCAD operand must come from the code (list, 3D pick, or selection).', { variant: 'warn' });
        return;
      }
      if (rangesOverlap(ranges)) {
        cb.showToast('Operands overlap in the code — pick distinct statements.', { variant: 'warn' });
        return;
      }
      const block = emitOperationScad(op, statements, resultName);
      cb.setCode(replaceScadRanges(code, ranges, block));
    } else {
      const names = operands.map(o => o.expr ?? o.name);
      const snippet = emitOperationJs(op, names, resultName);
      const result = addJsDeclaration(code, snippet, resultName, 'force');
      cb.setCode(result.code);
    }
  } catch (e) {
    cb.showToast(e instanceof Error ? e.message : 'Could not create operation.', { variant: 'warn' });
    return;
  }

  const merged = unionEntries(operands.map(o => o.name));
  if (merged) registry.set(resultName, merged);
  cb.run(cb.getCode());
  cb.showToast(`Created "${resultName}".`, { variant: 'success' });
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
// Build mode (Tinkercad-style: inserted shapes shown separately, drag to move)
// ---------------------------------------------------------------------------

let buildCleanup: (() => void) | null = null;

function buildProxyGeometry(spec: PrimitiveSpec): THREE.BufferGeometry {
  switch (spec.kind) {
    case 'cube':
      return new THREE.BoxGeometry(spec.size[0], spec.size[1], spec.size[2]);
    case 'sphere':
      return new THREE.SphereGeometry(spec.radius, 32, 20);
    case 'cylinder': {
      const g = new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 40);
      g.rotateX(Math.PI / 2); // three cylinders are Y-up; our world is Z-up
      return g;
    }
    case 'cone': {
      const g = new THREE.CylinderGeometry(Math.max(spec.radiusTop, 1e-4), spec.radiusBottom, spec.height, 40);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'torus': {
      // Three TorusGeometry lies in XY by default but with Z as the axis of
      // rotational symmetry — that's already our convention.
      const seg = Math.max(4, Math.floor(spec.segments));
      return new THREE.TorusGeometry(spec.majorRadius, spec.tubeRadius, 16, seg);
    }
    case 'tube': {
      // Solid-outer approximation is fine for the proxy (the hole isn't
      // visually critical when dragging).
      const g = new THREE.CylinderGeometry(spec.outerRadius, spec.outerRadius, spec.height, 40);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'wedge': {
      const [x, y, z] = spec.size;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(x, 0);
      shape.lineTo(0, y);
      shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: z, bevelEnabled: false });
      if (spec.center) g.translate(-x / 2, -y / 2, -z / 2);
      return g;
    }
    case 'pyramid': {
      // 4-sided cone = square pyramid (Three rotates the base by π/4 by default,
      // which is fine — proxy just needs to be visually plausible).
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
      // Three's SphereGeometry takes (r, ws, hs, phiStart, phiLength, thetaStart, thetaLength).
      // Default sphere has its polar axis along Y. We want the dome along +Z, so rotate it.
      const g = new THREE.SphereGeometry(spec.radius, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2);
      g.rotateX(Math.PI / 2); // Y-up dome → Z-up dome
      return g;
    }
    case 'tetrahedron': {
      // TetrahedronGeometry's `r` is the circumradius. Our tetrahedron has
      // vertices at the 4 alternating corners of [-s, s]^3, so circumradius = s√3.
      return new THREE.TetrahedronGeometry((spec.size / 2) * Math.sqrt(3));
    }
    case 'star': {
      const n = Math.max(3, Math.floor(spec.points));
      const shape = new THREE.Shape();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? spec.outerRadius : spec.innerRadius;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: spec.height, bevelEnabled: false });
      if (spec.center) g.translate(0, 0, -spec.height / 2);
      return g;
    }
  }
}

function hashHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Enter "build" mode: hide the merged result and show each inserted primitive
 *  as its own draggable proxy. Selecting + dragging a shape rewrites that part's
 *  `translate([…])` in the code. Stage-1 Tinkercad prototype — works on shapes
 *  created via the palette this session (in-memory specs). */
function startBuildSession(): void {
  if (!cb) return;
  if (buildCleanup) { buildCleanup(); }
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }
  const canvas = cb.getCanvas();
  const camera = cb.getCamera();
  if (!canvas || !camera) {
    cb.showToast('No viewport available.', { variant: 'warn' });
    return;
  }

  // Scene objects = palette-created primitives still present in the code.
  const present = new Set(scanParts(cb.getCode(), cb.getLanguage()).map(p => p.name));
  const objects = [...specByName.entries()].filter(([n]) => present.has(n));
  if (objects.length === 0) {
    cb.showToast('Insert shapes with the palette first — Build arranges the shapes you created this session.', {
      variant: 'warn',
    });
    return;
  }

  cb.onOpen?.(); // close paint/simplify so their gizmos don't fight ours
  closeInsertPalette();

  const scene = getScene();
  const meshGroup = getMeshGroup();
  const prevVisible = meshGroup.visible;
  meshGroup.visible = false; // hide the merged result; show separate shapes instead

  const buildGroup = new THREE.Group();
  scene.add(buildGroup);
  const proxyByName = new Map<string, THREE.Mesh>();
  for (const [name, spec] of objects) {
    const geo = buildProxyGeometry(spec);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(`hsl(${hashHue(name)}, 60%, 60%)`),
      transparent: true,
      opacity: 0.85,
      roughness: 0.65,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const c = primitiveEntry(spec).center;
    mesh.position.set(c[0], c[1], c[2]);
    mesh.name = name;
    buildGroup.add(mesh);
    proxyByName.set(name, mesh);
  }

  let selectedName: string | null = null;
  let selectedMesh: THREE.Mesh | null = null;
  let baseline: THREE.Vector3 | null = null;
  let gizmo: TransformControls | null = null;
  let helper: THREE.Object3D | null = null;

  const bar = document.createElement('div');
  bar.className =
    'fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/95 border border-zinc-600 shadow-xl text-xs text-zinc-100';
  const msg = document.createElement('span');
  msg.textContent = 'Build mode — drag a shape to slide it, or click to grab its arrows.';
  bar.appendChild(msg);
  const doneBtn = document.createElement('button');
  doneBtn.className = BUTTON_PRIMARY + ' !py-1';
  doneBtn.textContent = 'Done';
  bar.appendChild(doneBtn);
  document.body.appendChild(bar);

  const setEmissive = (mesh: THREE.Mesh | null, on: boolean): void => {
    if (mesh) (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x2a3f66 : 0x000000);
  };

  const clearSelection = (): void => {
    if (gizmo) { gizmo.detach(); gizmo.dispose(); gizmo = null; }
    if (helper) { helper.parent?.remove(helper); helper = null; }
    setEmissive(selectedMesh, false);
    selectedMesh = null;
    selectedName = null;
    baseline = null;
    setGizmoLock(false);
  };

  /** Persist a position delta for a named part: rewrite the code's translate,
   *  bump the in-memory spec, and shift the registry bbox. Shared by the
   *  gizmo's drop handler and the freehand body-drag below. No-op for sub-
   *  epsilon deltas so a stray click doesn't churn the editor. */
  const writeMoveDelta = (name: string, delta: Vec3): boolean => {
    if (!cb) return false;
    if (Math.abs(delta[0]) < 1e-5 && Math.abs(delta[1]) < 1e-5 && Math.abs(delta[2]) < 1e-5) return false;
    const lang = cb.getLanguage();
    let newCode: string;
    if (lang === 'scad') {
      const part = scanParts(cb.getCode(), 'scad').find(p => p.name === name);
      if (!part?.range) {
        cb.showToast('Could not locate that part in the SCAD code.', { variant: 'warn' });
        return false;
      }
      newCode = setPartTranslateDeltaScad(cb.getCode(), part.range, delta);
    } else {
      newCode = setPartTranslateDeltaJs(cb.getCode(), name, delta);
    }
    cb.setCode(newCode);
    const spec = specByName.get(name);
    if (spec) {
      const p = spec.position ?? [0, 0, 0];
      spec.position = [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]];
    }
    const entry = registry.get(name);
    if (entry) registry.set(name, translateEntry(entry, delta));
    return true;
  };

  const commitMove = (): void => {
    if (!selectedMesh || !baseline || !selectedName) return;
    const delta: Vec3 = [
      selectedMesh.position.x - baseline.x,
      selectedMesh.position.y - baseline.y,
      selectedMesh.position.z - baseline.z,
    ];
    if (writeMoveDelta(selectedName, delta)) {
      baseline = selectedMesh.position.clone();
    }
  };

  /** Cast the pointer ray from the camera onto the horizontal plane Z=z and
   *  return the world-space hit. Used by the body-drag to slide a proxy
   *  freehand along its current Z while keeping the cursor under the spot
   *  where the user grabbed it. */
  const projectToPlaneZ = (clientX: number, clientY: number, z: number): THREE.Vector3 | null => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : null;
  };

  const selectPart = (name: string): void => {
    clearSelection();
    const mesh = proxyByName.get(name);
    if (!mesh) return;
    selectedName = name;
    selectedMesh = mesh;
    baseline = mesh.position.clone();
    setEmissive(mesh, true);

    gizmo = new TransformControls(camera, canvas);
    gizmo.setMode('translate');
    gizmo.setSize(0.9);
    gizmo.attach(mesh);
    helper = gizmo.getHelper();
    scene.add(helper);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gizmo.addEventListener('dragging-changed', (e: any) => {
      setGizmoLock(e.value === true || gizmo!.axis !== null);
      if (e.value === false) commitMove();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gizmo.addEventListener('axis-changed', (e: any) => {
      setGizmoLock(e.value !== null || gizmo!.dragging);
    });

    msg.textContent = `Selected "${name}" — drag the body or the arrows to move. Click another shape to switch.`;
  };

  const raycastProxy = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hits = ray.intersectObjects(buildGroup.children, false);
    return hits.length > 0 ? hits[0].object.name || null : null;
  };

  // Freehand body-drag: pointerdown on a proxy starts a drag that, once the
  // pointer moves past a small threshold, slides the proxy across the Z=
  // currentZ plane so the grabbed point stays under the cursor (Tinkercad-
  // style "drag the body, not the arrows"). A pointerdown that doesn't move
  // far enough is treated as a click → select.
  let downX = 0;
  let downY = 0;
  let bodyDrag: {
    name: string;
    mesh: THREE.Mesh;
    baseline: THREE.Vector3;
    offset: THREE.Vector2; // (worldHit - mesh.position) at pointerdown
    planeZ: number;
    active: boolean;
  } | null = null;

  const onDown = (e: PointerEvent): void => {
    downX = e.clientX; downY = e.clientY;
    // Let the gizmo handle its own axis/plane drag if one is already in
    // flight. We don't check `gizmo.axis` (hover state) because raycastProxy
    // below filters to proxy hits only — a pointerdown on a gizmo arrow
    // misses the proxy, so body-drag never engages and the gizmo takes the
    // event natively.
    if (gizmo?.dragging) return;
    const name = raycastProxy(e.clientX, e.clientY);
    if (!name) return;
    const mesh = proxyByName.get(name);
    if (!mesh) return;
    const worldPt = projectToPlaneZ(e.clientX, e.clientY, mesh.position.z);
    if (!worldPt) return;
    bodyDrag = {
      name,
      mesh,
      baseline: mesh.position.clone(),
      offset: new THREE.Vector2(worldPt.x - mesh.position.x, worldPt.y - mesh.position.y),
      planeZ: mesh.position.z,
      active: false,
    };
    canvas.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent): void => {
    if (!bodyDrag) return;
    if (!bodyDrag.active) {
      // Wait for the pointer to move past the threshold before treating it
      // as a drag — otherwise a steady-handed click becomes a phantom move.
      if (Math.abs(e.clientX - downX) <= 4 && Math.abs(e.clientY - downY) <= 4) return;
      bodyDrag.active = true;
      setGizmoLock(true); // suppress orbit-camera so the drag isn't a fight
      // Make the dragged part the selection (gizmo follows it). selectPart
      // resets `baseline` to the mesh's current position, but we want our
      // pre-drag baseline so the eventual write-back captures the full delta.
      if (selectedName !== bodyDrag.name) {
        selectPart(bodyDrag.name);
        baseline = bodyDrag.baseline.clone();
      }
    }
    const worldPt = projectToPlaneZ(e.clientX, e.clientY, bodyDrag.planeZ);
    if (!worldPt) return;
    bodyDrag.mesh.position.set(
      worldPt.x - bodyDrag.offset.x,
      worldPt.y - bodyDrag.offset.y,
      bodyDrag.planeZ,
    );
  };

  const onUp = (e: PointerEvent): void => {
    // The gizmo's `axis` field is just hover state — `pointermove` parks it
    // on 'X' when the cursor sweeps over an arrow during a body-drag, but the
    // actual drag is ours and must commit. Only defer to the gizmo when an
    // actual gizmo drag is in flight (its own pointer capture is active).
    if (gizmo?.dragging) return;
    if (bodyDrag) {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (bodyDrag.active) {
        // Commit the freehand move.
        const delta: Vec3 = [
          bodyDrag.mesh.position.x - bodyDrag.baseline.x,
          bodyDrag.mesh.position.y - bodyDrag.baseline.y,
          bodyDrag.mesh.position.z - bodyDrag.baseline.z,
        ];
        if (writeMoveDelta(bodyDrag.name, delta)) {
          // Keep the gizmo in sync with the dropped position so the next
          // gizmo drag computes the correct delta.
          if (selectedMesh === bodyDrag.mesh) baseline = bodyDrag.mesh.position.clone();
        }
        setGizmoLock(false);
      } else {
        // No real movement — treat as a click → select.
        selectPart(bodyDrag.name);
      }
      bodyDrag = null;
      return;
    }
    // Pointer never went over a proxy at pointerdown: bare click on empty
    // space below the threshold doesn't do anything (orbit-camera already
    // handled drags above).
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
    const name = raycastProxy(e.clientX, e.clientY);
    if (name) selectPart(name);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);

  const endSession = (): void => {
    clearSelection();
    for (const mesh of proxyByName.values()) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    buildGroup.parent?.remove(buildGroup);
    meshGroup.visible = prevVisible;
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    bar.remove();
    bodyDrag = null;
    buildCleanup = null;
    cb?.run(); // refresh the merged result now that we're back
  };

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') endSession(); };
  document.addEventListener('keydown', onKey);

  doneBtn.addEventListener('click', endSession);
  buildCleanup = endSession;
}

// ---------------------------------------------------------------------------
// Multi-select 3D-pick session (Stage B: Tinkercad-style click-to-select)
// ---------------------------------------------------------------------------

let selectSessionCleanup: (() => void) | null = null;

function startSelectMode(): void {
  if (!cb) return;
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }
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
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }
  if (selection.size === 0) {
    cb.showToast('Nothing selected — pick parts with 🎯 Select first.', { variant: 'warn' });
    return;
  }
  const lang = cb.getLanguage();
  // Offset each duplicate along +X by 1.1× the part's X extent so the copy
  // sits next to the original instead of overlapping.
  const newNames: string[] = [];
  for (const name of [...selection]) {
    const entry = registry.get(name);
    const dx = entry ? (entry.box.max[0] - entry.box.min[0]) * 1.1 : 10;
    const offset: Vec3 = [dx, 0, 0];
    let code = cb.getCode();
    const newName = uniqueName(`${name}_copy`, existingNames());
    if (lang === 'scad') {
      const part = scanParts(code, 'scad').find(p => p.name === name);
      if (!part?.range) continue;
      code = duplicatePartScad(code, part.range, newName, offset);
    } else {
      code = duplicatePartJs(code, name, newName, offset);
    }
    cb.setCode(code);
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
  cb.run(cb.getCode());
  if (newNames.length > 0) {
    cb.showToast(`Duplicated ${newNames.length} part${newNames.length === 1 ? '' : 's'}.`, { variant: 'success' });
  }
}

function openMirrorPicker(): void {
  if (!cb) return;
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }
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
  const axis: Vec3 = axisKey === 'x' ? [1, 0, 0] : axisKey === 'y' ? [0, 1, 0] : [0, 0, 1];
  const lang = cb.getLanguage();
  let count = 0;
  for (const name of [...selection]) {
    let code = cb.getCode();
    if (lang === 'scad') {
      const part = scanParts(code, 'scad').find(p => p.name === name);
      if (!part?.range) continue;
      code = mirrorPartScad(code, part.range, axis);
    } else {
      code = mirrorPartJs(code, name, axis);
    }
    cb.setCode(code);
    count++;
  }
  rerenderSelectionUI();
  cb.run(cb.getCode());
  if (count > 0) {
    cb.showToast(`Mirrored ${count} part${count === 1 ? '' : 's'} across ${axisKey.toUpperCase()}.`, { variant: 'success' });
  }
}

function applyQuickDelete(): void {
  if (!cb) return;
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }
  if (selection.size === 0) {
    cb.showToast('Nothing selected — pick parts with 🎯 Select first.', { variant: 'warn' });
    return;
  }
  const lang = cb.getLanguage();
  let count = 0;
  for (const name of [...selection]) {
    let code = cb.getCode();
    if (lang === 'scad') {
      // Re-scan each iteration since prior deletions shift offsets.
      const part = scanParts(code, 'scad').find(p => p.name === name);
      if (!part?.range) continue;
      code = removeScadStatement(code, part.range);
    } else {
      code = removeJsDeclaration(code, name);
    }
    cb.setCode(code);
    registry.delete(name);
    specByName.delete(name);
    count++;
  }
  selection.clear();
  rerenderSelectionUI();
  cb.run(cb.getCode());
  if (count > 0) {
    cb.showToast(`Deleted ${count} part${count === 1 ? '' : 's'}.`, { variant: 'success' });
  }
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
