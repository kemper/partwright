// Part Detection panel (#1025) — split an imported mesh into named parts.
//
// A docked, non-modal tool panel in three steps: START (method, presets,
// detect), REFINE (tools + the part list) and ACCEPT (footer). Every control
// calls the same controller the window.partwright / AI methods use, so the
// two surfaces can't drift. The detector dropdown, its parameter controls and
// its presets are generated from the registry.
//
// Parts own their pins: every part has at least one (automatic pins are
// drawn smaller and see-through). Viewport interaction while the panel is
// open:
//   - hovering the model names the part under the cursor and jumps the list
//     to it; hovering a row highlights the part on the model;
//   - Select tool (V): click a part to select it (Shift/Ctrl-click toggles,
//     Alt-click removes), Shift-drag paints a selection across parts, Esc
//     clears; the action bar merges / solos / locks / colours / deletes;
//   - Pin tool (P): click to add a pin for the chosen part (or a new name);
//     only the parts around it re-grow;
//   - Fix tool (B): drag to paint triangles into a part — fixed triangles
//     stay put when pins move;
//   - in any tool, drag a pin to move it and right-click it to delete it;
//     the eye toggle or holding H hides pins;
//   - clicks are press-and-release without moving, so dragging still orbits
//     (except the Fix brush and Shift-drag select, which own the drag).

import { pickFace } from '../color/facePicker';
import { setDetectPartsEntry } from '../color/paintUI';
import { getConfig } from '../config/appConfig';
import { addPointerSuppressor, getCanvas } from '../renderer/viewport';
import { MAX_EDGE_SMOOTHING, overlayColor } from '../segmentation/draft';
import type { PartDetectionApi } from '../segmentation/partDetection';
import { createSeedMarkers } from '../segmentation/seedMarkers';
import type { ParamSpec } from '../segmentation/types';
import { createColorSwatch } from './colorPickerModal';
import { registerCommands } from './commandPalette';
import { BUTTON_CANCEL, BUTTON_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { createToolPanelShell } from './toolPanel';

let closeOpen: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const INPUT = 'bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[12px] text-zinc-200';
const STEP = 'text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mt-1 flex items-center gap-1.5';
const STEP_NUM = 'w-4 h-4 rounded-full bg-zinc-700 text-zinc-200 text-[10px] flex items-center justify-center';
const SECTION = 'text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mt-1';
const HINT = 'text-[11px] text-zinc-500 leading-snug';
/** Row icon buttons: a full-size touch target around a small glyph. */
const ICON_BTN = 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded text-zinc-500 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/60';
const ICON_BTN_ON = 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded text-blue-300 bg-blue-500/20 [@media(hover:hover)]:hover:bg-blue-500/30';
const TOGGLE_ON = 'px-2 py-1 rounded text-[11px] text-blue-200 bg-blue-500/30 border border-blue-500/50';
const ROW = 'flex items-center gap-1 rounded px-0.5';
const ROW_SELECTED = 'bg-blue-500/15 ring-1 ring-blue-500/40';
const ROW_HOVER = 'bg-zinc-700/50';
/** A press that moves less than this (px) counts as a click, not an orbit. */
const CLICK_SLOP_PX = 6;
/** Holding a pin this long without dragging deletes it (touch has no
 *  right-click). An interaction convention, not a tuning knob. */
const PIN_LONG_PRESS_MS = 600;
/** How long the "Applied preset · Undo" banner stays up (ms). */
const APPLIED_BANNER_MS = 8000;

type Draft = Exclude<ReturnType<PartDetectionApi['getPartDraft']>, { draft: null }>;
type Tool = 'select' | 'pin' | 'fix';

function isDraft(x: unknown): x is Draft {
  return !!x && typeof x === 'object' && Array.isArray((x as Draft).parts);
}

function isTyping(t: EventTarget | null): boolean {
  const n = t as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

export interface PartDetectionPanelOpts {
  /** Context line shown at the top (e.g. what an import just proposed). */
  context?: string;
  /** An alternative next step offered beside the context line (the import
   *  flow's "Convert to code instead"). Closes the panel before running. */
  secondaryAction?: { label: string; run: () => void };
}

export function openPartDetectionPanel(ctl: PartDetectionApi, opts?: PartDetectionPanelOpts): void {
  // Re-opening with a new context (a fresh import) replaces the open panel so
  // the context line is never stale; a plain re-open keeps it as is.
  if (closeOpen) {
    if (!opts?.context) return;
    closeOpen();
  }
  const info = ctl.listPartDetectors();
  const opened = ctl.getPartDraft();
  const proposedBy = isDraft(opened) ? opened.detector : null;
  let tool: Tool = 'select';
  let live = false; // "always manual" default: Live starts off every time
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  let edgeTimer: ReturnType<typeof setTimeout> | null = null;
  let bannerTimer: ReturnType<typeof setTimeout> | null = null;
  let markersOn = true;
  let holdHide = false;
  let lastSyncedRun = '';
  let focusedName: string | null = null;
  /** Edge-length-relative denoise from a synced run (e.g. the "Denoised
   *  scan" preset) — carried into the next Detect while the box is blank. */
  let carriedEdgeLengths: number | null = null;
  const markers = createSeedMarkers();
  const cursorTag = el('div', 'fixed z-30 pointer-events-none px-1.5 py-0.5 rounded text-[11px] text-white bg-zinc-900/90 border border-zinc-600 hidden');
  document.body.appendChild(cursorTag);

  const shell = createToolPanelShell({
    title: 'Detect parts',
    width: 'w-[24rem]',
    onClose: () => {
      unhookPointer();
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onEscape, true);
      getCanvas().removeEventListener('contextmenu', onContextMenu);
      getCanvas().removeEventListener('pointermove', onCanvasHover);
      getCanvas().removeEventListener('pointerleave', onCanvasLeave);
      if (liveTimer) clearTimeout(liveTimer);
      if (edgeTimer) clearTimeout(edgeTimer);
      if (bannerTimer) clearTimeout(bannerTimer);
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      ctl.setHoveredPart(null);
      void ctl.showPresetPreview(null);
      getCanvas().style.cursor = '';
      if (brushing?.timer) clearTimeout(brushing.timer);
      brushing = null;
      // The selection and solo view are the panel's; don't leave the model
      // greyed out with no control on screen.
      ctl.setPartSelection(null);
      ctl.setPartsView({ mode: 'all' });
      cursorTag.remove();
      markers.dispose();
      unsubscribe();
      closeOpen = null;
      // Dismissing an import-time proposal the user never touched means "no
      // thanks" — don't leave its colours on the model with no panel open.
      // An edited draft stays (reopen from Tools → Parts).
      if (opts?.context) {
        const d = ctl.getPartDraft();
        if (isDraft(d) && !d.canUndo && d.detector === proposedBy) void ctl.discardParts();
      }
    },
  });
  closeOpen = shell.close;
  const { body, footer } = shell;

  /** Keep the whole panel (footer included) inside the window: the shell
   *  caps its height relative to its container, not to where it is docked,
   *  so a tall parts list could push Accept/Discard off-screen. */
  function fitToWindow(): void {
    const top = shell.panel.getBoundingClientRect().top;
    shell.panel.style.maxHeight = `${Math.max(240, window.innerHeight - Math.max(0, top) - 8)}px`;
  }
  const onResize = () => fitToWindow();
  window.addEventListener('resize', onResize);
  // The header drag moves the panel; refit when it's dropped.
  shell.panel.addEventListener('pointerup', onResize);

  if (opts?.context) {
    const banner = el('div', 'flex flex-col gap-1.5 rounded border border-zinc-700 bg-zinc-800/60 px-2.5 py-2');
    banner.dataset.partsContext = '';
    banner.appendChild(el('div', 'text-[12px] text-zinc-200 leading-snug', opts.context));
    if (opts.secondaryAction) {
      const action = opts.secondaryAction;
      const alt = el('button', `${BUTTON_SMALL_SECONDARY} min-h-11 md:min-h-0 self-start`, action.label);
      alt.addEventListener('click', () => { shell.close(); action.run(); });
      banner.appendChild(alt);
    }
    body.appendChild(banner);
  }

  function step(n: number, label: string): HTMLElement {
    const h = el('div', STEP);
    h.append(el('span', STEP_NUM, String(n)), el('span', '', label));
    return h;
  }

  // ======================================================== 1. START
  body.appendChild(step(1, 'Start'));
  const algoSelect = el('select', `${INPUT} w-full`);
  algoSelect.setAttribute('aria-label', 'Detection method');
  for (const d of info.detectors) {
    const o = el('option', '', d.name);
    o.value = d.id;
    algoSelect.appendChild(o);
  }
  algoSelect.value = info.detectors.find((d) => d.id === 'auto-merge') ? 'auto-merge' : info.detectors[0].id;
  const algoHint = el('div', HINT);
  body.append(algoSelect, algoHint);

  const presetRow = el('div', 'flex items-center gap-1.5');
  const presetBtn = el('button', BUTTON_SMALL_SECONDARY, '▶ Try presets');
  presetBtn.title = 'Run every preset of this method and show the results side by side, best first. Hover (or ←/→) to preview one on the model; click to apply it.';
  presetBtn.setAttribute('aria-expanded', 'false');
  presetRow.append(presetBtn, el('span', HINT, 'hover to preview · click to apply'));
  const stripWrap = el('div', 'shrink-0 flex items-start gap-1 hidden');
  const strip = el('div', 'flex-1 min-w-0 flex gap-1.5 overflow-x-auto pb-1');
  strip.setAttribute('role', 'listbox');
  strip.setAttribute('aria-label', 'Preset results');
  strip.setAttribute('aria-orientation', 'horizontal');
  const stripClose = el('button', ICON_BTN, '✕');
  stripClose.title = 'Close presets (Esc)';
  stripClose.setAttribute('aria-label', 'Close presets');
  stripWrap.append(strip, stripClose);
  const appliedBanner = el('div', 'hidden flex items-center gap-2 text-[11px] text-emerald-200 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1');
  body.append(presetRow, stripWrap, appliedBanner);

  const paramBox = el('div', 'flex flex-col gap-1.5');
  body.appendChild(paramBox);
  const paramInputs = new Map<string, { get: () => unknown; set: (v: unknown) => void }>();
  const smoothInput = el('input', `${INPUT} w-20`);
  smoothInput.type = 'number';
  smoothInput.min = '0';
  smoothInput.step = 'any';
  smoothInput.placeholder = 'none';
  smoothInput.addEventListener('change', () => { carriedEdgeLengths = null; scheduleLive(); });

  const detectorOf = (id: string) => info.detectors.find((x) => x.id === id)!;

  function paramRow(label: string, hint: string, ...controls: HTMLElement[]): HTMLElement {
    const row = el('label', 'flex items-center justify-between gap-2');
    row.title = hint;
    const right = el('span', 'flex items-center gap-1.5');
    right.append(...controls);
    row.append(el('span', 'text-[12px] text-zinc-300 shrink-0', label), right);
    return row;
  }

  function buildParams(values?: Record<string, unknown>): void {
    const d = detectorOf(algoSelect.value);
    algoHint.textContent = `${d.description} Best for: ${d.bestFor}`;
    paramBox.replaceChildren();
    paramInputs.clear();
    d.params.forEach((p: ParamSpec) => {
      const init = values && p.key in values ? values[p.key] : p.default;
      if (p.type === 'enum') {
        const s = el('select', INPUT);
        for (const opt of p.options ?? []) { const o = el('option', '', opt); o.value = opt; s.appendChild(o); }
        s.value = String(init);
        s.addEventListener('change', () => scheduleLive());
        paramInputs.set(p.key, { get: () => s.value, set: (v) => { s.value = String(v); } });
        paramBox.appendChild(paramRow(p.label, p.hint, s));
      } else if (p.type === 'boolean') {
        const c = el('input');
        c.type = 'checkbox';
        c.checked = Boolean(init);
        c.addEventListener('change', () => scheduleLive());
        paramInputs.set(p.key, { get: () => c.checked, set: (v) => { c.checked = Boolean(v); } });
        paramBox.appendChild(paramRow(p.label, p.hint, c));
      } else {
        const n = el('input', `${INPUT} w-16`);
        n.type = 'number';
        n.value = String(init);
        n.step = p.step !== undefined ? String(p.step) : p.type === 'integer' ? '1' : 'any';
        if (p.min !== undefined) n.min = String(p.min);
        if (p.max !== undefined) n.max = String(p.max);
        n.setAttribute('aria-label', p.label);
        const controls: HTMLElement[] = [n];
        let range: HTMLInputElement | null = null;
        if (p.min !== undefined && p.max !== undefined) {
          // Bounded numbers get a slider too (Live updates as it moves).
          range = el('input', 'w-24 accent-blue-500');
          range.type = 'range';
          range.min = String(p.min); range.max = String(p.max); range.step = n.step === 'any' ? String((p.max - p.min) / 100) : n.step;
          range.value = String(init);
          range.setAttribute('aria-label', `${p.label} slider`);
          range.addEventListener('input', () => { n.value = range!.value; scheduleLive(); });
          controls.unshift(range);
        }
        n.addEventListener('change', () => { if (range) range.value = n.value; scheduleLive(); });
        paramInputs.set(p.key, {
          get: () => Number(n.value),
          set: (v) => { n.value = String(v); if (range) range.value = String(v); },
        });
        paramBox.appendChild(paramRow(p.label, p.hint, ...controls));
      }
    });
    paramBox.appendChild(paramRow('Surface smoothing', 'World-unit radius used to denoise normals before measuring grooves. Blank = none (default); try ~3× the edge length on very noisy scans.', smoothInput));
    presetRow.classList.toggle('hidden', !(d.presets?.length));
    if (!d.presets?.length) setStripOpen(false);
    renderStrip();
  }

  const actionRow = el('div', 'flex items-center gap-2');
  const detectBtn = el('button', BUTTON_PRIMARY, 'Detect');
  const liveLabel = el('label', 'flex items-center gap-1 text-[12px] text-zinc-300 shrink-0');
  liveLabel.title = 'Re-run detection automatically after each setting change. Off by default — turn it on when the model is quick to detect. (Pin edits always update right away.)';
  const liveBox = el('input');
  liveBox.type = 'checkbox';
  liveBox.checked = false;
  liveLabel.append(liveBox, el('span', '', 'Live'));
  const cancelBtn = el('button', `${BUTTON_CANCEL} hidden`, 'Cancel');
  const status = el('div', 'text-[11px] text-zinc-400 flex-1 truncate');
  status.setAttribute('aria-live', 'polite');
  actionRow.append(detectBtn, liveLabel, cancelBtn, status);
  const needPinsHint = el('div', `${HINT} hidden`, 'This method grows parts from pins: pick the Pin tool below and click the model once or more per part, then Detect.');
  body.append(actionRow, needPinsHint);

  function detectOptions(algorithm = algoSelect.value): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const [k, io] of paramInputs) params[k] = io.get();
    const opts: Record<string, unknown> = { algorithm, params };
    if (smoothInput.value.trim() !== '') opts.featureOptions = { normalSmoothRadius: Number(smoothInput.value) };
    else if (carriedEdgeLengths) opts.featureOptions = { normalSmoothEdgeLengths: carriedEdgeLengths };
    if (detectorOf(algorithm).seeds !== 'none') opts.seeds = ctl.getSeeds();
    return opts;
  }

  async function runDetect(): Promise<void> {
    const d = detectorOf(algoSelect.value);
    if (d.seeds === 'required' && ctl.getSeeds().length === 0) {
      showToast('Place at least one pin first (Pin tool)', { variant: 'neutral', source: 'parts' });
      setTool('pin');
      return;
    }
    const r = await ctl.detectParts(detectOptions());
    if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
  }

  function scheduleLive(): void {
    if (!live) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (ctl.isBusy()) { scheduleLive(); return; }
      const d = detectorOf(algoSelect.value);
      if (d.seeds === 'required' && ctl.getSeeds().length === 0) return;
      void runDetect();
    }, getConfig().segmentation.liveDebounceMs);
  }

  detectBtn.addEventListener('click', () => { void runDetect(); });
  liveBox.addEventListener('change', () => { live = liveBox.checked; if (live) scheduleLive(); });
  cancelBtn.addEventListener('click', () => ctl.cancel());

  // --- Presets strip ------------------------------------------------------------
  let stripOpen = false;
  function setStripOpen(open: boolean): void {
    stripOpen = open;
    stripWrap.classList.toggle('hidden', !open);
    presetBtn.setAttribute('aria-expanded', String(open));
    presetBtn.textContent = open ? '▼ Presets' : '▶ Try presets';
    if (!open) void ctl.showPresetPreview(null);
  }
  presetBtn.addEventListener('click', async () => {
    if (stripOpen) { setStripOpen(false); return; }
    setStripOpen(true);
    const p = ctl.getPresetPreviews();
    if (p && p.algorithm === algoSelect.value && p.items.length) { renderStrip(); return; }
    const r = await ctl.previewPartPresets({ algorithm: algoSelect.value, image: false });
    if ('error' in r) { showToast(String(r.error), { variant: 'warn', source: 'parts' }); setStripOpen(false); }
  });
  stripClose.addEventListener('click', () => setStripOpen(false));

  /** Identity of the rendered tiles: rebuild only when the results change,
   *  otherwise just move the selection (rebuilding under the pointer would
   *  re-fire mouseenter and loop). */
  let stripKey = '';
  function renderStrip(): void {
    const p = ctl.getPresetPreviews();
    const show = !!p && p.algorithm === algoSelect.value && p.items.length > 0;
    const key = show ? `${p!.algorithm}:${p!.items.map((x) => x.name).join('|')}` : '';
    if (key !== stripKey) {
      stripKey = key;
      strip.replaceChildren();
      if (show) p!.items.forEach((item, i) => strip.appendChild(presetTile(item, i)));
    }
    const current = ctl.getPreviewIndex();
    strip.querySelectorAll<HTMLButtonElement>('button[data-index]').forEach((tile) => {
      const on = Number(tile.dataset.index) === current;
      tile.setAttribute('aria-selected', String(on));
      tile.classList.toggle('border-blue-400', on);
      tile.classList.toggle('bg-blue-500/10', on);
      tile.classList.toggle('border-zinc-700', !on);
      tile.classList.toggle('bg-zinc-900/60', !on);
    });
  }

  function presetTile(item: NonNullable<ReturnType<PartDetectionApi['getPresetPreviews']>>['items'][number], i: number): HTMLButtonElement {
    const tile = el('button', 'shrink-0 flex flex-col items-center gap-0.5 rounded p-1 border border-zinc-700 bg-zinc-900/60 [@media(hover:hover)]:hover:border-zinc-400');
    tile.setAttribute('role', 'option');
    tile.title = `${item.name}: ${item.summary.parts.length} parts, boundary groove ${item.summary.quality.boundaryCreaseMean.toFixed(1)}°. Click to apply.`;
    tile.dataset.index = String(i);
    if (item.image) {
      const img = el('img', 'w-[5.5rem] h-[5.5rem] object-contain rounded');
      img.src = item.image;
      img.alt = item.name;
      tile.appendChild(img);
    }
    tile.append(
      el('span', 'text-[10px] text-zinc-200 max-w-[5.5rem] truncate', `${i === 0 ? '★ ' : ''}${item.name}`),
      el('span', 'text-[10px] text-zinc-500', `${item.summary.parts.length} parts`),
    );
    tile.addEventListener('mouseenter', () => { void ctl.showPresetPreview(i); });
    tile.addEventListener('focus', () => { void ctl.showPresetPreview(i); });
    tile.addEventListener('click', async () => {
      const name = item.name;
      setStripOpen(false);
      const r = await ctl.applyPartPreset(i);
      if ('error' in r) { showToast(String(r.error), { variant: 'warn', source: 'parts' }); return; }
      // Undo only makes sense when the preset replaced an earlier draft.
      if ('canUndo' in r && r.canUndo) showAppliedBanner(name);
    });
    return tile;
  }
  strip.addEventListener('mouseleave', () => {
    if (!strip.contains(document.activeElement)) void ctl.showPresetPreview(null);
  });
  strip.addEventListener('focusout', (e) => {
    if (!strip.contains(e.relatedTarget as Node | null)) void ctl.showPresetPreview(null);
  });
  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setStripOpen(false); presetBtn.focus(); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tiles = [...strip.querySelectorAll<HTMLButtonElement>('button[data-index]')];
    if (!tiles.length) return;
    e.preventDefault();
    const cur = ctl.getPreviewIndex() ?? -1;
    const next = e.key === 'ArrowRight' ? Math.min(tiles.length - 1, cur + 1) : Math.max(0, cur - 1);
    tiles[next].focus();
    tiles[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  function showAppliedBanner(name: string): void {
    appliedBanner.replaceChildren();
    const undo = el('button', BUTTON_SMALL_SECONDARY, 'Undo');
    undo.addEventListener('click', async () => {
      appliedBanner.classList.add('hidden');
      await edit([{ op: 'undo' }]);
    });
    appliedBanner.append(el('span', 'flex-1', `Applied preset “${name}”.`), undo);
    appliedBanner.classList.remove('hidden');
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => appliedBanner.classList.add('hidden'), APPLIED_BANNER_MS);
  }

  // ======================================================== 2. REFINE
  body.appendChild(step(2, 'Refine'));
  const toolRow = el('div', 'flex items-center gap-1.5 flex-wrap');
  const toolBtns: Record<Tool, HTMLButtonElement> = {
    select: el('button', BUTTON_SMALL_SECONDARY, 'Select (V)'),
    pin: el('button', BUTTON_SMALL_SECONDARY, 'Pin (P)'),
    fix: el('button', BUTTON_SMALL_SECONDARY, 'Fix (B)'),
  };
  toolBtns.select.title = 'Click parts on the model to select them; Shift-drag to paint-select';
  toolBtns.pin.title = 'Click the model to add a pin for a part (or a new part)';
  toolBtns.fix.title = 'Drag on the model to paint triangles into a part; fixed triangles stay put';
  const markerBtn = el('button', ICON_BTN_ON, '👁');
  markerBtn.title = 'Show/hide pins (or hold H)';
  markerBtn.setAttribute('aria-label', 'Toggle pins');
  markerBtn.setAttribute('aria-pressed', 'true');
  const soloBtn = el('button', BUTTON_SMALL_SECONDARY, 'Solo (S)');
  soloBtn.title = 'Show only the selected parts in colour; everything else grey';
  soloBtn.setAttribute('aria-pressed', 'false');
  toolRow.append(toolBtns.select, toolBtns.pin, toolBtns.fix, soloBtn, markerBtn);
  const toolHint = el('div', HINT);
  // Pin / Fix target part.
  const targetRow = el('div', 'flex items-center gap-1.5');
  const targetLabel = el('span', 'text-[12px] text-zinc-300 shrink-0', 'Part:');
  const targetInput = el('input', `${INPUT} flex-1 min-w-0`);
  targetInput.setAttribute('list', 'parts-target-list');
  targetInput.placeholder = 'part name (new name = new part)';
  targetInput.setAttribute('aria-label', 'Target part');
  const targetList = el('datalist');
  targetList.id = 'parts-target-list';
  const brushRange = el('input', 'w-20 accent-blue-500 hidden');
  brushRange.type = 'range';
  brushRange.min = '0.3'; brushRange.max = '4'; brushRange.step = '0.1'; brushRange.value = '1';
  brushRange.setAttribute('aria-label', 'Fix brush size');
  brushRange.title = 'Brush size (× the default in Advanced Settings)';
  targetRow.append(targetLabel, targetInput, targetList, brushRange);
  body.append(toolRow, toolHint, targetRow);

  const TOOL_HINTS: Record<Tool, string> = {
    select: 'Click a part to select it · Shift-click toggles · Alt-click removes · Shift-drag paints a selection · Esc clears. Hover the model to find a part in the list.',
    pin: 'Click the model to add a pin for the part above (type a new name to start a new part). Only nearby parts re-grow. Drag a pin to move it; right-click (or long-press) it to delete.',
    fix: 'Drag on the model to paint triangles into the part above. Fixed triangles stay put when pins move. Right-drag still pans; switch tool to orbit.',
  };

  function setTool(next: Tool): void {
    tool = next;
    for (const [k, b] of Object.entries(toolBtns) as [Tool, HTMLButtonElement][]) {
      b.className = k === tool ? TOGGLE_ON : BUTTON_SMALL_SECONDARY;
      b.setAttribute('aria-pressed', String(k === tool));
    }
    toolHint.textContent = TOOL_HINTS[tool];
    targetRow.classList.toggle('hidden', tool === 'select');
    brushRange.classList.toggle('hidden', tool !== 'fix');
    getCanvas().style.cursor = tool === 'select' ? '' : 'crosshair';
    if (tool !== 'select' && !targetInput.value) {
      const sel = ctl.getPartSelection().parts[0];
      targetInput.value = sel?.name ?? (isDraft(ctl.getPartDraft()) ? '' : 'part 1');
    }
  }
  for (const [k, b] of Object.entries(toolBtns) as [Tool, HTMLButtonElement][]) b.addEventListener('click', () => setTool(k));

  function toggleSolo(): void {
    const on = ctl.getPartsView().mode !== 'solo';
    if (on && ctl.getPartSelection().parts.length === 0) {
      showToast('Select parts to solo first (Select tool, or tick them in the list)', { variant: 'neutral', source: 'parts' });
      return;
    }
    ctl.setPartsView({ mode: on ? 'solo' : 'all' });
  }
  soloBtn.addEventListener('click', toggleSolo);

  function applyMarkerVisibility(): void {
    markers.setVisible(markersOn && !holdHide);
    markerBtn.className = markersOn ? ICON_BTN_ON : ICON_BTN;
    markerBtn.setAttribute('aria-pressed', String(markersOn));
  }
  markerBtn.addEventListener('click', () => { markersOn = !markersOn; applyMarkerVisibility(); });

  // --- Selection action bar ------------------------------------------------------
  const actionBar = el('div', 'hidden flex flex-wrap items-center gap-1.5 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1.5');
  body.appendChild(actionBar);

  /** Rebuilt only when the selection (or the parts) change — hover also
   *  emits 'view', and rebuilding would wipe a half-typed merge name. */
  let actionBarKey = '';
  function renderActionBar(force = false): void {
    const sel = ctl.getPartSelection().parts;
    const key = JSON.stringify([sel, ctl.getPartsView().mode]);
    if (!force && key === actionBarKey) return;
    actionBarKey = key;
    actionBar.classList.toggle('hidden', sel.length === 0);
    actionBar.replaceChildren();
    if (sel.length === 0) return;
    actionBar.appendChild(el('span', 'text-[11px] text-blue-100 mr-1', `${sel.length} selected`));
    const mergeName = el('input', `${INPUT} w-28`);
    mergeName.value = sel[0].name;
    mergeName.setAttribute('aria-label', 'Merged part name');
    const mergeBtn = el('button', BUTTON_SMALL_SECONDARY, 'Merge');
    mergeBtn.disabled = sel.length < 2;
    mergeBtn.title = 'Merge the selected parts into one, named as typed';
    const doMerge = async () => {
      const name = mergeName.value.trim();
      if (sel.length < 2 || !name) return;
      if (await edit([{ op: 'merge', ids: sel.map((p) => p.id), name }])) ctl.setPartSelection([name]);
    };
    mergeBtn.addEventListener('click', () => { void doMerge(); });
    mergeName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void doMerge(); } });
    const solo = el('button', BUTTON_SMALL_SECONDARY, ctl.getPartsView().mode === 'solo' ? 'Show all' : 'Solo');
    solo.addEventListener('click', toggleSolo);
    const lock = el('button', BUTTON_SMALL_SECONDARY, 'Lock');
    lock.title = 'Lock (or unlock) the selected parts: detection leaves locked parts alone';
    lock.addEventListener('click', () => {
      const d = ctl.getPartDraft();
      const allLocked = isDraft(d) && sel.every((s) => d.parts.find((p) => p.id === s.id && 'locked' in p && p.locked));
      void edit(sel.map((p) => ({ op: 'lock', id: p.id, locked: !allLocked })));
    });
    const sw = createColorSwatch({
      initialHex: '#cccccc',
      title: 'Colour the selected parts',
      className: 'w-6 h-6 rounded border border-zinc-600 shrink-0',
      onPick: (hex) => { void edit(sel.map((p) => ({ op: 'setColor', id: p.id, color: hex }))); },
    });
    const redetect = el('button', BUTTON_SMALL_SECONDARY, 'Re-detect inside');
    redetect.title = 'Focus detection on the selected part: the next Detect or preset only changes its area';
    redetect.disabled = sel.length !== 1;
    redetect.addEventListener('click', async () => { if (await edit([{ op: 'focus', id: sel[0].id }])) { focusedName = sel[0].name; renderDraft(); } });
    const del = el('button', BUTTON_SMALL_SECONDARY, 'Delete');
    del.title = 'Remove the selected parts (their triangles become unassigned)';
    del.addEventListener('click', () => { void edit(sel.map((p) => ({ op: 'delete', id: p.name }))); });
    const clear = el('button', ICON_BTN, '✕');
    clear.title = 'Clear selection (Esc)';
    clear.setAttribute('aria-label', 'Clear selection');
    clear.addEventListener('click', () => ctl.setPartSelection(null));
    actionBar.append(mergeName, mergeBtn, solo, lock, sw.el, redetect, del, clear);
  }

  // --- Part list -------------------------------------------------------------------
  const draftBox = el('div', 'flex flex-col gap-1.5');
  body.appendChild(draftBox);
  const rowsByName = new Map<string, HTMLElement>();
  const nameInputs = new Map<number, HTMLInputElement>();

  async function edit(ops: Record<string, unknown>[]): Promise<boolean> {
    const r = await ctl.editParts({ ops });
    if ('error' in r) { showToast(String(r.error), { variant: 'warn', source: 'parts' }); return false; }
    return true;
  }

  /** Sync method + params with the draft after a run the panel didn't make
   *  (preset, AI, reopen). */
  function syncControls(d: Draft): void {
    const key = JSON.stringify([d.detector, d.params, d.featureOptions]);
    if (key === lastSyncedRun) return;
    lastSyncedRun = key;
    const params = d.params as Record<string, unknown>;
    const matches = algoSelect.value === d.detector
      && [...paramInputs].every(([k, io]) => String(io.get()) === String(params[k]));
    // Rebuilding would replace a slider the user may be dragging (Live).
    if (!matches) {
      if (algoSelect.value !== d.detector && info.detectors.some((x) => x.id === d.detector)) algoSelect.value = d.detector;
      buildParams(params);
    }
    const fo = d.featureOptions as { normalSmoothRadius?: number; normalSmoothEdgeLengths?: number };
    smoothInput.value = typeof fo.normalSmoothRadius === 'number' && fo.normalSmoothRadius > 0 ? String(fo.normalSmoothRadius) : '';
    carriedEdgeLengths = !smoothInput.value && typeof fo.normalSmoothEdgeLengths === 'number' && fo.normalSmoothEdgeLengths > 0 ? fo.normalSmoothEdgeLengths : null;
  }

  // Drag-to-reorder state.
  let dragRow: { name: string; id: number; startY: number; target: number } | null = null;
  const dropLine = el('div', 'h-0.5 bg-blue-400 rounded hidden');

  function renderDraft(): void {
    const d = ctl.getPartDraft();
    draftBox.replaceChildren();
    rowsByName.clear();
    nameInputs.clear();
    acceptBtn.disabled = !isDraft(d) || d.parts.length === 0;
    discardBtn.disabled = !isDraft(d) && ctl.getSeeds().length === 0;
    edgeRow.classList.toggle('hidden', !isDraft(d));
    if (isDraft(d) && !edgeDragging && !edgeTimer) {
      edgeRange.value = String(d.edgeSmoothing);
      edgeVal.textContent = String(d.edgeSmoothing);
    }
    needPinsHint.classList.toggle('hidden', isDraft(d) || detectorOf(algoSelect.value).seeds !== 'required' || ctl.getSeeds().length > 0);
    targetList.replaceChildren(...(isDraft(d) ? d.parts.map((p) => { const o = el('option'); o.value = p.name; return o; }) : []));
    if (!isDraft(d)) {
      const saved = ctl.importsWithParts();
      if (saved.length) {
        const reopen = el('button', `${BUTTON_SMALL_SECONDARY} self-start`, 'Edit saved parts');
        reopen.title = 'Re-open the parts saved on this import (with their pins) to refine them';
        reopen.addEventListener('click', async () => {
          const r = await ctl.reopenParts({ importIndex: saved[0] });
          if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
        });
        draftBox.append(el('div', SECTION, 'Saved parts'), reopen);
      }
      renderActionBar(true);
      return;
    }
    syncControls(d);
    const q = d.quality;
    const head = el('div', 'flex items-center justify-between gap-2');
    const clearAll = el('button', BUTTON_SMALL_SECONDARY, 'Clear all');
    clearAll.title = 'Remove every part and pin (Undo brings them back)';
    clearAll.disabled = d.parts.length === 0;
    clearAll.addEventListener('click', () => { void edit([{ op: 'clear' }]); });
    head.append(el('div', SECTION, `Parts (${d.parts.length})`), clearAll);
    draftBox.appendChild(head);
    draftBox.appendChild(el('div', HINT,
      `Boundary groove ${q.boundaryCreaseMean.toFixed(1)}° · islands ${q.islandCount} · unassigned ${(d.unassigned.areaFrac * 100).toFixed(1)}% · drag ⋮⋮ to reorder`));
    if (d.detector === 'pieces' && d.parts.length <= 2) {
      draftBox.appendChild(el('div', 'text-[11px] text-amber-300/90 leading-snug',
        `Only ${d.parts.length} separate piece${d.parts.length === 1 ? '' : 's'}: this mesh is one fused solid. Try Auto patches (no pins) or Crease watershed (pins) to split it along its grooves.`));
    }
    if (d.focus) {
      const banner = el('div', 'flex items-center gap-2 text-[11px] text-blue-200 bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1');
      banner.append(el('span', 'flex-1', `Focused on ${focusedName ?? 'one part'}: detection only changes that area.`));
      const clear = el('button', BUTTON_SMALL_SECONDARY, 'Clear focus');
      clear.addEventListener('click', async () => { if (await edit([{ op: 'focus', id: null }])) focusedName = null; });
      banner.appendChild(clear);
      draftBox.appendChild(banner);
    } else focusedName = null;

    const selected = new Set(ctl.getPartSelection().parts.map((p) => p.name));
    const view = ctl.getPartsView();
    const soloSet = new Set(view.mode === 'solo' ? view.parts : []);
    const list = el('div', 'flex flex-col gap-0.5 max-h-64 overflow-y-auto pr-1');
    list.setAttribute('role', 'list');
    for (const p of d.parts) {
      const row = el('div', `${ROW} ${selected.has(p.name) ? ROW_SELECTED : ''}`);
      row.setAttribute('role', 'listitem');
      row.dataset.partId = String(p.id);
      row.dataset.partName = p.name;
      rowsByName.set(p.name, row);
      const handle = el('span', 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center text-zinc-500 cursor-grab touch-none select-none', '⋮⋮');
      handle.title = 'Drag to reorder (or Alt+↑/↓ in the name box)';
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        dragRow = { name: p.name, id: p.id, startY: e.clientY, target: p.id };
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragRow || dragRow.name !== p.name) return;
        const rows = [...list.querySelectorAll<HTMLElement>('[data-part-id]')];
        let target = rows.length;
        for (let k = 0; k < rows.length; k++) {
          const r = rows[k].getBoundingClientRect();
          if (e.clientY < r.top + r.height / 2) { target = k + 1; break; }
        }
        // Position the drop line before row `target` (1-based).
        dropLine.classList.remove('hidden');
        if (target <= rows.length) list.insertBefore(dropLine, rows[target - 1]);
        else list.appendChild(dropLine);
        dragRow.target = target > p.id ? target - 1 : target;
      });
      const endDrag = () => {
        if (!dragRow || dragRow.name !== p.name) return;
        const { id, target } = dragRow;
        dragRow = null;
        dropLine.classList.add('hidden');
        if (target !== id) void edit([{ op: 'reorder', id, position: Math.max(1, Math.min(d.parts.length, target)) }]);
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', () => { dragRow = null; dropLine.classList.add('hidden'); });
      // A 44 px touch target around the native checkbox.
      const checkWrap = el('label', 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center cursor-pointer');
      const check = el('input');
      check.type = 'checkbox';
      checkWrap.appendChild(check);
      check.checked = selected.has(p.name);
      check.title = 'Select';
      check.setAttribute('aria-label', `Select ${p.name}`);
      check.addEventListener('change', () => ctl.setPartSelection([p.name], { mode: check.checked ? 'add' : 'remove' }));
      const sw = createColorSwatch({
        initialHex: p.displayColor,
        title: `Colour for ${p.name}`,
        className: 'w-5 h-5 rounded border border-zinc-600 shrink-0',
        onPick: (hex) => { void edit([{ op: 'setColor', id: p.id, color: hex }]); },
      });
      const num = el('span', 'text-[11px] text-zinc-500 w-5 text-right shrink-0', String(p.id));
      const name = el('input', `${INPUT} flex-1 min-w-0`);
      name.value = p.name;
      name.setAttribute('aria-label', `Name of part ${p.id}`);
      name.title = 'Rename. Typing another part\'s name merges the two.';
      name.addEventListener('change', () => {
        const v = name.value.trim();
        // Renaming to another part's name merges them (the draft handles it).
        if (v && v !== p.name) void edit([{ op: 'rename', id: p.id, name: v }]);
      });
      name.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const to = p.id + (e.key === 'ArrowUp' ? -1 : 1);
        if (to >= 1 && to <= d.parts.length) void edit([{ op: 'reorder', id: p.id, position: to }]).then(() => nameInputs.get(to)?.focus());
      });
      nameInputs.set(p.id, name);
      const pct = el('span', 'text-[10px] text-zinc-500 w-9 text-right shrink-0', `${(p.areaFrac * 100).toFixed(1)}%`);
      pct.title = `${p.triCount} triangles${p.regions > 1 ? `, ${p.regions} separate regions` : ''}`;
      const pins = el('span', 'text-[10px] text-zinc-500 w-6 text-right shrink-0', `📍${p.pins}`);
      pins.title = `${p.pins} pin${p.pins === 1 ? '' : 's'}`;
      const locked = 'locked' in p && p.locked === true;
      const lock = el('button', locked ? ICON_BTN_ON : ICON_BTN, locked ? '🔒' : '🔓');
      lock.title = locked ? 'Unlock: detection may change this part again' : 'Lock: keep this part as it is when detection re-runs';
      lock.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${p.name}`);
      lock.setAttribute('aria-pressed', String(locked));
      lock.addEventListener('click', () => { void edit([{ op: 'lock', id: p.id, locked: !locked }]); });
      const soloOn = soloSet.has(p.name);
      const solo = el('button', soloOn ? ICON_BTN_ON : ICON_BTN, '◐');
      solo.title = soloOn ? 'Show all parts' : 'Solo: show only this part in colour';
      solo.setAttribute('aria-label', `Solo ${p.name}`);
      solo.setAttribute('aria-pressed', String(soloOn));
      solo.addEventListener('click', () => ctl.setPartsView(soloOn ? { mode: 'all' } : { mode: 'solo', parts: [p.name] }));
      const del = el('button', ICON_BTN, '✕');
      del.title = 'Remove part (its triangles become unassigned)';
      del.setAttribute('aria-label', `Remove part ${p.name}`);
      del.addEventListener('click', () => { void edit([{ op: 'delete', id: p.id }]); });
      // Mouse only: a tap would leave the hover stuck.
      row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') ctl.setHoveredPart(p.name); });
      row.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && ctl.getHoveredPart() === p.name) ctl.setHoveredPart(null); });
      row.append(handle, checkWrap, sw.el, num, name, pct, pins, lock, solo, del);
      list.appendChild(row);
    }
    draftBox.appendChild(list);

    const tools = el('div', 'flex flex-wrap gap-1.5');
    const absorbBtn = el('button', BUTTON_SMALL_SECONDARY, 'Absorb specks');
    const minFrac = getConfig().segmentation.absorbMinAreaFrac;
    absorbBtn.title = `Fold islands smaller than ${+(minFrac * 100).toFixed(2)}% of the surface into their neighbours`;
    absorbBtn.addEventListener('click', () => { void edit([{ op: 'absorbSmall', minAreaFrac: getConfig().segmentation.absorbMinAreaFrac }]); });
    const tidyBtn = el('button', BUTTON_SMALL_SECONDARY, 'Tidy edges');
    tidyBtn.title = 'Shave single-triangle stair-steps and spurs off part boundaries (changes which triangles belong to which part)';
    tidyBtn.addEventListener('click', () => { void edit([{ op: 'smoothBoundaries', iterations: getConfig().segmentation.smoothBoundaryIterations }]); });
    const undoBtn = el('button', BUTTON_SMALL_SECONDARY, 'Undo');
    undoBtn.disabled = !d.canUndo;
    undoBtn.addEventListener('click', () => { void edit([{ op: 'undo' }]); });
    tools.append(absorbBtn, tidyBtn, undoBtn);
    draftBox.appendChild(tools);

    const overlayRow = el('label', 'flex items-center gap-1.5 text-[12px] text-zinc-300');
    const overlay = el('input');
    overlay.type = 'checkbox';
    overlay.checked = ctl.isOverlayVisible();
    overlay.addEventListener('change', () => ctl.setPartsOverlay(overlay.checked));
    overlayRow.append(overlay, el('span', '', 'Show parts overlay'));
    draftBox.appendChild(overlayRow);
    renderActionBar(true);
    markHover();
  }

  // Edge smoothness: sub-triangle part boundaries (shown on the overlay, cut
  // into the mesh on Accept). Built once, outside draftBox, so a draft
  // update (including the one its own edit causes) never replaces it
  // mid-drag.
  const edgeRange = el('input', 'w-28 accent-blue-500');
  edgeRange.type = 'range';
  edgeRange.min = '0';
  edgeRange.max = String(MAX_EDGE_SMOOTHING);
  edgeRange.step = '1';
  edgeRange.setAttribute('aria-label', 'Edge smoothness');
  const edgeVal = el('span', 'text-[11px] text-zinc-400 w-6 text-right');
  let edgeDragging = false;
  edgeRange.addEventListener('pointerdown', () => { edgeDragging = true; });
  edgeRange.addEventListener('pointerup', () => { edgeDragging = false; });
  edgeRange.addEventListener('input', () => {
    edgeVal.textContent = edgeRange.value;
    if (edgeTimer) clearTimeout(edgeTimer);
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      void edit([{ op: 'setEdgeSmoothing', iterations: Number(edgeRange.value) }]);
    }, getConfig().segmentation.edgeSmoothingDebounceMs);
  });
  const edgeRow = paramRow('Edge smoothness',
    'Draws part boundaries through triangles instead of along their edges, so stair-stepped boundaries curve smoothly (boundaries on a hard edge, such as a box corner, stay put). 0 = off (triangle edges). Accept cuts the mesh along these boundaries.',
    edgeRange, edgeVal);
  edgeRow.classList.add('hidden');
  body.appendChild(edgeRow);

  /** Highlight the hovered part's row and keep it in view. */
  let lastHoverRow: HTMLElement | null = null;
  function markHover(scroll = false): void {
    const name = ctl.getHoveredPart();
    lastHoverRow?.classList.remove(...ROW_HOVER.split(' '));
    lastHoverRow = name ? rowsByName.get(name) ?? null : null;
    if (lastHoverRow) {
      lastHoverRow.classList.add(...ROW_HOVER.split(' '));
      if (scroll) lastHoverRow.scrollIntoView({ block: 'nearest' });
    }
  }

  // ======================================================== viewport interaction
  /** Pins are rebuilt only when they, their colours or the emphasised set
   *  change (hovering would otherwise rebuild every pin mesh per part). */
  let pinsKey = '';
  function renderPins(): void {
    // Selected parts' pins are emphasised (hover is shown on the overlay
    // only: rebuilding every pin mesh per hovered part is too costly).
    const emphasize = new Set(ctl.getPartSelection().parts.map((p) => p.name));
    const seeds = ctl.getSeeds();
    const d = ctl.getPartDraft();
    const partColor = new Map(isDraft(d) ? d.parts.map((p) => [p.name, p.displayColor] as const) : []);
    const labels = [...new Set(seeds.map((x) => x.label))];
    const colorOf = (label: string) => partColor.get(label) ?? overlayColor(Math.max(0, labels.indexOf(label)), null);
    const key = JSON.stringify([seeds, [...emphasize], labels.map(colorOf)]);
    if (key === pinsKey) return;
    pinsKey = key;
    markers.update(seeds, colorOf, emphasize);
  }

  /** Pin edits: with a draft they are draft ops (only nearby parts re-grow);
   *  before the first detection they edit the pending pin list. */
  async function addPin(label: string, point: [number, number, number]): Promise<void> {
    if (isDraft(ctl.getPartDraft())) await edit([{ op: 'addSeed', seed: { label, point } }]);
    else { ctl.setSeeds([...ctl.getSeeds(), { label, point }]); renderDraft(); }
  }
  async function movePin(index: number, point: [number, number, number]): Promise<void> {
    if (isDraft(ctl.getPartDraft())) { await edit([{ op: 'moveSeed', index, point }]); return; }
    const s = ctl.getSeeds();
    if (s[index]) { s[index] = { label: s[index].label, point }; ctl.setSeeds(s); }
  }
  async function removePin(index: number): Promise<void> {
    if (isDraft(ctl.getPartDraft())) { await edit([{ op: 'removeSeed', index }]); return; }
    const s = ctl.getSeeds();
    s.splice(index, 1);
    ctl.setSeeds(s);
    renderDraft();
  }

  let pinDrag: { index: number; point: [number, number, number] | null; x: number; y: number; at: number } | null = null;
  let press: { x: number; y: number; shift: boolean; alt: boolean; additive: boolean } | null = null;
  let paintSelect: Set<string> | null = null;
  let brushing: { target: string; stroke: string; pending: [number, number, number][]; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let strokeSeq = 0;

  const partUnder = (evt: MouseEvent): string | null => {
    const hit = pickFace(evt);
    return hit ? ctl.partAtFace(hit.triangleIndex)?.name ?? null : null;
  };

  const unhookPointer = addPointerSuppressor((evt: PointerEvent) => {
    if (evt.type !== 'pointerdown') return false;
    const idx = markers.hitTest(evt);
    if (idx >= 0) {
      if (evt.button === 2) { void removePin(idx); return true; }
      if (evt.button === 0) { pinDrag = { index: idx, point: null, x: evt.clientX, y: evt.clientY, at: performance.now() }; return true; }
    }
    if (evt.button !== 0) return false;
    if (tool === 'select' && evt.shiftKey && isDraft(ctl.getPartDraft())) {
      // Shift-drag paints a selection across parts (owns the drag).
      paintSelect = new Set(ctl.getPartSelection().parts.map((p) => p.name));
      const nm = partUnder(evt);
      if (nm) { paintSelect.add(nm); ctl.setPartSelection([...paintSelect]); }
      return true;
    }
    if (tool === 'fix' && isDraft(ctl.getPartDraft())) {
      const target = targetInput.value.trim();
      if (!target) { showToast('Type the part to paint into first', { variant: 'warn', source: 'parts' }); return true; }
      brushing = { target, stroke: `fix-${Date.now()}-${++strokeSeq}`, pending: [], timer: null };
      brushAt(evt);
      return true;
    }
    press = { x: evt.clientX, y: evt.clientY, shift: evt.shiftKey, alt: evt.altKey, additive: evt.shiftKey || evt.ctrlKey || evt.metaKey };
    return false;
  });

  function brushAt(evt: PointerEvent): void {
    if (!brushing) return;
    const hit = pickFace(evt);
    if (!hit) return;
    brushing.pending.push(hit.point);
    if (!brushing.timer) {
      // Batch brush dabs into one edit per ~120 ms (one undo step per batch).
      brushing.timer = setTimeout(() => flushBrush(), 120);
    }
  }
  function flushBrush(): void {
    if (!brushing) return;
    brushing.timer = null;
    const pts = brushing.pending.splice(0);
    if (!pts.length) return;
    const radius = brushRadius() * Number(brushRange.value);
    // One drag = one undo step: every batch of the stroke shares its id.
    void ctl.editParts({ ops: pts.map((point) => ({ op: 'reassign', point, to: brushing!.target, radius })), stroke: brushing.stroke })
      .then((r) => { if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' }); });
  }
  let cachedDiag = 0;
  function brushRadius(): number {
    if (!cachedDiag) {
      const d = ctl.getPartDraft();
      if (isDraft(d) && d.parts.length) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const p of d.parts) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.bbox.min[k]); max[k] = Math.max(max[k], p.bbox.max[k]); }
        cachedDiag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      }
    }
    return (cachedDiag || 1) * getConfig().segmentation.fixBrushRadiusFrac;
  }

  function onWindowMove(evt: PointerEvent): void {
    if (pinDrag) {
      const hit = pickFace(evt);
      if (!hit) return;
      pinDrag.point = hit.point;
      markers.moveMarker(pinDrag.index, hit.point);
      return;
    }
    if (paintSelect) {
      const nm = partUnder(evt);
      if (nm && !paintSelect.has(nm)) { paintSelect.add(nm); ctl.setPartSelection([...paintSelect]); }
      return;
    }
    if (brushing) brushAt(evt);
  }

  function onWindowUp(evt: PointerEvent): void {
    if (pinDrag) {
      const { index, point, x, y, at } = pinDrag;
      pinDrag = null;
      const moved = Math.hypot(evt.clientX - x, evt.clientY - y) > CLICK_SLOP_PX;
      if (point && moved) { void movePin(index, point); return; }
      // Long-press a pin (no drag) deletes it — the touch twin of right-click.
      if (!moved && performance.now() - at >= PIN_LONG_PRESS_MS) { void removePin(index); return; }
      // A click on a pin (no drag) acts like a click on the model there.
      press = { x, y, shift: evt.shiftKey, alt: evt.altKey, additive: evt.shiftKey || evt.ctrlKey || evt.metaKey };
    }
    if (paintSelect) { paintSelect = null; return; }
    if (brushing) { flushBrush(); brushing = null; return; }
    if (!press) return;
    const p = press;
    press = null;
    const moved = Math.hypot(evt.clientX - p.x, evt.clientY - p.y);
    if (moved > CLICK_SLOP_PX || evt.target !== getCanvas()) return;
    const hit = pickFace(evt);
    if (!hit) {
      if (tool === 'select' && !p.additive && !p.alt) ctl.setPartSelection(null);
      return;
    }
    if (tool === 'pin') {
      const label = targetInput.value.trim();
      if (!label) { showToast('Type a part name for the pin first', { variant: 'warn', source: 'parts' }); targetInput.focus(); return; }
      void addPin(label, hit.point);
      return;
    }
    if (tool === 'select') {
      const part = ctl.partAtFace(hit.triangleIndex);
      if (!part) { if (!p.additive) ctl.setPartSelection(null); return; }
      if (p.alt) ctl.setPartSelection([part.name], { mode: 'remove' });
      else if (p.additive) ctl.setPartSelection([part.name], { mode: 'toggle' });
      else ctl.setPartSelection([part.name]);
      rowsByName.get(part.name)?.scrollIntoView({ block: 'nearest' });
    }
  }

  // Hover: name the part under the cursor and jump the list to it.
  let hoverRaf = 0;
  let hoverEvt: PointerEvent | null = null;
  function onCanvasHover(evt: PointerEvent): void {
    if (evt.buttons !== 0 || pinDrag || paintSelect || brushing) return;
    hoverEvt = evt;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const e = hoverEvt;
      if (!e || !isDraft(ctl.getPartDraft())) { cursorTag.classList.add('hidden'); return; }
      const nm = partUnder(e);
      if (nm) {
        cursorTag.textContent = nm;
        cursorTag.style.left = `${e.clientX + 14}px`;
        cursorTag.style.top = `${e.clientY + 12}px`;
        cursorTag.classList.remove('hidden');
      } else cursorTag.classList.add('hidden');
      if (nm !== ctl.getHoveredPart()) {
        ctl.setHoveredPart(nm);
        markHover(true);
      }
    });
  }
  function onCanvasLeave(): void {
    cursorTag.classList.add('hidden');
    if (ctl.getHoveredPart()) { ctl.setHoveredPart(null); markHover(); }
  }

  function onContextMenu(evt: MouseEvent): void {
    if (markers.hitTest(evt) >= 0) evt.preventDefault();
  }

  function onKeyDown(evt: KeyboardEvent): void {
    if (isTyping(evt.target) || evt.metaKey || evt.ctrlKey) return;
    const k = evt.key.toLowerCase();
    if (k === 'h' && !evt.repeat && !evt.altKey) { holdHide = true; applyMarkerVisibility(); return; }
    if (evt.repeat || evt.altKey) return;
    if (k === 'v') setTool('select');
    else if (k === 'p') setTool('pin');
    else if (k === 'b') setTool('fix');
    else if (k === 's') toggleSolo();
    else if ((evt.key === 'Delete' || evt.key === 'Backspace') && ctl.getPartSelection().parts.length) {
      evt.preventDefault();
      void edit(ctl.getPartSelection().parts.map((p) => ({ op: 'delete', id: p.name })));
    }
  }
  /** Escape first closes the preset strip, then clears the selection; only
   *  when there is neither does it reach the panel shell (which closes the
   *  panel). Capture phase on document, so it runs before the shell's
   *  listener. */
  function onEscape(evt: KeyboardEvent): void {
    if (evt.key !== 'Escape' || isTyping(evt.target)) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (stripOpen) setStripOpen(false);
    else if (ctl.getPartSelection().parts.length) ctl.setPartSelection(null);
    else return;
    evt.preventDefault();
    evt.stopPropagation();
  }

  function onKeyUp(evt: KeyboardEvent): void {
    if ((evt.key === 'h' || evt.key === 'H') && holdHide) {
      holdHide = false;
      applyMarkerVisibility();
    }
  }

  window.addEventListener('pointermove', onWindowMove);
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('keydown', onEscape, true);
  getCanvas().addEventListener('contextmenu', onContextMenu);
  getCanvas().addEventListener('pointermove', onCanvasHover);
  getCanvas().addEventListener('pointerleave', onCanvasLeave);

  // ======================================================== 3. ACCEPT (footer)
  const discardBtn = el('button', BUTTON_CANCEL, 'Discard');
  discardBtn.title = 'Throw away the parts and pins and start over';
  const acceptBtn = el('button', BUTTON_PRIMARY, 'Accept parts');
  acceptBtn.title = 'Save the parts on the import as labels (paint by part, colours become model colours). With Edge smoothness on, the mesh is cut along the smooth boundaries.';
  discardBtn.addEventListener('click', () => { void ctl.discardParts(); });
  acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    const r = await ctl.acceptParts();
    if ('error' in r) {
      showToast(String(r.error), { variant: 'warn', source: 'parts' });
      acceptBtn.disabled = false;
      return;
    }
    showToast(`Saved ${(r as { parts: unknown[] }).parts.length} parts as labels`, { variant: 'success', source: 'parts' });
    if ('note' in r && typeof r.note === 'string') showToast(r.note, { variant: 'neutral', source: 'parts' });
  });
  footer.append(discardBtn, acceptBtn);

  function syncBusy(): void {
    const b = ctl.isBusy();
    detectBtn.disabled = !!b;
    presetBtn.disabled = !!b && !stripOpen;
    cancelBtn.classList.toggle('hidden', !b?.cancellable);
    status.textContent = b ? `${b.message} ${Math.round(b.fraction * 100)}%` : '';
  }
  const unsubscribe = ctl.subscribe((ev) => {
    if (ev === 'draft') {
      cachedDiag = 0;
      // Any later change makes the banner's Undo undo something else.
      appliedBanner.classList.add('hidden');
      renderDraft();
      renderPins();
    }
    if (ev === 'seeds') { renderPins(); if (!isDraft(ctl.getPartDraft())) renderDraft(); }
    if (ev === 'presets') renderStrip();
    if (ev === 'view') {
      // Selection / solo changes restyle rows + the action bar; hover only
      // moves the row highlight (cheap — no list rebuild).
      const sel = new Set(ctl.getPartSelection().parts.map((p) => p.name));
      const view = ctl.getPartsView();
      soloBtn.className = view.mode === 'solo' ? TOGGLE_ON : BUTTON_SMALL_SECONDARY;
      soloBtn.setAttribute('aria-pressed', String(view.mode === 'solo'));
      for (const [nm, row] of rowsByName) {
        row.classList.toggle('bg-blue-500/15', sel.has(nm));
        row.classList.toggle('ring-1', sel.has(nm));
        row.classList.toggle('ring-blue-500/40', sel.has(nm));
        const cb = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (cb) cb.checked = sel.has(nm);
      }
      renderActionBar();
      markHover();
      renderPins();
    }
    syncBusy();
  });

  algoSelect.addEventListener('change', () => {
    void ctl.showPresetPreview(null);
    carriedEdgeLengths = null;
    buildParams();
    renderDraft();
    scheduleLive();
  });
  buildParams();
  setTool(isDraft(ctl.getPartDraft()) ? 'select' : detectorOf(algoSelect.value).seeds === 'required' ? 'pin' : 'select');
  renderDraft();
  renderPins();
  applyMarkerVisibility();
  requestAnimationFrame(fitToWindow);
  // Opened mid-run (e.g. during the import-time pass): show it and its Cancel now.
  syncBusy();
}

/** Wire Part Detection into the command palette, the viewport Tools menu,
 *  the Paint panel's Labels section and the controller's openPartsPanel(). */
export function initPartDetectionUI(ctl: PartDetectionApi): void {
  ctl.setPanelOpener(() => openPartDetectionPanel(ctl));
  setDetectPartsEntry(() => openPartDetectionPanel(ctl));
  registerCommands([
    {
      id: 'detect-parts',
      title: 'Detect parts…',
      hint: 'Paint',
      keywords: 'detect parts segment segmentation split regions imported stl figure hair face label colorize auto paint seeds pins presets merge',
      run: () => openPartDetectionPanel(ctl),
    },
  ]);

  const mount = () => {
    if (document.getElementById('parts-viewport-toggle')) return;
    const styleRef = document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter((c) => c !== 'hidden').join(' ') || BUTTON_SMALL_SECONDARY;
    const btn = el('button', btnCls, '🧩 Parts');
    btn.id = 'parts-viewport-toggle';
    btn.title = 'Detect the parts of an imported mesh (hair, face, shirt…)';
    btn.addEventListener('click', () => openPartDetectionPanel(ctl));
    host.appendChild(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('parts-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}

