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
  type PrimitiveSpec,
  type InsertLanguage,
  type Vec3,
} from '../insert/codegen';
import { addJsDeclaration, appendScadStatement, replaceScadRanges, setPartTranslateDeltaJs, setPartTranslateDeltaScad } from '../insert/controller';
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
  shapeRow.className = 'flex flex-wrap gap-1.5 mb-1';
  shapeRow.appendChild(paletteButton('◼ Cube', 'Insert a cube / box', () => openPrimitiveModal('cube')));
  shapeRow.appendChild(paletteButton('● Sphere', 'Insert a sphere', () => openPrimitiveModal('sphere')));
  shapeRow.appendChild(paletteButton('▮ Cylinder', 'Insert a cylinder', () => openPrimitiveModal('cylinder')));
  shapeRow.appendChild(paletteButton('▲ Cone', 'Insert a cone', () => openPrimitiveModal('cone')));
  p.appendChild(shapeRow);

  p.appendChild(sectionLabel('Operations'));
  const opRow = document.createElement('div');
  opRow.className = 'flex flex-wrap gap-1.5';
  (['union', 'subtract', 'intersect'] as BooleanOpKind[]).forEach(op => {
    opRow.appendChild(
      paletteButton(OP_LABEL[op], `Combine shapes with ${OP_TITLE[op].toLowerCase()}`, () => beginOperation(op)),
    );
  });
  p.appendChild(opRow);

  p.appendChild(sectionLabel('Edit'));
  const editRow = document.createElement('div');
  editRow.className = 'flex flex-wrap gap-1.5';
  editRow.appendChild(
    paletteButton('⛶ Build scene', 'Show the inserted shapes separately and drag them around (Tinkercad-style)', startBuildSession),
  );
  p.appendChild(editRow);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500 leading-tight mt-2';
  hint.textContent = 'Inserted code targets the active language (JS / SCAD) and renders immediately.';
  p.appendChild(hint);

  return p;
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

function openPrimitiveModal(kind: PrimitiveKind): void {
  if (!cb) return;
  if (cb.isLocked()) {
    cb.showToast('Editor is locked by color regions — unlock to edit code.', { variant: 'warn' });
    return;
  }

  const shell = createModalShell({ title: `Insert ${kind}`, maxWidth: 'sm' });
  const lang = cb.getLanguage();

  // Per-kind dimension fields
  let getSize: (() => Vec3) | null = null;
  let getRadius: (() => number) | null = null;
  let getHeight: (() => number) | null = null;
  let getR1: (() => number) | null = null;
  let getR2: (() => number) | null = null;
  let getCenter: (() => boolean) | null = null;

  if (kind === 'cube') {
    getSize = vec3Field(shell.body, 'Size (x, y, z)', [10, 10, 10]);
    getCenter = checkField(shell.body, 'Center at origin', true);
  } else if (kind === 'sphere') {
    getRadius = numField(shell.body, 'Radius', 6);
  } else if (kind === 'cylinder') {
    getHeight = numField(shell.body, 'Height', 20);
    getRadius = numField(shell.body, 'Radius', 5);
    getCenter = checkField(shell.body, 'Center at origin', true);
  } else if (kind === 'cone') {
    getHeight = numField(shell.body, 'Height', 20);
    getR1 = numField(shell.body, 'Bottom radius', 6);
    getR2 = numField(shell.body, 'Top radius', 0);
    getCenter = checkField(shell.body, 'Center at origin', true);
  }

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
    let spec: PrimitiveSpec;
    if (kind === 'cube') {
      spec = { kind, name, size: getSize!(), center: getCenter!(), position };
    } else if (kind === 'sphere') {
      spec = { kind, name, radius: getRadius!(), position };
    } else if (kind === 'cylinder') {
      spec = { kind, name, height: getHeight!(), radius: getRadius!(), center: getCenter!(), position };
    } else {
      spec = {
        kind,
        name,
        height: getHeight!(),
        radiusBottom: getR1!(),
        radiusTop: getR2!(),
        center: getCenter!(),
        position,
      };
    }
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
    const result = addJsDeclaration(code, snippet, spec.name, 'ifSimple');
    cb.setCode(result.code);
    if (!result.returnSet) {
      cb.showToast(
        `Added "${spec.name}". It isn't shown yet — combine it with an operation or change your return.`,
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
  msg.textContent = 'Build mode — click a shape, then drag to move it.';
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

  const commitMove = (): void => {
    if (!cb || !selectedMesh || !baseline || !selectedName) return;
    const delta: Vec3 = [
      selectedMesh.position.x - baseline.x,
      selectedMesh.position.y - baseline.y,
      selectedMesh.position.z - baseline.z,
    ];
    if (Math.abs(delta[0]) < 1e-5 && Math.abs(delta[1]) < 1e-5 && Math.abs(delta[2]) < 1e-5) return;

    const lang = cb.getLanguage();
    let newCode: string;
    if (lang === 'scad') {
      const part = scanParts(cb.getCode(), 'scad').find(p => p.name === selectedName);
      if (!part?.range) {
        cb.showToast('Could not locate that part in the SCAD code.', { variant: 'warn' });
        return;
      }
      newCode = setPartTranslateDeltaScad(cb.getCode(), part.range, delta);
    } else {
      newCode = setPartTranslateDeltaJs(cb.getCode(), selectedName, delta);
    }
    cb.setCode(newCode);

    const spec = specByName.get(selectedName);
    if (spec) {
      const p = spec.position ?? [0, 0, 0];
      spec.position = [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]];
    }
    const entry = registry.get(selectedName);
    if (entry) registry.set(selectedName, translateEntry(entry, delta));
    baseline = selectedMesh.position.clone();
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

    msg.textContent = `Selected "${name}" — drag to move. Click another shape to switch.`;
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

  let downX = 0;
  let downY = 0;
  const onDown = (e: PointerEvent): void => { downX = e.clientX; downY = e.clientY; };
  const onUp = (e: PointerEvent): void => {
    if (gizmo && (gizmo.dragging || gizmo.axis !== null)) return;
    if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
    const name = raycastProxy(e.clientX, e.clientY);
    if (name) selectPart(name);
  };
  canvas.addEventListener('pointerdown', onDown);
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
    canvas.removeEventListener('pointerup', onUp);
    document.removeEventListener('keydown', onKey);
    bar.remove();
    buildCleanup = null;
    cb?.run(); // refresh the merged result now that we're back
  };

  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') endSession(); };
  document.addEventListener('keydown', onKey);

  doneBtn.addEventListener('click', endSession);
  buildCleanup = endSession;
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
