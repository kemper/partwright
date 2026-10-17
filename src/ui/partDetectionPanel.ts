// Part Detection panel (#1025) — split an imported mesh into named parts.
//
// A docked, non-modal tool panel (the user clicks the model to place seeds
// while it is open). Every control calls the same controller the
// window.partwright / AI methods use, so the two surfaces can't drift. The
// detector dropdown, its parameter controls and its presets are generated
// from the registry: registering a detector adds it here automatically.
//
// Viewport interaction while the panel is open:
//   - seed markers (dot + name tag) for every working seed; drag a dot to
//     move it, right-click it to delete; the eye toggle or holding H hides
//     them so the surface underneath can be clicked;
//   - "Place seeds" / "Pick part" act on a CLICK (press and release without
//     moving), so dragging still orbits the camera.

import { pickFace } from '../color/facePicker';
import { getConfig } from '../config/appConfig';
import { addPointerSuppressor, getCanvas } from '../renderer/viewport';
import { MAX_EDGE_SMOOTHING, overlayColor } from '../segmentation/draft';
import type { PartDetectionApi } from '../segmentation/partDetection';
import { createSeedMarkers } from '../segmentation/seedMarkers';
import type { ParamSpec, SegSeed } from '../segmentation/types';
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
const SECTION = 'text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mt-1';
const HINT = 'text-[11px] text-zinc-500 leading-snug';
/** Row icon buttons: a full-size touch target around a small glyph. */
const ICON_BTN = 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded text-zinc-500 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/60';
const ICON_BTN_ON = 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded text-blue-300 bg-blue-500/20 [@media(hover:hover)]:hover:bg-blue-500/30';
const TOGGLE_ON = 'px-2 py-1 rounded text-[11px] text-blue-200 bg-blue-500/30 border border-blue-500/50';
/** A press that moves less than this (px) counts as a click, not an orbit. */
const CLICK_SLOP_PX = 6;

type Draft = Exclude<ReturnType<PartDetectionApi['getPartDraft']>, { draft: null }>;

function isDraft(x: unknown): x is Draft {
  return !!x && typeof x === 'object' && Array.isArray((x as Draft).parts);
}

function isTyping(t: EventTarget | null): boolean {
  const n = t as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
}

export function openPartDetectionPanel(ctl: PartDetectionApi): void {
  if (closeOpen) return;
  const info = ctl.listPartDetectors();
  let mode: 'seed' | 'pick' | null = null;
  let live = false; // "always manual" default: Live starts off every time
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  let edgeTimer: ReturnType<typeof setTimeout> | null = null;
  let markersOn = true;
  let holdHide = false;
  let lastSyncedRun = '';
  let focusedName: string | null = null;
  /** Edge-length-relative denoise from a synced run (e.g. the "Denoised
   *  scan" preset) — carried into the next Detect while the box is blank. */
  let carriedEdgeLengths: number | null = null;
  const markers = createSeedMarkers();

  const shell = createToolPanelShell({
    title: 'Detect parts',
    width: 'w-[23rem]',
    onClose: () => {
      setMode(null);
      unhookPointer();
      window.removeEventListener('pointermove', onWindowMove);
      window.removeEventListener('pointerup', onWindowUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      getCanvas().removeEventListener('contextmenu', onContextMenu);
      if (liveTimer) clearTimeout(liveTimer);
      if (edgeTimer) clearTimeout(edgeTimer);
      void ctl.showPresetPreview(null);
      markers.dispose();
      unsubscribe();
      closeOpen = null;
    },
  });
  closeOpen = shell.close;
  const { body, footer } = shell;

  body.appendChild(el('div', 'text-[12px] text-zinc-400 leading-snug',
    'Split an imported mesh into named parts (hair, face, shirt…) so paint can follow them. Nothing is saved until you Accept.'));

  // --- Method + presets + params ---------------------------------------------
  body.appendChild(el('div', SECTION, 'Method'));
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
  presetBtn.title = 'Run every preset of this method and show the results side by side, best first. Hover (or ←/→) to preview one on the model; click to keep it.';
  presetRow.append(presetBtn, el('span', HINT, 'hover to preview · ←/→ to flip · click to keep'));
  const strip = el('div', 'shrink-0 flex gap-1.5 overflow-x-auto pb-1 hidden');
  strip.setAttribute('role', 'listbox');
  strip.setAttribute('aria-label', 'Preset results');
  strip.setAttribute('aria-orientation', 'horizontal');
  body.append(presetRow, strip);

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
    seedSection.classList.toggle('hidden', d.seeds === 'none');
    presetRow.classList.toggle('hidden', !(d.presets?.length));
    renderStrip();
  }

  // --- Seeds ----------------------------------------------------------------
  const seedSection = el('div', 'flex flex-col gap-1.5');
  seedSection.appendChild(el('div', SECTION, 'Seeds'));
  seedSection.appendChild(el('div', HINT,
    'Type a part name, click Place seeds, then click the model (dragging still orbits). Drag a dot to move it, right-click it to delete. Hold H to hide the markers.'));
  const seedRow = el('div', 'flex items-center gap-1.5');
  const labelInput = el('input', `${INPUT} flex-1 min-w-0`);
  labelInput.placeholder = 'part name, e.g. hair';
  labelInput.setAttribute('aria-label', 'Seed part name');
  labelInput.value = 'hair';
  const pickBtn = el('button', BUTTON_SMALL_SECONDARY, 'Place seeds');
  const markerBtn = el('button', ICON_BTN_ON, '👁');
  markerBtn.title = 'Show/hide seed markers (or hold H)';
  markerBtn.setAttribute('aria-label', 'Toggle seed markers');
  markerBtn.setAttribute('aria-pressed', 'true');
  seedRow.append(labelInput, pickBtn, markerBtn);
  const seedList = el('div', 'flex flex-col gap-0.5 max-h-28 overflow-y-auto');
  const clearSeedsBtn = el('button', `${BUTTON_SMALL_SECONDARY} self-start`, 'Clear seeds');
  seedSection.append(seedRow, seedList, clearSeedsBtn);
  body.appendChild(seedSection);

  /** Overlay colour for a seed label: its part's colour when one exists. */
  function colorFor(label: string): string {
    const d = ctl.getPartDraft();
    if (isDraft(d)) {
      const p = d.parts.find((x) => x.name === label);
      if (p) return p.displayColor;
    }
    const labels = [...new Set(ctl.getSeeds().map((s) => s.label))];
    return overlayColor(Math.max(0, labels.indexOf(label)), null);
  }

  function renderSeeds(): void {
    const seeds = ctl.getSeeds();
    seedList.replaceChildren();
    seeds.forEach((s, i) => {
      const row = el('div', 'flex items-center gap-1 text-[11px] text-zinc-300');
      const dot = el('span', 'w-2.5 h-2.5 rounded-full shrink-0');
      dot.style.background = colorFor(s.label);
      row.append(dot, el('span', 'flex-1 truncate', `${s.label} · (${s.point.map((v) => v.toFixed(1)).join(', ')})`));
      const x = el('button', ICON_BTN, '✕');
      x.title = 'Remove seed';
      x.setAttribute('aria-label', `Remove ${s.label} seed`);
      x.addEventListener('click', () => removeSeed(i));
      row.appendChild(x);
      seedList.appendChild(row);
    });
    markers.update(seeds, colorFor);
  }

  function writeSeeds(next: SegSeed[]): void {
    ctl.setSeeds(next.map((s) => ({ label: s.label, point: s.point })));
    scheduleLive();
  }
  function removeSeed(i: number): void {
    const s = ctl.getSeeds();
    s.splice(i, 1);
    writeSeeds(s);
  }

  function applyMarkerVisibility(): void {
    markers.setVisible(markersOn && !holdHide);
    markerBtn.className = markersOn ? ICON_BTN_ON : ICON_BTN;
    markerBtn.setAttribute('aria-pressed', String(markersOn));
  }
  markerBtn.addEventListener('click', () => { markersOn = !markersOn; applyMarkerVisibility(); });

  function setMode(next: 'seed' | 'pick' | null): void {
    mode = next;
    pickBtn.className = mode === 'seed' ? TOGGLE_ON : BUTTON_SMALL_SECONDARY;
    pickBtn.textContent = mode === 'seed' ? 'Done placing' : 'Place seeds';
    pickPartBtn.className = mode === 'pick' ? TOGGLE_ON : BUTTON_SMALL_SECONDARY;
    pickPartBtn.textContent = mode === 'pick' ? 'Done picking' : 'Pick part';
    document.body.style.cursor = mode ? 'crosshair' : '';
  }
  pickBtn.addEventListener('click', () => setMode(mode === 'seed' ? null : 'seed'));
  clearSeedsBtn.addEventListener('click', () => writeSeeds([]));

  // --- Detect / live / status -------------------------------------------------
  const actionRow = el('div', 'flex items-center gap-2');
  const detectBtn = el('button', BUTTON_PRIMARY, 'Detect');
  const liveLabel = el('label', 'flex items-center gap-1 text-[12px] text-zinc-300 shrink-0');
  liveLabel.title = 'Re-run detection automatically after each seed or setting change. Off by default — turn it on when the model is quick to detect.';
  const liveBox = el('input');
  liveBox.type = 'checkbox';
  liveBox.checked = false;
  liveLabel.append(liveBox, el('span', '', 'Live'));
  const cancelBtn = el('button', `${BUTTON_CANCEL} hidden`, 'Cancel');
  const status = el('div', 'text-[11px] text-zinc-400 flex-1 truncate');
  status.setAttribute('aria-live', 'polite');
  actionRow.append(detectBtn, liveLabel, cancelBtn, status);
  body.appendChild(actionRow);

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
      showToast('Place at least one seed first', { variant: 'neutral', source: 'parts' });
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

  // --- Presets filmstrip --------------------------------------------------------
  presetBtn.addEventListener('click', async () => {
    const opts: Record<string, unknown> = { algorithm: algoSelect.value, image: false };
    const r = await ctl.previewPartPresets(opts);
    if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
  });

  /** Identity of the rendered tiles: rebuild only when the results change,
   *  otherwise just move the selection (rebuilding under the pointer would
   *  re-fire mouseenter and loop). */
  let stripKey = '';
  function renderStrip(): void {
    const p = ctl.getPresetPreviews();
    const show = !!p && p.algorithm === algoSelect.value && p.items.length > 0;
    strip.classList.toggle('hidden', !show);
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
    tile.title = `${item.name}: ${item.summary.parts.length} parts, boundary groove ${item.summary.quality.boundaryCreaseMean.toFixed(1)}°. Click to keep.`;
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
      const r = await ctl.applyPartPreset(i);
      if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
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
    if (e.key === 'Escape') {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      void ctl.showPresetPreview(null);
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tiles = [...strip.querySelectorAll<HTMLButtonElement>('button[data-index]')];
    if (!tiles.length) return;
    e.preventDefault();
    const cur = ctl.getPreviewIndex() ?? -1;
    const next = e.key === 'ArrowRight' ? Math.min(tiles.length - 1, cur + 1) : Math.max(0, cur - 1);
    tiles[next].focus();
    tiles[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // --- Draft: parts list + clean-up -------------------------------------------
  const draftBox = el('div', 'flex flex-col gap-1.5');
  body.appendChild(draftBox);

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
  const pickPartBtn = el('button', BUTTON_SMALL_SECONDARY, 'Pick part');
  pickPartBtn.title = 'Click a part on the model to jump to its name. Type a name to label it; give two parts the same name to merge them.';
  pickPartBtn.addEventListener('click', () => setMode(mode === 'pick' ? null : 'pick'));
  const nameInputs = new Map<number, HTMLInputElement>();

  async function edit(ops: Record<string, unknown>[]): Promise<boolean> {
    const r = await ctl.editParts({ ops });
    if ('error' in r) { showToast(String(r.error), { variant: 'warn', source: 'parts' }); return false; }
    return true;
  }

  /** Sync method + params with the draft after a run the panel didn't make
   *  (preset, AI, reopen, Convert to seeds). */
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

  function renderDraft(): void {
    const d = ctl.getPartDraft();
    draftBox.replaceChildren();
    nameInputs.clear();
    acceptBtn.disabled = !isDraft(d);
    discardBtn.disabled = !isDraft(d);
    edgeRow.classList.toggle('hidden', !isDraft(d));
    if (isDraft(d) && !edgeDragging && !edgeTimer) {
      edgeRange.value = String(d.edgeSmoothing);
      edgeVal.textContent = String(d.edgeSmoothing);
    }
    if (!isDraft(d)) {
      const saved = ctl.importsWithParts();
      if (saved.length) {
        const reopen = el('button', `${BUTTON_SMALL_SECONDARY} self-start`, 'Edit saved parts');
        reopen.title = 'Re-open the parts saved on this import (with their seeds) to refine them';
        reopen.addEventListener('click', async () => {
          const r = await ctl.reopenParts({ importIndex: saved[0] });
          if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
        });
        draftBox.append(el('div', SECTION, 'Saved parts'), reopen);
      }
      if (mode === 'pick') setMode(null);
      return;
    }
    syncControls(d);
    const q = d.quality;
    const head = el('div', 'flex items-center justify-between gap-2');
    head.append(el('div', SECTION, `Parts (${d.parts.length})`), pickPartBtn);
    draftBox.appendChild(head);
    draftBox.appendChild(el('div', HINT,
      `Boundary groove ${q.boundaryCreaseMean.toFixed(1)}° · islands ${q.islandCount} · unassigned ${(d.unassigned.areaFrac * 100).toFixed(1)}%`));
    if (d.detector === 'pieces' && d.parts.length <= 2) {
      draftBox.appendChild(el('div', 'text-[11px] text-amber-300/90 leading-snug',
        `Only ${d.parts.length} separate piece${d.parts.length === 1 ? '' : 's'}: this mesh is one fused solid. Try Auto patches (no seeds) or Crease watershed (seeded) to split it along its grooves.`));
    }
    if (d.focus) {
      const banner = el('div', 'flex items-center gap-2 text-[11px] text-blue-200 bg-blue-500/10 border border-blue-500/30 rounded px-2 py-1');
      banner.append(el('span', 'flex-1', `Focused on ${focusedName ?? 'one part'}: detection only changes that area.`));
      const clear = el('button', BUTTON_SMALL_SECONDARY, 'Clear focus');
      clear.addEventListener('click', async () => { if (await edit([{ op: 'focus', id: null }])) focusedName = null; });
      banner.appendChild(clear);
      draftBox.appendChild(banner);
    } else focusedName = null;

    const list = el('div', 'flex flex-col gap-1 max-h-56 overflow-y-auto pr-1');
    const selected = new Set<number>();
    for (const p of d.parts) {
      const row = el('div', 'flex items-center gap-1');
      row.dataset.partId = String(p.id);
      const check = el('input');
      check.type = 'checkbox';
      check.title = 'Select for merge';
      check.setAttribute('aria-label', `Select ${p.name}`);
      check.addEventListener('change', () => { if (check.checked) selected.add(p.id); else selected.delete(p.id); });
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
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (!v || v === p.name) return;
        // Same name as another part = merge into it.
        const other = d.parts.find((x) => x.name === v && x.id !== p.id);
        void edit(other ? [{ op: 'merge', ids: [other.id, p.id], name: v }] : [{ op: 'rename', id: p.id, name: v }]);
      });
      nameInputs.set(p.id, name);
      const pct = el('span', 'text-[10px] text-zinc-500 w-9 text-right shrink-0', `${(p.areaFrac * 100).toFixed(1)}%`);
      pct.title = `${p.triCount} triangles${p.regions > 1 ? `, ${p.regions} separate regions` : ''}`;
      const locked = 'locked' in p && p.locked === true;
      const lock = el('button', locked ? ICON_BTN_ON : ICON_BTN, locked ? '🔒' : '🔓');
      lock.title = locked ? 'Unlock: detection may change this part again' : 'Lock: keep this part as it is when detection re-runs';
      lock.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${p.name}`);
      lock.setAttribute('aria-pressed', String(locked));
      lock.addEventListener('click', () => { void edit([{ op: 'lock', id: p.id, locked: !locked }]); });
      const focus = el('button', ICON_BTN, '◎');
      focus.title = 'Focus: re-run detection (any method, any settings) only inside this part';
      focus.setAttribute('aria-label', `Focus on ${p.name}`);
      focus.addEventListener('click', async () => { if (await edit([{ op: 'focus', id: p.id }])) focusedName = p.name; renderDraft(); });
      const del = el('button', ICON_BTN, '✕');
      del.title = 'Remove part (its triangles become unassigned)';
      del.setAttribute('aria-label', `Remove part ${p.name}`);
      del.addEventListener('click', () => { void edit([{ op: 'delete', id: p.id }]); });
      row.append(check, sw.el, num, name, pct, lock, focus, del);
      list.appendChild(row);
    }
    draftBox.appendChild(list);

    const tools = el('div', 'flex flex-wrap gap-1.5');
    const mergeBtn = el('button', BUTTON_SMALL_SECONDARY, 'Merge selected');
    mergeBtn.addEventListener('click', () => {
      if (selected.size < 2) { showToast('Tick two or more parts to merge', { variant: 'neutral', source: 'parts' }); return; }
      void edit([{ op: 'merge', ids: [...selected] }]);
    });
    const absorbBtn = el('button', BUTTON_SMALL_SECONDARY, 'Absorb specks');
    const minFrac = getConfig().segmentation.absorbMinAreaFrac;
    absorbBtn.title = `Fold islands smaller than ${+(minFrac * 100).toFixed(2)}% of the surface into their neighbours`;
    absorbBtn.addEventListener('click', () => { void edit([{ op: 'absorbSmall', minAreaFrac: getConfig().segmentation.absorbMinAreaFrac }]); });
    const tidyBtn = el('button', BUTTON_SMALL_SECONDARY, 'Tidy edges');
    tidyBtn.title = 'Shave single-triangle stair-steps and spurs off part boundaries (changes which triangles belong to which part)';
    tidyBtn.addEventListener('click', () => { void edit([{ op: 'smoothBoundaries', iterations: getConfig().segmentation.smoothBoundaryIterations }]); });
    const seedsBtn = el('button', BUTTON_SMALL_SECONDARY, 'Convert to seeds');
    seedsBtn.title = 'Drop one seed in the middle of every part, named after it, and switch to Crease watershed — then move, add or remove seeds to refine.';
    seedsBtn.addEventListener('click', () => { void edit([{ op: 'seedsFromParts' }]); });
    const undoBtn = el('button', BUTTON_SMALL_SECONDARY, 'Undo');
    undoBtn.disabled = !d.canUndo;
    undoBtn.addEventListener('click', () => { void edit([{ op: 'undo' }]); });
    tools.append(mergeBtn, absorbBtn, tidyBtn, seedsBtn, undoBtn);
    draftBox.appendChild(tools);

    const overlayRow = el('label', 'flex items-center gap-1.5 text-[12px] text-zinc-300');
    const overlay = el('input');
    overlay.type = 'checkbox';
    overlay.checked = ctl.isOverlayVisible();
    overlay.addEventListener('change', () => ctl.setPartsOverlay(overlay.checked));
    overlayRow.append(overlay, el('span', '', 'Show parts overlay'));
    draftBox.appendChild(overlayRow);
  }

  // --- Viewport interaction (markers, place, pick) ---------------------------------
  let drag: { index: number; point: [number, number, number] | null } | null = null;
  let press: { x: number; y: number } | null = null;

  const unhookPointer = addPointerSuppressor((evt: PointerEvent) => {
    if (evt.type !== 'pointerdown') return false;
    const idx = markers.hitTest(evt);
    if (idx >= 0) {
      if (evt.button === 2) { removeSeed(idx); return true; }
      if (evt.button === 0) { drag = { index: idx, point: null }; return true; }
    }
    if (mode && evt.button === 0) press = { x: evt.clientX, y: evt.clientY };
    return false;
  });

  function onWindowMove(evt: PointerEvent): void {
    if (!drag) return;
    const hit = pickFace(evt);
    if (!hit) return;
    drag.point = hit.point;
    markers.moveMarker(drag.index, hit.point);
  }

  function onWindowUp(evt: PointerEvent): void {
    if (drag) {
      const { index, point } = drag;
      drag = null;
      if (point) {
        const s = ctl.getSeeds();
        if (s[index]) { s[index] = { label: s[index].label, point }; writeSeeds(s); }
      }
      return;
    }
    if (!press || !mode) { press = null; return; }
    const moved = Math.hypot(evt.clientX - press.x, evt.clientY - press.y);
    press = null;
    if (moved > CLICK_SLOP_PX || evt.target !== getCanvas()) return;
    const hit = pickFace(evt);
    if (!hit) return;
    if (mode === 'seed') {
      const label = labelInput.value.trim();
      if (!label) { showToast('Type a part name first', { variant: 'warn', source: 'parts' }); return; }
      writeSeeds([...ctl.getSeeds(), { label, point: hit.point }]);
    } else {
      const p = ctl.partAtFace(hit.triangleIndex);
      if (!p) { showToast('No part there', { variant: 'neutral', source: 'parts' }); return; }
      const input = nameInputs.get(p.id);
      if (input) {
        input.scrollIntoView({ block: 'nearest' });
        input.focus();
        input.select();
      }
    }
  }

  function onContextMenu(evt: MouseEvent): void {
    if (markers.hitTest(evt) >= 0) evt.preventDefault();
  }

  function onKeyDown(evt: KeyboardEvent): void {
    if ((evt.key === 'h' || evt.key === 'H') && !evt.repeat && !isTyping(evt.target) && !evt.metaKey && !evt.ctrlKey && !evt.altKey) {
      holdHide = true;
      applyMarkerVisibility();
    }
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
  getCanvas().addEventListener('contextmenu', onContextMenu);

  // --- Footer ------------------------------------------------------------------
  const discardBtn = el('button', BUTTON_CANCEL, 'Discard');
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

  const unsubscribe = ctl.subscribe((ev) => {
    if (ev === 'draft') { renderDraft(); renderSeeds(); }
    if (ev === 'seeds') renderSeeds();
    if (ev === 'presets') renderStrip();
    const b = ctl.isBusy();
    detectBtn.disabled = !!b;
    presetBtn.disabled = !!b;
    cancelBtn.classList.toggle('hidden', !b?.cancellable);
    status.textContent = b ? `${b.message} ${Math.round(b.fraction * 100)}%` : '';
  });

  algoSelect.addEventListener('change', () => {
    void ctl.showPresetPreview(null);
    carriedEdgeLengths = null;
    buildParams();
    scheduleLive();
  });
  buildParams();
  renderSeeds();
  renderDraft();
  applyMarkerVisibility();
}

/** Wire Part Detection into the command palette, the viewport Tools menu and
 *  the controller's openPartsPanel(). */
export function initPartDetectionUI(ctl: PartDetectionApi): void {
  ctl.setPanelOpener(() => openPartDetectionPanel(ctl));
  registerCommands([
    {
      id: 'detect-parts',
      title: 'Detect parts…',
      hint: 'Paint',
      keywords: 'detect parts segment segmentation split regions imported stl figure hair face label colorize auto paint seeds presets',
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
