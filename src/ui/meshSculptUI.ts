// Mesh Sculpt UI — a self-contained overlay button + floating panel that only
// appears in manifold-js sessions. It mirrors the Voxel Studio layout (tool row
// → brush settings → history → actions) but operates on a smooth triangle mesh:
// pick push/pull/smooth, drag across the model to deform it, then "Apply" bakes
// the sculpted mesh into a new version (exactly like the surface modifiers).

import * as meshSculpt from '../surface/meshSculpt';
import type { SculptTool } from '../surface/meshSculpt';
import { viewportToolsMount } from './popoverMenu';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { createToolPanelHeader, TOOL_TOGGLE_IDLE, TOOL_TOGGLE_ACTIVE } from './toolPanel';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';

const TOOLS: { tool: SculptTool; label: string; title: string }[] = [
  { tool: 'push',   label: '⬆ Push',   title: 'Push — drag to bulge the surface outward along its normal' },
  { tool: 'pull',   label: '⬇ Pull',   title: 'Pull — drag to dent the surface inward' },
  { tool: 'smooth', label: '◠ Smooth', title: 'Smooth — drag to relax bumps toward the local average' },
];

let sculptBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let onActivate: (() => Promise<void> | void) | null = null;
let onDeactivate: (() => Promise<void> | void) | null = null;
let onApply: (() => Promise<void> | void) | null = null;
let active = false;

const registryEntry = { close(): void { if (active) void doDeactivate(); } };

function onStudioEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  if (active) void doDeactivate();
}

// Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z (or Ctrl+Y) redo — only while sculpting,
// and only when the editor isn't focused (so code editing keeps its own undo).
function onSculptKey(e: KeyboardEvent): void {
  if (!active) return;
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (tag === 'textarea' || tag === 'input' || (document.activeElement as HTMLElement)?.isContentEditable) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'z') {
    e.preventDefault();
    if (e.shiftKey) meshSculpt.redo(); else meshSculpt.undo();
    refreshControls();
  } else if (k === 'y') {
    e.preventDefault();
    meshSculpt.redo();
    refreshControls();
  }
}

let toolBtns: Partial<Record<SculptTool, HTMLButtonElement>> = {};
let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
let statusEl: HTMLElement | null = null;
let radiusSlider: HTMLInputElement | null = null;
let radiusLabel: HTMLElement | null = null;
let strengthSlider: HTMLInputElement | null = null;
let strengthLabel: HTMLElement | null = null;

export interface MeshSculptUICallbacks {
  /** Enter the studio. The host calls `meshSculpt.activate(...)` so it can stitch
   *  in the current mesh, the editor lock, and the mesh updater. */
  activate: () => Promise<void> | void;
  /** Cancel sculpting without committing. */
  deactivate: () => Promise<void> | void;
  /** Bake the sculpted mesh into a new version. */
  apply: () => Promise<void> | void;
}

/** Mount the Mesh Sculpt button into the viewport's controls container. */
export function initMeshSculptUI(controlsContainer: HTMLElement, callbacks: MeshSculptUICallbacks): void {
  onActivate = callbacks.activate;
  onDeactivate = callbacks.deactivate;
  onApply = callbacks.apply;

  sculptBtn = document.createElement('button');
  sculptBtn.id = 'mesh-sculpt-toggle';
  sculptBtn.className = `hidden ${TOOL_TOGGLE_IDLE}`;
  sculptBtn.textContent = '🫧 Mesh Sculpt';
  sculptBtn.title = 'Push, pull, and smooth the surface like clay — then bake it to a new version.';
  sculptBtn.addEventListener('click', toggle);

  const toolsMount = viewportToolsMount(controlsContainer);
  const sibling = toolsMount.querySelector('#voxel-paint-toggle') ?? toolsMount.querySelector('#paint-toggle');
  if (sibling) toolsMount.insertBefore(sculptBtn, sibling);
  else toolsMount.appendChild(sculptBtn);

  panel = createPanel();
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(panel);
}

/** Toggle button visibility based on whether the active language is manifold-js. */
export function setMeshSculptAvailable(available: boolean): void {
  if (!sculptBtn) return;
  sculptBtn.classList.toggle('hidden', !available);
  if (!available && active) void doDeactivate();
}

/** Reflect the engine's active state on the toggle button + panel. */
export function syncActiveState(): void {
  const nowActive = meshSculpt.isActive();
  const entered = nowActive && !active;
  const exited = !nowActive && active;
  active = nowActive;
  if (!sculptBtn || !panel) return;
  const wasHidden = sculptBtn.classList.contains('hidden');
  if (active) {
    sculptBtn.className = TOOL_TOGGLE_ACTIVE;
    panel.classList.remove('hidden');
  } else {
    sculptBtn.className = TOOL_TOGGLE_IDLE;
    panel.classList.add('hidden');
  }
  sculptBtn.classList.toggle('hidden', wasHidden);
  if (entered) {
    setInitialPanelPosition(panel);
    openViewportPanel(registryEntry);
    document.addEventListener('keydown', onStudioEscape);
    document.addEventListener('keydown', onSculptKey, { capture: true });
  } else if (exited) {
    document.removeEventListener('keydown', onStudioEscape);
    document.removeEventListener('keydown', onSculptKey, { capture: true } as EventListenerOptions);
    closeViewportPanel(registryEntry);
  }
  refreshControls();
}

function refreshControls(): void {
  const tool = meshSculpt.getTool();
  for (const t of TOOLS) setActive(toolBtns[t.tool], t.tool === tool);

  const diag = meshSculpt.getDiagonal();
  if (radiusSlider) {
    radiusSlider.min = String(diag * 0.02);
    radiusSlider.max = String(diag * 0.4);
    radiusSlider.step = String(Math.max(1e-4, (diag * 0.4) / 100));
    radiusSlider.value = String(meshSculpt.getRadius());
  }
  if (radiusLabel) radiusLabel.textContent = `Size: ${meshSculpt.getRadius().toFixed(2)}`;
  if (strengthSlider) strengthSlider.value = String(Math.round(meshSculpt.getIntensity() * 100));
  if (strengthLabel) strengthLabel.textContent = `Strength: ${Math.round(meshSculpt.getIntensity() * 100)}%`;

  if (undoBtn) undoBtn.disabled = !meshSculpt.canUndo();
  if (redoBtn) redoBtn.disabled = !meshSculpt.canRedo();
  if (statusEl) {
    const tris = meshSculpt.triangleCount();
    statusEl.textContent = `${tris.toLocaleString()} tris`;
  }
}

function setActive(btn: HTMLElement | null | undefined, on: boolean): void {
  if (!btn) return;
  btn.classList.toggle('bg-blue-600', on);
  btn.classList.toggle('text-white', on);
  btn.classList.toggle('border-blue-400', on);
}

async function toggle(): Promise<void> {
  if (active) await doDeactivate();
  else await doActivate();
}

async function doActivate(): Promise<void> {
  if (!onActivate) return;
  await onActivate();
  syncActiveState();
}

async function doDeactivate(): Promise<void> {
  if (!onDeactivate) return;
  await onDeactivate();
  syncActiveState();
}

// ── panel construction ──────────────────────────────────────────────────────

function createPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'mesh-sculpt-panel';
  p.className = 'hidden z-20 flex flex-col overflow-hidden bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl absolute rounded-lg w-56 max-h-[calc(100%-3.5rem)] text-xs text-zinc-200';

  const header = createToolPanelHeader('🫧 Mesh Sculpt', () => { void doDeactivate(); }, 'Close Mesh Sculpt');
  p.appendChild(header);
  attachViewportPanelDrag(header, p);

  const content = document.createElement('div');
  content.className = 'flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-2';
  content.appendChild(buildToolRow());
  content.appendChild(buildBrushSection());
  content.appendChild(buildHistoryRow());
  content.appendChild(buildActions());
  p.appendChild(content);
  return p;
}

function buildToolRow(): HTMLElement {
  toolBtns = {};
  const tools = document.createElement('div');
  tools.className = 'grid grid-cols-3 gap-1';
  for (const t of TOOLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tool = t.tool;
    btn.className = 'px-1 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
    btn.textContent = t.label;
    btn.title = t.title;
    btn.addEventListener('click', () => { meshSculpt.setTool(t.tool); refreshControls(); });
    tools.appendChild(btn);
    toolBtns[t.tool] = btn;
  }
  return tools;
}

function buildBrushSection(): HTMLElement {
  const sec = document.createElement('div');
  sec.className = 'flex flex-col gap-1 pt-1 border-t border-zinc-700/60';

  radiusLabel = document.createElement('span');
  radiusLabel.className = 'text-[11px] text-zinc-400';
  sec.appendChild(radiusLabel);
  radiusSlider = document.createElement('input');
  radiusSlider.type = 'range';
  radiusSlider.className = 'w-full accent-blue-500';
  radiusSlider.title = 'Brush radius in world units';
  radiusSlider.addEventListener('input', () => { meshSculpt.setRadius(Number(radiusSlider!.value)); refreshControls(); });
  sec.appendChild(radiusSlider);

  strengthLabel = document.createElement('span');
  strengthLabel.className = 'text-[11px] text-zinc-400';
  sec.appendChild(strengthLabel);
  strengthSlider = document.createElement('input');
  strengthSlider.type = 'range';
  strengthSlider.min = '0';
  strengthSlider.max = '100';
  strengthSlider.step = '1';
  strengthSlider.className = 'w-full accent-blue-500';
  strengthSlider.title = 'Brush strength';
  strengthSlider.addEventListener('input', () => { meshSculpt.setIntensity(Number(strengthSlider!.value) / 100); refreshControls(); });
  sec.appendChild(strengthSlider);

  const subdivideBtn = document.createElement('button');
  subdivideBtn.type = 'button';
  subdivideBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors';
  subdivideBtn.textContent = '⊞ Subdivide';
  subdivideBtn.title = 'Add resolution (split every triangle into 4) for finer detail — clears the undo history';
  subdivideBtn.addEventListener('click', () => { meshSculpt.subdivide(); refreshControls(); });
  sec.appendChild(subdivideBtn);

  return sec;
}

function buildHistoryRow(): HTMLElement {
  const histRow = document.createElement('div');
  histRow.className = 'flex items-center gap-1 pt-1 border-t border-zinc-700/60';
  undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  undoBtn.textContent = '↺ Undo';
  undoBtn.title = 'Undo the last stroke (⌘/Ctrl+Z)';
  undoBtn.addEventListener('click', () => { meshSculpt.undo(); refreshControls(); });
  histRow.appendChild(undoBtn);
  redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'px-2 py-1 rounded text-xs border border-zinc-600/60 hover:bg-zinc-700/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  redoBtn.textContent = '↻ Redo';
  redoBtn.title = 'Redo the last undone stroke (⇧⌘/Ctrl+Z)';
  redoBtn.addEventListener('click', () => { meshSculpt.redo(); refreshControls(); });
  histRow.appendChild(redoBtn);
  statusEl = document.createElement('span');
  statusEl.className = 'ml-auto text-[11px] text-zinc-500';
  histRow.appendChild(statusEl);
  return histRow;
}

function buildActions(): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'flex flex-col gap-1 pt-1 border-t border-zinc-700/60';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'w-full px-2 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white transition-colors';
  applyBtn.textContent = 'Apply (bake to version)';
  applyBtn.title = 'Bake the sculpted mesh into a new version (Manifold.ofMesh) and save it';
  applyBtn.addEventListener('click', async () => { if (onApply) await onApply(); syncActiveState(); });
  actions.appendChild(applyBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'w-full px-2 py-1 rounded text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.title = 'Discard the sculpt and restore the model';
  cancelBtn.addEventListener('click', async () => { await doDeactivate(); });
  actions.appendChild(cancelBtn);

  return actions;
}
