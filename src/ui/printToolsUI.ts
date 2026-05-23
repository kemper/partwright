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

type ActionResult = Record<string, unknown> & { error?: string };

export interface PrintToolsHandlers {
  /** Snapshot state + close sibling overlays when the user opens the panel. */
  open(userInitiated: boolean): { hasModel: boolean };
  getSettings(): PrinterSettings;
  setSettings(partial: Partial<PrinterSettings>): PrinterSettings;
  check(): PrintabilityReport | { error: string };
  scaleToFit(): Promise<ActionResult>;
  scaleUniform(factor: number): Promise<ActionResult>;
  split(): Promise<ActionResult>;
}

const BTN_INACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
const BTN_ACTIVE = 'px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs bg-blue-500/20 backdrop-blur text-blue-400 [@media(hover:hover)]:hover:bg-blue-500/30 transition-colors border border-blue-500/30';
const ACTION_BTN = 'w-full px-2 py-1.5 rounded text-xs font-medium bg-blue-500/30 text-blue-200 [@media(hover:hover)]:hover:bg-blue-500/40 transition-colors border border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed';
const SECTION_LABEL = 'block text-[10px] text-zinc-500 uppercase tracking-wider mb-1 font-medium';
const NUM_INPUT = 'w-full px-1.5 py-1 text-xs text-right rounded bg-zinc-900/80 border border-zinc-600/60 text-zinc-200 focus:outline-none focus:border-blue-500/60';

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

export function initPrintToolsUI(controlsContainer: HTMLElement, h: PrintToolsHandlers): void {
  handlers = h;

  printBtn = document.createElement('button');
  printBtn.id = 'print-tools-toggle';
  printBtn.className = BTN_INACTIVE;
  printBtn.textContent = '🖨 Print';
  printBtn.title = 'Build volume, printability check, scale & split for printing';
  printBtn.addEventListener('click', toggle);

  // Sit before Simplify so the strip reads Paint · Print · Simplify · Measure.
  const simplify = controlsContainer.querySelector('#simplify-toggle');
  if (simplify) controlsContainer.insertBefore(printBtn, simplify);
  else controlsContainer.appendChild(printBtn);

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
  setStatus('');
  if (reportEl) reportEl.innerHTML = '';
}

function closePanel(): void {
  panel?.classList.add('hidden');
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

async function runAction(fn: () => Promise<ActionResult> | ActionResult, runningMsg: string): Promise<void> {
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
  splitLabel.textContent = 'Split for printing';
  p.appendChild(splitLabel);

  const splitBtn = document.createElement('button');
  splitBtn.className = ACTION_BTN;
  splitBtn.textContent = 'Split to fit bed';
  splitBtn.title = 'Cut an oversized model into bed-sized pieces with alignment pin holes';
  splitBtn.addEventListener('click', () => {
    void runAction(async () => {
      const r = await handlers!.split();
      if (r && !('error' in r && r.error) && typeof r.partCount === 'number') {
        setStatus(`Split into ${r.partCount} pieces${typeof r.holeCount === 'number' && r.holeCount > 0 ? ` · ${r.holeCount} pin holes` : ''}.`);
      }
      return r;
    }, 'Splitting…');
  });
  p.appendChild(splitBtn);

  statusEl = document.createElement('div');
  statusEl.className = 'text-[11px] text-zinc-400 mt-2 min-h-[14px]';
  p.appendChild(statusEl);

  return p;
}
