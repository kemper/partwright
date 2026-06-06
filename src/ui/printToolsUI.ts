// Print tools overlay — a viewport-overlay button (🖨 Print) that opens a panel
// for the design-for-3D-printing suite: set the build volume, run a printability
// check, scale the model (uniform or scale-to-fit-bed), and split an oversized
// model into bed-sized pieces. Mirrors the simplifyUI structure: a single
// top-right popup that closes the other overlay tools when it opens.
//
// All real work is delegated to handlers injected from main.ts (which own the
// live geometry + version state); this module is pure DOM + presentation.

import type { PrinterSettings } from '../geometry/printerSettings';
import { PRINTER_PRESETS } from '../geometry/printerSettings';
import type { PrintabilityReport } from '../geometry/printability';
import type { ConnectorType } from '../geometry/splitConnectors';
import { viewportToolsMount } from './popoverMenu';

type ActionResult = Record<string, unknown> & { error?: string };

/** Connector settings the panel collects, shared by both split modes. */
export interface ConnectorUI {
  type: ConnectorType;
  size: number;   // ⌀ for dowel/peg/screw, key width for dovetail
  depth: number;
  count: number;
}

export interface PrintToolsHandlers {
  /** Snapshot state + close sibling overlays when the user opens the panel. */
  open(userInitiated: boolean): { hasModel: boolean };
  getSettings(): PrinterSettings;
  setSettings(partial: Partial<PrinterSettings>): PrinterSettings;
  check(): PrintabilityReport | { error: string };
  scaleToFit(): Promise<ActionResult>;
  scaleUniform(factor: number): Promise<ActionResult>;
  /** Auto-cut to fit the build volume (axis-aligned grid). */
  splitAuto(connector: ConnectorUI): Promise<ActionResult>;
  /** Cut along the interactive gizmo plane. */
  splitPlane(connector: ConnectorUI): Promise<ActionResult>;
  /** Show/hide the interactive split-plane gizmo in the viewport. */
  setPlaneGizmo(on: boolean): void;
  /** Switch the gizmo between move and rotate. */
  setPlaneMode(mode: 'translate' | 'rotate'): void;
}

const CONNECTOR_OPTIONS: { id: ConnectorType; label: string }[] = [
  { id: 'dowel', label: 'Dowel pins (holes)' },
  { id: 'peg', label: 'Pegs + sockets' },
  { id: 'screw', label: 'Screw / bolt' },
  { id: 'dovetail', label: 'Dovetail key' },
  { id: 'none', label: 'None (plain cut)' },
];

const BTN_INACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const BTN_ACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';
const ACTION_BTN = 'w-full px-2 py-1.5 rounded text-xs font-medium bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
const SECTION_LABEL = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
const NUM_INPUT = 'w-full px-1.5 py-1 text-xs text-right rounded bg-zinc-900/80 border border-zinc-600/60 text-zinc-200 focus:outline-none focus:border-blue-500/60';
const TAB_ACTIVE = 'flex-1 px-2 py-1 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50';
const TAB_INACTIVE = 'flex-1 px-2 py-1 rounded text-[11px] bg-zinc-800/70 text-zinc-400 border border-zinc-600/50 [@media(hover:hover)]:hover:text-zinc-200';

let printBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let handlers: PrintToolsHandlers | null = null;
let busy = false;

// Form refs.
let presetSel: HTMLSelectElement | null = null;
let bedX: HTMLInputElement | null = null;
let bedY: HTMLInputElement | null = null;
let bedZ: HTMLInputElement | null = null;
let nozzleInput: HTMLInputElement | null = null;
let reportEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let factorInput: HTMLInputElement | null = null;
let splitMode: 'auto' | 'plane' = 'auto';
let splitAutoBtn: HTMLButtonElement | null = null;
let splitPlaneBtn: HTMLButtonElement | null = null;
let planeControlsEl: HTMLElement | null = null;
let connTypeSel: HTMLSelectElement | null = null;
let connSize: HTMLInputElement | null = null;
let connDepth: HTMLInputElement | null = null;
let connCount: HTMLInputElement | null = null;
let splitActionBtn: HTMLButtonElement | null = null;

export function initPrintToolsUI(controlsContainer: HTMLElement, h: PrintToolsHandlers): void {
  handlers = h;

  printBtn = document.createElement('button');
  printBtn.id = 'print-tools-toggle';
  printBtn.className = BTN_INACTIVE;
  printBtn.textContent = '🖨 Print';
  printBtn.title = 'Build volume, printability check, and split for printing';
  printBtn.addEventListener('click', toggle);

  // Mount into the Tools popover alongside paint / palette / image / annotate /
  // surface / resize / quality (falls back to the bar itself if Tools isn't built).
  viewportToolsMount(controlsContainer).appendChild(printBtn);

  panel = buildPanel();
  controlsContainer.appendChild(panel);
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

function openPanel(): void {
  if (!handlers || !panel) return;
  handlers.open(true);
  panel.classList.remove('hidden');
  if (printBtn) printBtn.className = BTN_ACTIVE;
  loadSettingsIntoForm();
  applySplitMode('auto'); // start with the gizmo off
  setStatus('');
  if (reportEl) reportEl.innerHTML = '';
}

function closePanel(): void {
  panel?.classList.add('hidden');
  if (printBtn) printBtn.className = BTN_INACTIVE;
  handlers?.setPlaneGizmo(false); // never leave the gizmo lingering in the viewport
}

function setStatus(text: string): void {
  if (statusEl) statusEl.textContent = text;
}

function currentConnector(): ConnectorUI {
  return {
    type: (connTypeSel?.value as ConnectorType) ?? 'dowel',
    size: Math.max(0.1, Number(connSize?.value) || 5),
    depth: Math.max(0.1, Number(connDepth?.value) || 8),
    count: Math.max(0, Math.min(8, Math.round(Number(connCount?.value) || 2))),
  };
}

/** Toggle between auto (fit-bed grid) and plane (interactive gizmo) split modes. */
function applySplitMode(m: 'auto' | 'plane'): void {
  splitMode = m;
  const plane = m === 'plane';
  if (splitAutoBtn) splitAutoBtn.className = plane ? TAB_INACTIVE : TAB_ACTIVE;
  if (splitPlaneBtn) splitPlaneBtn.className = plane ? TAB_ACTIVE : TAB_INACTIVE;
  if (planeControlsEl) planeControlsEl.style.display = plane ? 'flex' : 'none';
  if (splitActionBtn) splitActionBtn.textContent = plane ? 'Split along plane' : 'Split to fit bed';
  handlers?.setPlaneGizmo(plane);
}

function loadSettingsIntoForm(): void {
  if (!handlers) return;
  const s = handlers.getSettings();
  if (bedX) bedX.value = String(s.bed[0]);
  if (bedY) bedY.value = String(s.bed[1]);
  if (bedZ) bedZ.value = String(s.bed[2]);
  if (nozzleInput) nozzleInput.value = String(s.nozzleWidth);
  // Reflect a matching preset, else "Custom".
  if (presetSel) {
    const match = PRINTER_PRESETS.find(p => p.bed[0] === s.bed[0] && p.bed[1] === s.bed[1] && p.bed[2] === s.bed[2]);
    presetSel.value = match ? match.id : 'custom';
  }
}

function commitSettings(): void {
  if (!handlers) return;
  const bed: [number, number, number] = [
    Number(bedX?.value) || 0,
    Number(bedY?.value) || 0,
    Number(bedZ?.value) || 0,
  ];
  const nozzleWidth = Number(nozzleInput?.value) || 0.4;
  handlers.setSettings({ bed, nozzleWidth });
  if (presetSel) {
    const match = PRINTER_PRESETS.find(p => p.bed[0] === bed[0] && p.bed[1] === bed[1] && p.bed[2] === bed[2]);
    presetSel.value = match ? match.id : 'custom';
  }
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

async function runAction(
  fn: () => Promise<ActionResult> | ActionResult,
  runningMsg: string,
  onSuccess?: (res: ActionResult) => void,
): Promise<void> {
  if (busy) return;
  busy = true;
  setStatus(runningMsg);
  setControlsDisabled(true);
  try {
    const res = await fn();
    if (res && typeof res === 'object' && 'error' in res && res.error) {
      setStatus(res.error as string);
    } else {
      setStatus('');
      onSuccess?.(res); // may set its own success message — runs AFTER the clear
    }
  } catch (e) {
    setStatus(`Failed: ${(e as Error).message}`);
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

function setControlsDisabled(disabled: boolean): void {
  panel?.querySelectorAll('button, input, select').forEach(el => {
    (el as HTMLButtonElement).disabled = disabled;
  });
}

function buildPanel(): HTMLElement {
  const p = document.createElement('div');
  p.id = 'print-tools-panel';
  p.className = 'hidden absolute top-10 right-2 z-20 bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg p-2.5 shadow-xl overflow-y-auto';
  p.style.minWidth = '250px';
  p.style.maxWidth = '290px';
  p.style.maxHeight = '80vh';

  const title = document.createElement('div');
  title.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-2 font-medium';
  title.textContent = 'Print tools';
  p.appendChild(title);

  // ── Build volume ──────────────────────────────────────────────────────────
  const bvLabel = document.createElement('label');
  bvLabel.className = SECTION_LABEL;
  bvLabel.textContent = 'Build volume (mm)';
  p.appendChild(bvLabel);

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
  p.appendChild(presetSel);

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
  p.appendChild(bedRow);

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
  p.appendChild(nozRow);

  // ── Printability ──────────────────────────────────────────────────────────
  const checkBtn = document.createElement('button');
  checkBtn.id = 'print-check-btn';
  checkBtn.className = ACTION_BTN;
  checkBtn.textContent = 'Check printability';
  checkBtn.addEventListener('click', () => {
    if (!handlers || busy) return;
    const r = handlers.check();
    renderReport(r);
  });
  p.appendChild(checkBtn);

  reportEl = document.createElement('div');
  reportEl.id = 'print-report';
  reportEl.className = 'mt-2 mb-1';
  p.appendChild(reportEl);

  // ── Scale ─────────────────────────────────────────────────────────────────
  const divider1 = document.createElement('div');
  divider1.className = 'border-t border-zinc-700/60 my-2.5';
  p.appendChild(divider1);

  const scaleLabel = document.createElement('label');
  scaleLabel.className = SECTION_LABEL;
  scaleLabel.textContent = 'Scale';
  p.appendChild(scaleLabel);

  const fitBtn = document.createElement('button');
  fitBtn.className = `${ACTION_BTN} mb-2`;
  fitBtn.textContent = 'Scale to fit bed';
  fitBtn.title = 'Shrink the model uniformly so it fits the build volume';
  fitBtn.addEventListener('click', () => {
    void runAction(() => handlers!.scaleToFit(), 'Scaling…');
  });
  p.appendChild(fitBtn);

  const factorRow = document.createElement('div');
  factorRow.className = 'flex items-center gap-2 mb-1';
  factorInput = document.createElement('input');
  factorInput.type = 'number'; factorInput.step = '0.1'; factorInput.min = '0.01'; factorInput.value = '1.5';
  factorInput.className = `${NUM_INPUT} flex-1`;
  factorInput.title = 'Uniform scale factor';
  const factorBtn = document.createElement('button');
  factorBtn.className = 'px-2 py-1.5 rounded text-xs bg-zinc-700/70 text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-600/70 transition-colors border border-zinc-600/50 disabled:opacity-40';
  factorBtn.textContent = 'Scale ×';
  factorBtn.addEventListener('click', () => {
    const f = Number(factorInput!.value);
    if (!(f > 0)) { setStatus('Enter a positive scale factor.'); return; }
    void runAction(() => handlers!.scaleUniform(f), 'Scaling…');
  });
  factorRow.appendChild(factorInput); factorRow.appendChild(factorBtn);
  p.appendChild(factorRow);

  // ── Split ─────────────────────────────────────────────────────────────────
  const divider2 = document.createElement('div');
  divider2.className = 'border-t border-zinc-700/60 my-2.5';
  p.appendChild(divider2);

  const splitLabel = document.createElement('label');
  splitLabel.className = SECTION_LABEL;
  splitLabel.textContent = 'Split for printing → parts';
  p.appendChild(splitLabel);

  // Mode tabs: auto (fit-bed grid) vs interactive plane.
  const modeRow = document.createElement('div');
  modeRow.className = 'flex gap-1 mb-2';
  splitAutoBtn = document.createElement('button');
  splitAutoBtn.id = 'print-split-auto';
  splitAutoBtn.className = TAB_ACTIVE;
  splitAutoBtn.textContent = 'Auto (fit bed)';
  splitAutoBtn.addEventListener('click', () => { if (!busy) applySplitMode('auto'); });
  splitPlaneBtn = document.createElement('button');
  splitPlaneBtn.id = 'print-split-plane';
  splitPlaneBtn.className = TAB_INACTIVE;
  splitPlaneBtn.textContent = 'Plane';
  splitPlaneBtn.title = 'Drag / rotate a cutting plane in the viewport';
  splitPlaneBtn.addEventListener('click', () => { if (!busy) applySplitMode('plane'); });
  modeRow.appendChild(splitAutoBtn);
  modeRow.appendChild(splitPlaneBtn);
  p.appendChild(modeRow);

  // Plane move/rotate controls (shown only in plane mode).
  planeControlsEl = document.createElement('div');
  planeControlsEl.className = 'gap-1 mb-2';
  planeControlsEl.style.display = 'none';
  const moveBtn = document.createElement('button');
  moveBtn.className = TAB_ACTIVE;
  moveBtn.textContent = 'Move';
  const rotateBtn = document.createElement('button');
  rotateBtn.className = TAB_INACTIVE;
  rotateBtn.textContent = 'Rotate';
  const setPlaneSub = (mode: 'translate' | 'rotate') => {
    moveBtn.className = mode === 'translate' ? TAB_ACTIVE : TAB_INACTIVE;
    rotateBtn.className = mode === 'rotate' ? TAB_ACTIVE : TAB_INACTIVE;
    handlers?.setPlaneMode(mode);
  };
  moveBtn.addEventListener('click', () => setPlaneSub('translate'));
  rotateBtn.addEventListener('click', () => setPlaneSub('rotate'));
  planeControlsEl.appendChild(moveBtn);
  planeControlsEl.appendChild(rotateBtn);
  p.appendChild(planeControlsEl);

  // Connector controls (shared by both modes).
  const connLabel = document.createElement('label');
  connLabel.className = SECTION_LABEL;
  connLabel.textContent = 'Connector';
  p.appendChild(connLabel);
  connTypeSel = document.createElement('select');
  connTypeSel.className = `${NUM_INPUT} text-left mb-2`;
  for (const o of CONNECTOR_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    connTypeSel.appendChild(opt);
  }
  p.appendChild(connTypeSel);

  const connRow = document.createElement('div');
  connRow.className = 'grid grid-cols-3 gap-1.5 mb-2';
  const mkConn = (val: number, ph: string, title: string): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'number'; i.className = NUM_INPUT; i.value = String(val); i.min = '0'; i.placeholder = ph; i.title = title;
    connRow.appendChild(i);
    return i;
  };
  connSize = mkConn(5, 'Size', 'Connector ⌀ / key width (mm)');
  connDepth = mkConn(8, 'Depth', 'Depth into each side (mm)');
  connCount = mkConn(2, 'Count', 'Number of connectors across the cut');
  p.appendChild(connRow);

  splitActionBtn = document.createElement('button');
  splitActionBtn.id = 'print-split-btn';
  splitActionBtn.className = ACTION_BTN;
  splitActionBtn.textContent = 'Split to fit bed';
  splitActionBtn.title = 'Cut into pieces and add each as a new part';
  splitActionBtn.addEventListener('click', () => {
    const connector = currentConnector();
    const planeMode = splitMode === 'plane';
    void runAction(
      () => (planeMode ? handlers!.splitPlane(connector) : handlers!.splitAuto(connector)),
      'Splitting…',
      (r) => {
        if (typeof r.partCount === 'number') {
          setStatus(`Split into ${r.partCount} part${r.partCount === 1 ? '' : 's'} — added to the parts list.`);
          applySplitMode('auto'); // model is now the first piece; clear the gizmo
        }
      },
    );
  });
  p.appendChild(splitActionBtn);

  statusEl = document.createElement('div');
  statusEl.className = 'text-[11px] text-zinc-400 mt-2 min-h-[14px]';
  p.appendChild(statusEl);

  return p;
}
