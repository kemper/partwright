// Print tools overlay — a viewport-overlay button (🖨 Print) mounted in the
// Inspect popover. Opens an informational panel: set the build volume + nozzle,
// then run a printability check on demand. The same check also runs
// automatically on STL / OBJ / 3MF / GLB export and warns via a toast.
// Scaling and splitting live in their own dedicated tools.
//
// Follows the shared viewport-panel conventions: dragable header with a ×
// close button (`attachViewportPanelDrag`), `setInitialPanelPosition` on
// open, registered with `viewportPanelRegistry` so opening another panel
// auto-closes this one, and Escape closes it (skipping when a `[role="dialog"]`
// modal is on top).

import type { PrinterSettings } from '../geometry/printerSettings';
import { PRINTER_PRESETS } from '../geometry/printerSettings';
import type { PrintabilityReport } from '../geometry/printability';
import { viewportInspectMount } from './popoverMenu';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { createToolPanelHeader, TOOL_TOGGLE_IDLE, TOOL_TOGGLE_ACTIVE } from './toolPanel';
import { registerTool, setToolNote, createSuggestionRow, notifyToolApplied, type PrefillSchema, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';

export interface PrintToolsHandlers {
  /** Snapshot state + close sibling overlays when the user opens the panel. */
  open(userInitiated: boolean): { hasModel: boolean };
  getSettings(): PrinterSettings;
  setSettings(partial: Partial<PrinterSettings>): PrinterSettings;
  /** Run the printability check; `overrides` checks unsaved (staged) form
   *  values without saving them. */
  check(overrides?: { bed: [number, number, number]; nozzleWidth: number; overhangAngleDeg: number }): PrintabilityReport | { error: string };
}

const BTN_INACTIVE = TOOL_TOGGLE_IDLE;
const BTN_ACTIVE = TOOL_TOGGLE_ACTIVE;
const ACTION_BTN = 'w-full px-2 py-1.5 rounded text-xs font-medium bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
const SECTION_LABEL = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
const NUM_INPUT = 'w-full px-1.5 py-1 text-xs text-right rounded bg-zinc-900/80 border border-zinc-600/60 text-zinc-200 focus:outline-none focus:border-blue-500/60';

let printBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let handlers: PrintToolsHandlers | null = null;

// Form refs.
let presetSel: HTMLSelectElement | null = null;
let bedX: HTMLInputElement | null = null;
let bedY: HTMLInputElement | null = null;
let bedZ: HTMLInputElement | null = null;
let nozzleInput: HTMLInputElement | null = null;
let overhangInput: HTMLInputElement | null = null;
let contentEl: HTMLElement | null = null;
// Staged (unsaved) settings from an openTool prefill: the form shows them with
// a "Use these settings" row; nothing is saved until the user confirms (or
// edits a field, which commits the whole form like any manual edit).
let stagedRow: HTMLElement | null = null;
let reportEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;

const registryEntry = { close(): void { if (isPrintToolsOpen()) closePanel(); } };

function onPrintEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  // Don't steal Escape from a modal layered on top.
  if (document.querySelector('[role="dialog"]')) return;
  closePanel();
}

export function initPrintToolsUI(controlsContainer: HTMLElement, h: PrintToolsHandlers): void {
  handlers = h;

  printBtn = document.createElement('button');
  printBtn.id = 'print-tools-toggle';
  printBtn.className = BTN_INACTIVE;
  printBtn.textContent = '🖨 Print';
  printBtn.title = 'Build volume + printability check';
  printBtn.addEventListener('click', toggle);

  // Print is read-only analysis — lives in the Inspect popover alongside
  // Measure and Cross-section.
  viewportInspectMount(controlsContainer).appendChild(printBtn);

  panel = buildPanel();
  registerTool({
    id: 'tool-print',
    title: 'Print tools / check printability',
    hint: 'Inspect',
    prefillSchema: PRINT_PREFILL_SCHEMA,
    open: (prefill, ctx) => openPrintWithPrefill(prefill, ctx),
    getState: () => (isPrintToolsOpen() ? readForm() : null),
    isOpen: isPrintToolsOpen,
    close: forceDeactivate,
  });
  // Append to the overlay host (the layout container that positions the
  // floating panels) so position math in setInitialPanelPosition lands in
  // the same coordinate space the other panels use.
  const overlayHost = controlsContainer.parentElement ?? controlsContainer;
  overlayHost.appendChild(panel);
}

export function isPrintToolsOpen(): boolean {
  return !!panel && !panel.classList.contains('hidden');
}

/** Close the panel without side effects. Other overlays call this when they open. */
export function forceDeactivate(): void {
  if (isPrintToolsOpen()) closePanel();
}

function toggle(): void {
  if (isPrintToolsOpen()) closePanel();
  else openPanel();
}

/** Prefill keys for `openTool('tool-print', …)` — staged in the form, saved
 *  only when the user confirms; the printability check is never auto-run. */
const PRINT_PREFILL_SCHEMA: PrefillSchema = {
  bed: { type: 'vec3', description: 'Build volume [x,y,z] in mm (10..2000 each).' },
  nozzleWidth: { type: 'number', min: 0.05, max: 2, description: 'Nozzle diameter (mm).' },
  overhangAngleDeg: { type: 'number', min: 1, max: 89, description: 'Overhang limit, degrees from horizontal (45 = the classic rule).' },
};

/** The form's current values (what the user sees — staged or saved). */
function readForm(): { bed: [number, number, number]; nozzleWidth: number; overhangAngleDeg: number } {
  const s = handlers?.getSettings();
  return {
    bed: [Number(bedX?.value) || s?.bed[0] || 0, Number(bedY?.value) || s?.bed[1] || 0, Number(bedZ?.value) || s?.bed[2] || 0],
    nozzleWidth: Number(nozzleInput?.value) || s?.nozzleWidth || 0.4,
    overhangAngleDeg: Number(overhangInput?.value) || s?.overhangAngleDeg || 45,
  };
}

function clearStaged(): void {
  stagedRow?.remove();
  stagedRow = null;
}

function openPrintWithPrefill(p: Record<string, unknown> | undefined, ctx: ToolOpenContext): ToolOpenResult {
  const pre = p ?? {};
  const bed = pre.bed as [number, number, number] | undefined;
  if (bed && bed.some(n => n < 10 || n > 2000)) return { error: 'bed values must be in [10, 2000] mm' };
  if (!isPrintToolsOpen()) openPanel();
  setToolNote(contentEl, ctx.note, ctx.source);
  if (Object.keys(pre).length === 0) return { applied: {}, ignored: [] };
  if (bed) { bedX!.value = String(bed[0]); bedY!.value = String(bed[1]); bedZ!.value = String(bed[2]); syncPreset(bed); }
  if (pre.nozzleWidth !== undefined && nozzleInput) nozzleInput.value = String(pre.nozzleWidth);
  if (pre.overhangAngleDeg !== undefined && overhangInput) overhangInput.value = String(pre.overhangAngleDeg);
  clearStaged();
  const row = createSuggestionRow({
    text: 'Suggested settings — not saved yet.',
    dismissLabel: 'Discard',
    onDismiss: () => { clearStaged(); loadSettingsIntoForm(); },
    primaryLabel: 'Use these',
    onPrimary: () => { commitSettings(); },
  });
  row.dataset.printStaged = '';
  row.classList.add('mb-3');
  stagedRow = row;
  presetSel?.before(row);
  return { applied: pre, ignored: [] };
}

function syncPreset(bed: [number, number, number]): void {
  if (!presetSel) return;
  const match = PRINTER_PRESETS.find(p => p.bed[0] === bed[0] && p.bed[1] === bed[1] && p.bed[2] === bed[2]);
  presetSel.value = match ? match.id : 'custom';
}

function openPanel(): void {
  if (!handlers || !panel) return;
  setInitialPanelPosition(panel);
  openViewportPanel(registryEntry);
  handlers.open(true);
  panel.classList.remove('hidden');
  document.addEventListener('keydown', onPrintEscape);
  if (printBtn) printBtn.className = BTN_ACTIVE;
  loadSettingsIntoForm();
  setStatus('');
  if (reportEl) reportEl.innerHTML = '';
}

function closePanel(): void {
  clearStaged(); // unconfirmed suggestions don't outlive the panel
  setToolNote(contentEl, null);
  panel?.classList.add('hidden');
  document.removeEventListener('keydown', onPrintEscape);
  closeViewportPanel(registryEntry);
  if (printBtn) printBtn.className = BTN_INACTIVE;
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function loadSettingsIntoForm(): void {
  if (!handlers) return;
  const s = handlers.getSettings();
  if (bedX) bedX.value = String(s.bed[0]);
  if (bedY) bedY.value = String(s.bed[1]);
  if (bedZ) bedZ.value = String(s.bed[2]);
  if (nozzleInput) nozzleInput.value = String(s.nozzleWidth);
  if (overhangInput) overhangInput.value = String(s.overhangAngleDeg);
  // Reflect a matching preset, else "Custom".
  syncPreset(s.bed);
}

function commitSettings(): void {
  if (!handlers) return;
  const bed: [number, number, number] = [
    Number(bedX?.value) || 0,
    Number(bedY?.value) || 0,
    Number(bedZ?.value) || 0,
  ];
  const nozzleWidth = Number(nozzleInput?.value) || 0.4;
  const overhangAngleDeg = Number(overhangInput?.value) || 45;
  const wasStaged = stagedRow !== null;
  handlers.setSettings({ bed, nozzleWidth, overhangAngleDeg });
  syncPreset(bed);
  // A manual edit (or "Use these") saves the whole form, staged values included.
  if (wasStaged) { clearStaged(); notifyToolApplied('tool-print', 'printer settings'); }
}

function dotFor(level: string): string {
  switch (level) {
    case 'pass': return '#4ade80';
    case 'warn': return '#fbbf24';
    case 'fail': return '#f87171';
    default: return '#a1a1aa';
  }
}

function renderReport(report: PrintabilityReport | { error: string }): void {
  if (!reportEl) return;
  reportEl.innerHTML = '';
  if ('error' in report) {
    setStatus(report.error);
    return;
  }
  const banner = document.createElement('div');
  const fails = report.checks.filter(c => c.level === 'fail').length;
  const warns = report.checks.filter(c => c.level === 'warn').length;
  banner.className = `text-xs font-medium mb-2 ${report.ok ? 'text-green-400' : 'text-red-400'}`;
  banner.textContent = report.ok
    ? (warns > 0 ? `Printable — ${warns} thing${warns === 1 ? '' : 's'} to watch.` : 'Looks print-ready.')
    : `${fails} blocker${fails === 1 ? '' : 's'} to fix${warns > 0 ? `, ${warns} warning${warns === 1 ? '' : 's'}` : ''}.`;
  reportEl.appendChild(banner);

  for (const c of report.checks) {
    const row = document.createElement('div');
    row.className = 'flex items-start gap-1.5 mb-1.5';
    const dot = document.createElement('span');
    dot.style.cssText = `flex:none;width:8px;height:8px;border-radius:9999px;margin-top:4px;background:${dotFor(c.level)}`;
    const txt = document.createElement('span');
    txt.className = 'text-[11px] text-zinc-300 leading-snug';
    txt.textContent = c.text;
    row.appendChild(dot);
    row.appendChild(txt);
    reportEl.appendChild(row);
  }
}

function buildPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'print-tools-panel';
  p.className = 'hidden absolute z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg shadow-xl';
  p.style.minWidth = '250px';
  p.style.maxWidth = '290px';

  // Shared tool-panel header (title + × close, common across every tool panel).
  const header = createToolPanelHeader('Print tools', closePanel, 'Close print panel');
  p.appendChild(header);

  // ── Scrollable content area ────────────────────────────────────────────
  const c = document.createElement('div');
  contentEl = c;
  c.className = 'p-2.5 overflow-y-auto';
  c.style.maxHeight = '70vh';
  p.appendChild(c);

  // ── Build volume ──────────────────────────────────────────────────────
  const bvLabel = document.createElement('label');
  bvLabel.className = SECTION_LABEL;
  bvLabel.textContent = 'Build volume (mm)';
  c.appendChild(bvLabel);

  presetSel = document.createElement('select');
  presetSel.className = `${NUM_INPUT} text-left mb-2`;
  for (const opt of [{ id: 'custom', label: 'Custom…' }, ...PRINTER_PRESETS]) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    presetSel.appendChild(o);
  }
  presetSel.addEventListener('change', () => {
    const preset = PRINTER_PRESETS.find(p2 => p2.id === presetSel!.value);
    if (preset) {
      if (bedX) bedX.value = String(preset.bed[0]);
      if (bedY) bedY.value = String(preset.bed[1]);
      if (bedZ) bedZ.value = String(preset.bed[2]);
      commitSettings();
    }
  });
  c.appendChild(presetSel);

  const bedRow = document.createElement('div');
  bedRow.className = 'grid grid-cols-3 gap-1.5 mb-2';
  const mkBed = (ph: string): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'number'; i.className = NUM_INPUT; i.min = '10'; i.placeholder = ph; i.title = `Bed ${ph}`;
    i.addEventListener('change', commitSettings);
    bedRow.appendChild(i);
    return i;
  };
  bedX = mkBed('X'); bedY = mkBed('Y'); bedZ = mkBed('Z');
  c.appendChild(bedRow);

  const nozRow = document.createElement('div');
  nozRow.className = 'flex items-center gap-2 mb-3';
  const nozLabel = document.createElement('span');
  nozLabel.className = 'text-[11px] text-zinc-400 flex-1';
  nozLabel.textContent = 'Nozzle ⌀';
  nozzleInput = document.createElement('input');
  nozzleInput.type = 'number'; nozzleInput.step = '0.1'; nozzleInput.min = '0.05';
  nozzleInput.className = `${NUM_INPUT} w-20`;
  nozzleInput.addEventListener('change', commitSettings);
  nozRow.appendChild(nozLabel); nozRow.appendChild(nozzleInput);
  c.appendChild(nozRow);

  // Overhang limit — feeds the printability check's support warning (was
  // settable only via setPrinterSettings before).
  const ovRow = document.createElement('div');
  ovRow.className = 'flex items-center gap-2 mb-3 -mt-1.5';
  const ovLabel = document.createElement('span');
  ovLabel.className = 'text-[11px] text-zinc-400 flex-1';
  ovLabel.textContent = 'Overhang limit (°)';
  ovLabel.title = 'Downward faces shallower than this (from horizontal) need support. 45 = the classic rule.';
  overhangInput = document.createElement('input');
  overhangInput.type = 'number'; overhangInput.step = '1'; overhangInput.min = '1'; overhangInput.max = '89';
  overhangInput.className = `${NUM_INPUT} w-20`;
  overhangInput.setAttribute('aria-label', 'Overhang limit (degrees)');
  overhangInput.addEventListener('change', commitSettings);
  ovRow.appendChild(ovLabel); ovRow.appendChild(overhangInput);
  c.appendChild(ovRow);

  // ── Printability ─────────────────────────────────────────────────────
  const checkBtn = document.createElement('button');
  checkBtn.id = 'print-check-btn';
  checkBtn.className = ACTION_BTN;
  checkBtn.textContent = 'Check printability';
  checkBtn.addEventListener('click', () => {
    if (!handlers) return;
    // Check what the form shows. Staged (AI-suggested, unsaved) values are
    // checked as overrides — they're saved only via "Use these" / an edit.
    const r = handlers.check(stagedRow ? readForm() : undefined);
    renderReport(r);
  });
  c.appendChild(checkBtn);

  reportEl = document.createElement('div');
  reportEl.id = 'print-report';
  reportEl.className = 'mt-2 mb-1';
  c.appendChild(reportEl);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500 mt-2 leading-snug';
  hint.textContent = 'This check also runs automatically when you export STL / OBJ / 3MF / GLB.';
  c.appendChild(hint);

  statusEl = document.createElement('div');
  statusEl.className = 'text-[10px] text-zinc-400 mt-2 min-h-[14px]';
  c.appendChild(statusEl);

  // Wire dragging via the header — singleton panel, so the resize listener
  // attachViewportPanelDrag registers lives for the page lifetime (no
  // `destroy()` needed).
  attachViewportPanelDrag(header, p);

  return p;
}
