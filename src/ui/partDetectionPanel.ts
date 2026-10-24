// Part Detection panel (#1025) — split an imported mesh into named parts.
//
// A docked, non-modal tool panel in three steps: START (method, presets,
// detect), REFINE (tools + the part list) and ACCEPT (footer). Every control
// calls the same controller the window.partwright / AI methods use, so the
// two surfaces can't drift. The detector dropdown, its parameter controls and
// its presets are generated from the registry.
//
// LABEL CHIPS (#1050) are the fast path: a strip of named parts with default
// colours (hair, face, eyes… or part 1…9, plus custom ones). Picking a chip
// (click, or 1–9) arms the Pin tool with that name and colour; each click on
// the model then places a named pin and re-grows, so a figurine splits into
// coloured parts without typing. Chips need a seeded method: picking one
// while a seedless method (auto patches, pieces) is selected switches to
// Crease watershed, and a seedless draft is cleared (undoably) rather than
// mixed with pins. A chip shows ✓ once it owns a part, or "missed — click
// again" when its pin grew nothing.
//
// Parts own their pins: every part has at least one (automatic pins are
// drawn smaller and see-through, and hidden unless "Show automatic pins" is
// on or their part is selected). Viewport interaction while the panel is
// open:
//   - hovering the model names the part under the cursor and jumps the list
//     to it; hovering a row highlights the part on the model;
//   - Select tool (V): click a part to select it (Shift/Ctrl-click toggles,
//     Alt-click removes), Shift-drag adds parts to the selection, Esc
//     clears; the action bar merges / solos / locks / colours / deletes;
//   - Select-tool brush ("grab your part and paint more of it"): a drag that
//     starts on a SELECTED part brushes more of the model into it (one
//     `brush` edit on release, previewed as a ghost in the part's colour);
//     Alt-drag swallows every touched part whole. Any other drag orbits.
//     Mouse and pen only: a one-finger drag still orbits on touch;
//   - type to name: with one part selected, a letter that isn't a panel
//     shortcut opens a rename popover at the cursor, pre-filled (existing
//     part names + chip names; Enter takes the exact text, and a taken name
//     merges); R opens it empty for the part under the cursor; M merges the
//     selection; Enter accepts;
//   - Pin tool (P): click to add a pin for the chosen part (or a new name);
//     only the parts around it re-grow;
//   - Fix tool (B): drag to paint triangles into a part — fixed triangles
//     stay put when pins move;
//   - in any tool, drag a pin to move it and right-click it to delete it;
//     the eye toggle or holding H hides pins;
//   - clicks are press-and-release without moving, so dragging still orbits
//     (except the brushes and Shift-drag select, which own the drag).
//
// Once a draft exists the Start details (method, presets, Detect) fold into
// a summary line; a 1–2-piece Separate-pieces proposal on a fused figure
// opens with the first chip armed. Below the md breakpoint the panel is a
// bottom sheet with compact rows (swatch, name, size, ⋯ menu).

import { pickFace } from '../color/facePicker';
import { openPaintWithin, setDetectPartsEntry } from '../color/paintUI';
import { getConfig } from '../config/appConfig';
import { addPointerSuppressor, getCanvas } from '../renderer/viewport';
import { MAX_EDGE_SMOOTHING, overlayColor } from '../segmentation/draft';
import { chipState, isFusedPiecesDraft, labelPreset, LABEL_PRESETS, type LabelChip, type LabelPresetId } from '../segmentation/labelPresets';
import { NATURAL_TONE_SWATCHES } from '../color/naturalTones';
import type { BrushMode } from '../segmentation/draft';
import type { PartDetectionApi } from '../segmentation/partDetection';
import { createSeedMarkers } from '../segmentation/seedMarkers';
import type { ParamSpec } from '../segmentation/types';
import { createColorSwatch } from './colorPickerModal';
import { registerCommands } from './commandPalette';
import { BUTTON_CANCEL, BUTTON_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { createToolPanelShell } from './toolPanel';
import { setInitialPanelPosition } from './viewportPanelDrag';
import { createSliderEntry, formatEntry } from './sliderEntry';

let closeOpen: (() => void) | null = null;
/** Which label-chip set the panel shows, and the user's custom chips — kept
 *  for this tab (not persisted) so reopening the panel keeps them. */
let chipSetId: LabelPresetId = 'figure';
const customChips: LabelChip[] = [];

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
/** The same, shown only from md up (phone rows fold these into ⋯). */
const deskOnly = (cls: string) => cls.replace(' flex ', ' hidden md:flex ');
const ICON_BTN_ON = 'shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center rounded text-blue-300 bg-blue-500/20 [@media(hover:hover)]:hover:bg-blue-500/30';
const TOGGLE_ON = 'px-2 py-1 rounded text-[11px] text-blue-200 bg-blue-500/30 border border-blue-500/50';
const ROW = 'flex items-center gap-1 rounded px-0.5';
const ROW_SELECTED = 'bg-blue-500/15 ring-1 ring-blue-500/40';
const ROW_HOVER = 'bg-zinc-700/50';
/** A press that moves less than this (px) counts as a click, not an orbit. */
const CLICK_SLOP_PX = 6;
/** Letters the panel uses as shortcuts — they never start a typed name
 *  (R opens the rename box empty instead). */
const PANEL_SHORTCUT_KEYS = new Set(['v', 'p', 'b', 's', 'h', 'm', 'r']);
/** Holding a pin this long without dragging deletes it (touch has no
 *  right-click). An interaction convention, not a tuning knob. */
const PIN_LONG_PRESS_MS = 600;
/** How long the "Applied preset · Undo" banner stays up (ms). */
const APPLIED_BANNER_MS = 8000;
/** Label chips: a pill with a 44 px touch target on mobile. */
const CHIP = 'shrink-0 inline-flex items-center gap-1.5 min-h-11 md:min-h-0 px-2 py-1 rounded-full border text-[12px] select-none';
const CHIP_IDLE = 'border-zinc-600 bg-zinc-800 text-zinc-200 [@media(hover:hover)]:hover:border-zinc-400';
const CHIP_ARMED = 'border-blue-400 bg-blue-500/25 text-blue-50 ring-1 ring-blue-400/60';
const CHIP_MISSED = 'border-amber-500/70 bg-amber-500/10 text-amber-100';

type Draft = Exclude<ReturnType<PartDetectionApi['getPartDraft']>, { draft: null }>;
type Tool = 'select' | 'pin' | 'fix';

function isDraft(x: unknown): x is Draft {
  return !!x && typeof x === 'object' && Array.isArray((x as Draft).parts);
}

/** Below the md breakpoint the panel is a bottom sheet with compact rows. */
function isPhone(): boolean {
  return !window.matchMedia('(min-width: 768px)').matches;
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
  /** Automatic pins are hidden by default (placed pins always show; a
   *  selected part shows its automatic pins too). */
  let showAutoPins = false;
  /** The chip the Pin tool is armed with (its name is the pin's part). */
  let armed: LabelChip | null = null;
  /** Chips whose last pin grew no part (shown as "missed — click again"). */
  const chipMissed = new Set<string>();
  /** Set right after Accept: the panel offers the next steps instead of a
   *  live Accept button. Cleared when a draft appears again. */
  let justSaved: { names: string[]; colored: boolean } | null = null;
  /** A chip pin's first detection is running (picking another chip must not
   *  cancel it). */
  let chipDetecting = false;
  let holdHide = false;
  let lastSyncedRun = '';
  let focusedName: string | null = null;
  /** Edge-length-relative denoise from a synced run (e.g. the "Denoised
   *  scan" preset) — carried into the next Detect while the box is blank. */
  let carriedEdgeLengths: number | null = null;
  /** The Start section folds away once a draft exists (chips stay); the
   *  expander brings the method, presets and Detect back. */
  let startCollapsed = false;
  let hadDraft = false;
  /** Last pointer position over the canvas (where the rename popover opens). */
  let lastPointer: { x: number; y: number } | null = null;
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
      window.removeEventListener('pointercancel', onWindowCancel);
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
      if (selBrush?.raf) cancelAnimationFrame(selBrush.raf);
      selBrush = null;
      ctl.setBrushGhost(null);
      closePopover();
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
    const p = shell.panel;
    if (isPhone()) {
      // Phone: a bottom sheet, so the model stays visible (and clickable for
      // Select / Pin / Fix) above it. Re-applied after a header drag.
      const h = Math.round(window.innerHeight * getConfig().segmentation.mobileSheetHeightFrac);
      Object.assign(p.style, { left: '0px', right: '0px', top: 'auto', bottom: '0px', width: '100%', maxWidth: '100%', height: `${h}px`, maxHeight: `${h}px` });
      p.classList.add('rounded-b-none');
      p.dataset.sheet = '';
      return;
    }
    if ('sheet' in p.dataset) {
      delete p.dataset.sheet;
      p.classList.remove('rounded-b-none');
      Object.assign(p.style, { width: '', maxWidth: '', height: '' });
      setInitialPanelPosition(p);
    }
    const top = p.getBoundingClientRect().top;
    p.style.maxHeight = `${Math.max(240, window.innerHeight - Math.max(0, top) - 8)}px`;
  }
  const onResize = () => fitToWindow();
  window.addEventListener('resize', onResize);
  // The header drag moves the panel; refit when it's dropped.
  shell.panel.addEventListener('pointerup', onResize);

  let contextBanner: HTMLElement | null = null;
  if (opts?.context) {
    const banner = el('div', 'flex flex-col gap-1.5 rounded border border-zinc-700 bg-zinc-800/60 px-2.5 py-2');
    contextBanner = banner;
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
  // --- Label chips -------------------------------------------------------------
  const chipHead = el('div', 'flex items-center gap-1.5');
  const chipSetSelect = el('select', `${INPUT} min-h-11 md:min-h-0`);
  chipSetSelect.setAttribute('aria-label', 'Label set');
  chipSetSelect.title = 'Which label chips to show: figure parts or generic part 1…9';
  for (const p of LABEL_PRESETS) { const o = el('option', '', p.title); o.value = p.id; chipSetSelect.appendChild(o); }
  chipSetSelect.value = chipSetId;
  chipHead.append(el('span', 'text-[12px] text-zinc-300 flex-1 min-w-0', 'Label parts: pick one, click it on the model'), chipSetSelect);
  // shrink-0: a scroll container in the panel's flex column would otherwise
  // collapse to nothing on a short (phone) screen.
  const chipStrip = el('div', 'shrink-0 flex gap-1.5 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0');
  chipStrip.setAttribute('role', 'toolbar');
  chipStrip.setAttribute('aria-label', 'Label chips');
  // "+ custom": name + colour, added to the strip.
  const customRow = el('div', 'hidden flex items-center gap-1.5');
  const customName = el('input', `${INPUT} flex-1 min-w-0 min-h-11 md:min-h-0`);
  customName.placeholder = 'part name';
  customName.setAttribute('aria-label', 'Custom label name');
  let customHex = overlayColor(customChips.length + 9, null);
  const customSwatch = createColorSwatch({
    initialHex: customHex,
    title: 'Colour for the custom label',
    className: 'w-11 h-11 md:w-6 md:h-6 rounded border border-zinc-600 shrink-0',
    extraSwatches: NATURAL_TONE_SWATCHES,
    onPick: (hex) => { customHex = hex; },
  });
  const customAdd = el('button', `${BUTTON_SMALL_SECONDARY} min-h-11 md:min-h-0`, 'Add');
  const customCancel = el('button', ICON_BTN, '✕');
  customCancel.title = 'Cancel';
  customCancel.setAttribute('aria-label', 'Cancel custom label');
  customRow.append(customName, customSwatch.el, customAdd, customCancel);
  function addCustomChip(): void {
    const name = customName.value.trim().slice(0, 64);
    if (!name) { customName.focus(); return; }
    const chip = { name, color: customHex };
    const at = customChips.findIndex((c) => c.name === name);
    if (at >= 0) customChips[at] = chip; else customChips.push(chip);
    customName.value = '';
    customHex = overlayColor(customChips.length + 9, null);
    customSwatch.setHex(customHex);
    customRow.classList.add('hidden');
    void pickChip(chip);
  }
  customAdd.addEventListener('click', addCustomChip);
  customName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomChip(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); customRow.classList.add('hidden'); }
  });
  customCancel.addEventListener('click', () => customRow.classList.add('hidden'));
  chipSetSelect.addEventListener('change', () => {
    chipSetId = chipSetSelect.value as LabelPresetId;
    renderChips();
  });
  body.append(chipHead, chipStrip, customRow);
  // Once a draft exists the rest of Start (method, presets, Detect) folds
  // into this one-line summary; the chips above stay.
  const startSummary = el('div', 'hidden flex items-center gap-2 text-[11px] text-zinc-400');
  startSummary.dataset.startSummary = '';
  const startSummaryText = el('span', 'flex-1 min-w-0 truncate');
  const startToggle = el('button', `${BUTTON_SMALL_SECONDARY} min-h-11 md:min-h-0 shrink-0`);
  startToggle.type = 'button';
  startToggle.setAttribute('aria-controls', 'parts-start-details');
  startToggle.addEventListener('click', () => { startCollapsed = !startCollapsed; syncStart(); });
  startSummary.append(startSummaryText, startToggle);
  const startDetails = el('div', 'flex flex-col gap-3');
  startDetails.id = 'parts-start-details';
  body.append(startSummary, startDetails);
  startDetails.appendChild(el('div', HINT, 'Or detect automatically:'));
  const algoSelect = el('select', `${INPUT} w-full`);
  algoSelect.setAttribute('aria-label', 'Detection method');
  for (const d of info.detectors) {
    const o = el('option', '', d.name);
    o.value = d.id;
    algoSelect.appendChild(o);
  }
  algoSelect.value = info.detectors.find((d) => d.id === 'auto-merge') ? 'auto-merge' : info.detectors[0].id;
  const algoHint = el('div', HINT);
  startDetails.append(algoSelect, algoHint);

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
  startDetails.append(presetRow, stripWrap);
  body.append(appliedBanner);

  const paramBox = el('div', 'flex flex-col gap-1.5');
  startDetails.appendChild(paramBox);
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
        const integer = p.type === 'integer';
        const step = p.step ?? (integer ? 1 : undefined);
        if (p.min !== undefined && p.max !== undefined) {
          // Bounded numbers get a slider too (Live updates as it moves); the
          // box takes an exact value within the same bounds.
          const entry = createSliderEntry({
            label: p.label, min: p.min, max: p.max, step: step ?? (p.max - p.min) / 100,
            value: Number(init), integer,
            format: v => formatEntry(v),
            onChange: () => scheduleLive(),
            title: '',
            rangeClass: 'w-24 accent-blue-500',
            inputClass: `${INPUT} w-16`,
          });
          entry.range.setAttribute('aria-label', `${p.label} slider`);
          paramInputs.set(p.key, { get: entry.get, set: (v) => entry.set(Number(v)) });
          paramBox.appendChild(paramRow(p.label, p.hint, entry.range, entry.input));
        } else {
          const n = el('input', `${INPUT} w-16`);
          n.type = 'number';
          n.value = String(init);
          n.step = step !== undefined ? String(step) : 'any';
          if (p.min !== undefined) n.min = String(p.min);
          if (p.max !== undefined) n.max = String(p.max);
          n.setAttribute('aria-label', p.label);
          n.addEventListener('change', () => scheduleLive());
          paramInputs.set(p.key, { get: () => Number(n.value), set: (v) => { n.value = String(v); } });
          paramBox.appendChild(paramRow(p.label, p.hint, n));
        }
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
  const needPinsHint = el('div', `${HINT} hidden`, 'This method grows parts from pins: pick a label chip above (or the Pin tool below) and click the model once or more per part.');
  startDetails.append(actionRow, needPinsHint);

  /** Fold or show the Start details (see startCollapsed). */
  function syncStart(): void {
    const has = isDraft(ctl.getPartDraft());
    const collapsed = has && startCollapsed;
    startDetails.classList.toggle('hidden', collapsed);
    startSummary.classList.toggle('hidden', !has);
    startToggle.textContent = collapsed ? '▸ Detection settings' : '▾ Hide settings';
    startToggle.title = collapsed ? 'Show the method, presets and Detect' : 'Fold the detection settings away';
    startToggle.setAttribute('aria-expanded', String(!collapsed));
    const b = ctl.isBusy();
    startSummaryText.textContent = b ? `${b.message} ${Math.round(b.fraction * 100)}%` : `Method: ${detectorOf(algoSelect.value).name}`;
  }

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
      if ('canUndo' in r && r.canUndo) showUndoBanner(`Applied preset “${name}”.`);
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

  /** A transient "<what happened> · Undo" banner (a preset applied, a
   *  method switch that started fresh). */
  function showUndoBanner(message: string): void {
    appliedBanner.replaceChildren();
    const undo = el('button', BUTTON_SMALL_SECONDARY, 'Undo');
    undo.addEventListener('click', async () => {
      appliedBanner.classList.add('hidden');
      armed = null;
      await edit([{ op: 'undo' }]);
    });
    appliedBanner.append(el('span', 'flex-1', message), undo);
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
  toolBtns.select.title = 'Click parts to select them; drag from a selected part to brush more of the model into it (Alt-drag: whole parts); Shift-drag adds to the selection; any other drag orbits';
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
  const brushRange = el('input', 'w-20 accent-blue-500');
  brushRange.type = 'range';
  brushRange.min = '0.3'; brushRange.max = '4'; brushRange.step = '0.1'; brushRange.value = '1';
  brushRange.setAttribute('aria-label', 'Brush size');
  brushRange.title = 'Brush size for the Select brush and the Fix tool (× the default in Advanced Settings)';
  toolRow.appendChild(brushRange);
  targetRow.append(targetLabel, targetInput, targetList);
  // Typing another name disarms the chip (its colour no longer applies).
  targetInput.addEventListener('input', () => {
    if (armed && targetInput.value.trim() !== armed.name) { armed = null; renderChips(); }
  });
  body.append(toolRow, toolHint, targetRow);

  const TOOL_HINTS: Record<Tool, string> = {
    select: 'Click a part to select it · drag from the SELECTED part to brush more of the model into it (Alt-drag swallows whole parts; other drags orbit) · Shift-click toggles · Shift-drag adds parts · M merges · with one part selected just type a name (names starting with V, P, B, S, H, M or R: press R first) · Enter accepts · Esc clears.',
    pin: 'Click the model to add a pin for the part above (type a new name to start a new part). Only nearby parts re-grow. Drag a pin to move it; right-click (or long-press) it to delete.',
    fix: 'Drag on the model to paint triangles into the part above. Fixed triangles stay put when pins move. Right-drag still pans; switch tool to orbit.',
  };

  function setTool(next: Tool): void {
    tool = next;
    if (tool !== 'pin' && armed) { armed = null; renderChips(); }
    for (const [k, b] of Object.entries(toolBtns) as [Tool, HTMLButtonElement][]) {
      b.className = k === tool ? TOGGLE_ON : BUTTON_SMALL_SECONDARY;
      b.setAttribute('aria-pressed', String(k === tool));
    }
    toolHint.textContent = TOOL_HINTS[tool];
    targetRow.classList.toggle('hidden', tool === 'select');
    brushRange.classList.toggle('hidden', tool === 'pin');
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
  /** The action bar's merge-name box (M merges under its name). */
  let mergeNameInput: HTMLInputElement | null = null;
  async function mergeSelection(): Promise<void> {
    const sel = ctl.getPartSelection().parts;
    if (sel.length < 2) { showToast('Select two or more parts to merge (Shift-click or Shift-drag)', { variant: 'neutral', source: 'parts' }); return; }
    const name = mergeNameInput?.value.trim() || sel[0].name;
    // Clear the selection: the next Shift-drag starts a new set instead of
    // dragging the merged part along.
    if (await edit([{ op: 'merge', ids: sel.map((p) => p.id), name }])) ctl.setPartSelection(null);
  }
  function renderActionBar(force = false): void {
    const sel = ctl.getPartSelection().parts;
    const key = JSON.stringify([sel, ctl.getPartsView().mode]);
    if (!force && key === actionBarKey) return;
    actionBarKey = key;
    actionBar.classList.toggle('hidden', sel.length === 0);
    actionBar.replaceChildren();
    mergeNameInput = null;
    if (sel.length === 0) return;
    actionBar.appendChild(el('span', 'text-[11px] text-blue-100 mr-1', `${sel.length} selected`));
    if (sel.length === 1) {
      const rename = el('button', BUTTON_SMALL_SECONDARY, 'Rename…');
      rename.title = 'Name this part (or just start typing). A name another part has merges the two.';
      rename.addEventListener('click', () => {
        const r = rename.getBoundingClientRect();
        openRenamePopover(sel[0].name, '', { x: r.left, y: r.bottom + 4 });
      });
      actionBar.appendChild(rename);
    }
    const mergeName = el('input', `${INPUT} w-28`);
    mergeNameInput = mergeName;
    mergeName.value = sel[0].name;
    mergeName.setAttribute('aria-label', 'Merged part name');
    const mergeBtn = el('button', BUTTON_SMALL_SECONDARY, 'Merge');
    mergeBtn.disabled = sel.length < 2;
    mergeBtn.title = 'Merge the selected parts into one, named as typed (M)';
    const doMerge = () => mergeSelection();
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
      extraSwatches: NATURAL_TONE_SWATCHES,
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
    if (isDraft(d)) justSaved = null;
    // A draft appearing folds the Start details; no draft shows them again.
    if (isDraft(d) && !hadDraft) startCollapsed = true;
    if (!isDraft(d)) startCollapsed = false;
    hadDraft = isDraft(d);
    syncStart();
    syncFooter();
    acceptBtn.disabled = !isDraft(d) || d.parts.length === 0;
    discardBtn.disabled = !isDraft(d) && ctl.getSeeds().length === 0;
    renderChips();
    edgeRow.classList.toggle('hidden', !isDraft(d));
    if (isDraft(d) && !edgeDragging && !edgeTimer) {
      edgeRange.value = String(d.edgeSmoothing);
      edgeVal.textContent = String(d.edgeSmoothing);
    }
    needPinsHint.classList.toggle('hidden', isDraft(d) || detectorOf(algoSelect.value).seeds !== 'required' || ctl.getSeeds().length > 0);
    targetList.replaceChildren(...(isDraft(d) ? d.parts.map((p) => { const o = el('option'); o.value = p.name; return o; }) : []));
    if (!isDraft(d)) {
      const saved = ctl.importsWithParts();
      if (justSaved) {
        draftBox.appendChild(savedCard(justSaved));
        renderActionBar(true);
        return;
      }
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
    // The import banner already says this (in the same words) while shown.
    if (d.detector === 'pieces' && d.parts.length <= 2 && !contextBanner) {
      const n = d.parts.length;
      draftBox.appendChild(el('div', 'text-[11px] text-amber-300/90 leading-snug',
        `${n === 1 ? 'One solid piece' : `Only ${n} separate pieces`}: the largest is one fused solid, so its regions (hair, face…) aren't split yet. Pick a label chip above and click each part on the model, or try Auto patches.`));
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
      const handle = el('span', deskOnly('shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center text-zinc-500 cursor-grab touch-none select-none'), '⋮⋮');
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
      const checkWrap = el('label', deskOnly('shrink-0 w-11 h-11 md:w-6 md:h-6 flex items-center justify-center cursor-pointer'));
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
        extraSwatches: NATURAL_TONE_SWATCHES,
        onPick: (hex) => { void edit([{ op: 'setColor', id: p.id, color: hex }]); },
      });
      const num = el('span', 'hidden md:inline text-[11px] text-zinc-500 w-5 text-right shrink-0', String(p.id));
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
      // A part its pin barely grew (a placed pin that "missed") is flagged.
      const tiny = p.areaFrac < getConfig().segmentation.chipMissAreaFrac;
      const pct = el('span', `text-[10px] ${tiny ? 'text-amber-300' : 'text-zinc-500'} w-10 text-right shrink-0`, `${tiny ? '⚠ ' : ''}${(p.areaFrac * 100).toFixed(1)}%`);
      pct.title = tiny
        ? `Almost nothing (${p.triCount} triangles): its pin barely grew. Move the pin nearer the middle of the part, or brush the area in.`
        : `${p.triCount} triangles${p.regions > 1 ? `, ${p.regions} separate regions` : ''}`;
      if (tiny) row.dataset.partTiny = '';
      const pins = el('span', 'hidden md:inline text-[10px] text-zinc-500 w-6 text-right shrink-0', `📍${p.pins}`);
      pins.title = `${p.pins} pin${p.pins === 1 ? '' : 's'}`;
      const locked = 'locked' in p && p.locked === true;
      const lock = el('button', deskOnly(locked ? ICON_BTN_ON : ICON_BTN), locked ? '🔒' : '🔓');
      lock.title = locked ? 'Unlock: detection may change this part again' : 'Lock: keep this part as it is when detection re-runs';
      lock.setAttribute('aria-label', `${locked ? 'Unlock' : 'Lock'} ${p.name}`);
      lock.setAttribute('aria-pressed', String(locked));
      lock.addEventListener('click', () => { void edit([{ op: 'lock', id: p.id, locked: !locked }]); });
      const soloOn = soloSet.has(p.name);
      const solo = el('button', deskOnly(soloOn ? ICON_BTN_ON : ICON_BTN), '◐');
      solo.title = soloOn ? 'Show all parts' : 'Solo: show only this part in colour';
      solo.setAttribute('aria-label', `Solo ${p.name}`);
      solo.setAttribute('aria-pressed', String(soloOn));
      solo.addEventListener('click', () => ctl.setPartsView(soloOn ? { mode: 'all' } : { mode: 'solo', parts: [p.name] }));
      const del = el('button', deskOnly(ICON_BTN), '✕');
      del.title = 'Remove part (its triangles become unassigned)';
      del.setAttribute('aria-label', `Remove part ${p.name}`);
      del.addEventListener('click', () => { void edit([{ op: 'delete', id: p.id }]); });
      // Mouse only: a tap would leave the hover stuck.
      row.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') ctl.setHoveredPart(p.name); });
      row.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && ctl.getHoveredPart() === p.name) ctl.setHoveredPart(null); });
      // Phone rows: name, swatch, size and a ⋯ menu with the rest.
      const more = el('button', ICON_BTN.replace(' flex ', ' flex md:hidden '), '⋯');
      more.title = `More for ${p.name}`;
      more.setAttribute('aria-label', `More for ${p.name}`);
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', () => {
        // Read selection / solo now: they change without re-rendering rows.
        const isSel = ctl.getPartSelection().parts.some((x) => x.name === p.name);
        const v = ctl.getPartsView();
        const isSolo = v.mode === 'solo' && v.parts.includes(p.name);
        openRowMenu(more, [
          { label: isSel ? 'Deselect' : 'Select', run: () => ctl.setPartSelection([p.name], { mode: 'toggle' }) },
          { label: isSolo ? 'Show all' : 'Solo', run: () => ctl.setPartsView(isSolo ? { mode: 'all' } : { mode: 'solo', parts: [p.name] }) },
          { label: locked ? 'Unlock' : 'Lock', run: () => { void edit([{ op: 'lock', id: p.id, locked: !locked }]); } },
          { label: 'Rename…', run: () => { const r = more.getBoundingClientRect(); openRenamePopover(p.name, '', { x: r.left, y: r.bottom + 4 }); } },
          { label: 'Remove', run: () => { void edit([{ op: 'delete', id: p.id }]); } },
        ]);
      });
      row.append(handle, checkWrap, sw.el, num, name, pct, pins, lock, solo, del, more);
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
    const autoRow = el('label', 'flex items-center gap-1.5 text-[12px] text-zinc-300');
    autoRow.title = 'Automatic pins sit in the middle of every part region. Hidden by default (a selected part still shows its own); placed pins always show.';
    const autoBox = el('input');
    autoBox.type = 'checkbox';
    autoBox.checked = showAutoPins;
    autoBox.addEventListener('change', () => { showAutoPins = autoBox.checked; renderPins(); });
    autoRow.append(autoBox, el('span', '', 'Show automatic pins'));
    draftBox.appendChild(autoRow);
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

  // ======================================================== rename popover
  /** The open popover (rename box or a row's ⋯ menu); one at a time. */
  let popover: { el: HTMLElement; close: () => void } | null = null;
  function closePopover(): void { popover?.close(); }

  function placeFloating(box: HTMLElement, at: { x: number; y: number }): void {
    const r = box.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8))}px`;
  }

  /** Mount a floating box that closes on a press outside it. */
  function mountPopover(box: HTMLElement, at: { x: number; y: number }): void {
    closePopover();
    document.body.appendChild(box);
    placeFloating(box, at);
    const outside = (e: PointerEvent) => { if (!box.contains(e.target as Node)) close(); };
    const close = () => {
      if (popover?.el !== box) return;
      popover = null;
      document.removeEventListener('pointerdown', outside, true);
      box.remove();
    };
    document.addEventListener('pointerdown', outside, true);
    popover = { el: box, close };
  }

  function rowAnchor(name: string): { x: number; y: number } | null {
    const r = rowsByName.get(name)?.getBoundingClientRect();
    return r ? { x: r.left + 24, y: r.bottom + 2 } : null;
  }

  /** Name candidates: the draft's other parts (picking one merges into it)
   *  and the label chips (picking one also gives a fresh part its colour). */
  function nameSuggestions(exclude: string): { name: string; color: string; merges: boolean }[] {
    const d = ctl.getPartDraft();
    const out = (isDraft(d) ? d.parts : []).filter((p) => p.name !== exclude).map((p) => ({ name: p.name, color: p.displayColor, merges: true }));
    for (const c of chipList()) if (c.name !== exclude && !out.some((o) => o.name === c.name)) out.push({ name: c.name, color: c.color, merges: false });
    return out;
  }

  /** "Click a patch, type a name": a small autocomplete at the cursor. Enter
   *  renames the part; a name another part has merges the two (rename's
   *  merge rule); Esc cancels. */
  function openRenamePopover(partName: string, initial: string, at: { x: number; y: number } | null): void {
    const box = el('div', 'fixed z-40 w-60 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-600 bg-zinc-900/95 shadow-xl p-1.5 flex flex-col gap-1');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `Rename ${partName}`);
    box.dataset.renamePopover = '';
    const input = el('input', `${INPUT} w-full min-h-11 md:min-h-0`);
    input.value = initial;
    input.placeholder = `name for “${partName}”`;
    input.setAttribute('aria-label', 'Part name');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'parts-rename-list');
    const list = el('div', 'flex flex-col max-h-56 overflow-y-auto');
    list.id = 'parts-rename-list';
    list.setAttribute('role', 'listbox');
    box.append(input, list, el('div', 'text-[10px] text-zinc-500 px-1 leading-snug', 'Enter names it · a taken name merges · Esc cancels'));
    let items: { name: string; color: string; merges: boolean; typed?: boolean }[] = [];
    let active = -1;
    let navigated = false;
    const paintActive = () => {
      list.querySelectorAll<HTMLElement>('[role="option"]').forEach((o, i) => {
        o.setAttribute('aria-selected', String(i === active));
        o.classList.toggle('bg-blue-500/25', i === active);
      });
    };
    const render = () => {
      const q = input.value.trim();
      const ql = q.toLowerCase();
      const all = nameSuggestions(partName);
      const starts = (n: string) => n.toLowerCase().startsWith(ql);
      const matches = q ? all.filter((x) => x.name.toLowerCase().includes(ql)).sort((a, b) => Number(!starts(a.name)) - Number(!starts(b.name))) : all;
      items = matches.slice(0, 8);
      if (q && q !== partName && !all.some((x) => x.name === q)) items.push({ name: q, color: '', merges: false, typed: true });
      // Enter takes exactly what was typed ("eye" never becomes "eyes");
      // the highlight says so: an exact (case-insensitive) match, else the
      // typed text. Arrow / Tab / a click pick a suggestion instead.
      navigated = false;
      const exact = items.findIndex((x) => !x.typed && x.name.toLowerCase() === ql);
      active = !q ? -1 : exact >= 0 ? exact : items.findIndex((x) => x.typed);
      list.replaceChildren();
      items.forEach((it) => {
        const b = el('button', 'flex items-center gap-2 text-left px-2 min-h-11 md:min-h-0 py-1 rounded text-[12px] text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/60');
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.dataset.name = it.name;
        const dot = el('span', 'w-3 h-3 rounded-full border border-zinc-400/70 shrink-0');
        if (it.color) dot.style.backgroundColor = it.color;
        b.append(dot, el('span', 'flex-1 min-w-0 truncate', it.typed ? `“${it.name}”` : it.name),
          el('span', 'text-[10px] text-zinc-500 shrink-0', it.typed ? 'new part' : it.merges ? 'merge into' : 'label'));
        // pointerdown, so the outside-press closer never sees it first.
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); void apply(it.name); });
        list.appendChild(b);
      });
      paintActive();
    };
    const apply = async (raw: string) => {
      popover?.close();
      const v = raw.trim().slice(0, 64);
      if (!v || v === partName) return;
      const d = ctl.getPartDraft();
      const merges = isDraft(d) && d.parts.some((p) => p.name === v);
      const chip = chipList().find((c) => c.name === v);
      const cur = isDraft(d) ? d.parts.find((p) => p.name === partName) : undefined;
      const ops: Record<string, unknown>[] = [{ op: 'rename', id: partName, name: v }];
      if (!merges && chip && !cur?.color) ops.push({ op: 'setColor', id: v, color: chip.color });
      if (!await edit(ops)) return;
      ctl.setPartSelection(null);
      if (merges) showToast(`Merged “${partName}” into “${v}”`, { variant: 'neutral', source: 'parts' });
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); popover?.close(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        // A picked suggestion, an exact match, or the typed text itself.
        const picked = (navigated || (active >= 0 && !items[active].typed)) ? items[active]?.name : undefined;
        void apply(picked ?? input.value);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!items.length) return;
        active = active < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1)
          : (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        navigated = true;
        paintActive();
      } else if (e.key === 'Tab') {
        // Complete with the highlighted suggestion, else the first one.
        const it = navigated && items[active] ? items[active] : items.find((x) => !x.typed);
        if (!it) return;
        e.preventDefault();
        input.value = it.name;
        render();
      }
    });
    render();
    const canvas = getCanvas().getBoundingClientRect();
    mountPopover(box, at ? { x: at.x + 12, y: at.y + 12 } : { x: canvas.left + canvas.width / 2 - 120, y: canvas.top + canvas.height / 3 });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  /** A row's ⋯ menu (phone rows fold their buttons into it). */
  function openRowMenu(anchor: HTMLElement, items: { label: string; run: () => void }[]): void {
    const menu = el('div', 'fixed z-40 min-w-[9rem] rounded-lg border border-zinc-600 bg-zinc-900/95 shadow-xl p-1 flex flex-col');
    menu.setAttribute('role', 'menu');
    for (const it of items) {
      const b = el('button', 'text-left px-3 min-h-11 md:min-h-0 py-1 rounded text-[12px] text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/60', it.label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', () => { popover?.close(); it.run(); });
      menu.appendChild(b);
    }
    // Keyboard model as in the command palette: arrows / Home / End move,
    // Enter activates, Escape closes back to the ⋯ button.
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    let at = 0;
    const focusAt = (i: number) => {
      at = (i + buttons.length) % buttons.length;
      buttons.forEach((b, k) => { b.tabIndex = k === at ? 0 : -1; });
      buttons[at].focus();
    };
    menu.addEventListener('keydown', (e) => {
      const move: Record<string, () => number> = {
        ArrowDown: () => at + 1, ArrowUp: () => at - 1, Home: () => 0, End: () => buttons.length - 1,
      };
      if (e.key in move) { e.preventDefault(); e.stopPropagation(); focusAt(move[e.key]()); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); buttons[at].click(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); popover?.close(); anchor.focus(); }
    });
    const r = anchor.getBoundingClientRect();
    mountPopover(menu, { x: r.right - 150, y: r.bottom + 4 });
    focusAt(0);
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
    const key = JSON.stringify([seeds, [...emphasize], labels.map(colorOf), showAutoPins]);
    if (key === pinsKey) return;
    pinsKey = key;
    markers.update(seeds, colorOf, emphasize, { showAuto: showAutoPins });
  }

  /** Pin edits: with a draft they are draft ops (only nearby parts re-grow);
   *  before the first detection they edit the pending pin list. */
  async function addPin(label: string, point: [number, number, number], chip: LabelChip | null = null): Promise<void> {
    // A chip armed while a seedless method is still selected (the panel
    // opened ready to label a fused figure) switches method on its first
    // pin, not before, so the proposal survives until the user commits.
    const seed = chip ? { label, point, color: chip.color } : { label, point };
    if (chip && detectorOf(algoSelect.value).seeds === 'none' && info.detectors.some((x) => x.id === 'crease-watershed')) {
      algoSelect.value = 'crease-watershed';
      // Clearing the proposal and placing this pin are one undo step.
      if (await onMethodChanged(true, seed)) { checkPin(label); return; }
    }
    if (isDraft(ctl.getPartDraft())) {
      if (!await edit([{ op: 'addSeed', seed }])) return;
    } else {
      ctl.setSeeds([...ctl.getSeeds(), seed]);
      renderDraft();
      // A plain pin waits for Detect; a chip pin grows its part right away
      // (with the pins placed so far), like a pin on an existing draft.
      if (!chip) return;
      chipDetecting = true;
      const r = await ctl.detectParts(detectOptions()).finally(() => { chipDetecting = false; });
      if ('error' in r) { showToast(String(r.error), { variant: 'warn', source: 'parts' }); return; }
    }
    checkPin(label);
  }

  /** After a pin lands: warn when its part came out empty or a speck (the
   *  row also shows ⚠, and a chip shows "missed — click again"). */
  function checkPin(name: string): void {
    const d = ctl.getPartDraft();
    const state = chipState(name, isDraft(d) ? d.parts : [], true, getConfig().segmentation.chipMissAreaFrac);
    if (state === 'missed') {
      chipMissed.add(name);
      showToast(`The “${name}” pin missed: its part came out empty. Click again, nearer the middle of the ${name}.`, { variant: 'warn', source: 'parts' });
    } else chipMissed.delete(name);
    renderChips();
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
  /** Shift-drag paint-select: starts a FRESH selection once the pointer
   *  moves (a Shift-click without moving still toggles one part). */
  let paintSelect: { set: Set<string>; x: number; y: number; first: string | null; started: boolean } | null = null;
  let brushing: { target: string; stroke: string; pending: [number, number, number][]; timer: ReturnType<typeof setTimeout> | null } | null = null;
  let strokeSeq = 0;
  /** Select-tool brush (#1050): a plain drag that starts on a part brushes
   *  more of the model into it (Alt: every touched part, whole). Previewed
   *  as a ghost; lands as one `brush` edit on release. Mouse/pen only — a
   *  one-finger drag still orbits on touch (the Fix tool brushes there). */
  let selBrush: {
    target: string; color: string; mode: BrushMode; radius: number;
    points: [number, number, number][]; faces: number[]; x: number; y: number; alt: boolean; moved: boolean; raf: number;
  } | null = null;

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
    const draftNow = ctl.getPartDraft();
    if (tool === 'select' && evt.shiftKey && isDraft(draftNow)) {
      // Shift-drag paints a selection across parts (owns the drag), adding
      // to the current selection.
      paintSelect = { set: new Set(ctl.getPartSelection().parts.map((p) => p.name)), x: evt.clientX, y: evt.clientY, first: partUnder(evt), started: false };
      return true;
    }
    if (tool === 'select' && !evt.ctrlKey && !evt.metaKey && evt.pointerType !== 'touch' && isDraft(draftNow)) {
      // "Grab your part and paint more of it": a drag that starts on a
      // SELECTED part brushes into it. Anywhere else a drag still orbits.
      const hit = pickFace(evt);
      const part = hit ? ctl.partAtFace(hit.triangleIndex) : null;
      if (hit && part && ctl.getPartSelection().parts.some((s) => s.name === part.name)) {
        selBrush = {
          target: part.name,
          color: draftNow.parts.find((x) => x.name === part.name)?.displayColor ?? '#ffffff',
          mode: evt.altKey ? 'patches' : 'triangles',
          radius: brushRadius() * Number(brushRange.value),
          points: [hit.point], faces: [hit.triangleIndex], x: evt.clientX, y: evt.clientY, alt: evt.altKey, moved: false, raf: 0,
        };
        return true;
      }
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
      const ps = paintSelect;
      if (!ps.started) {
        if (Math.hypot(evt.clientX - ps.x, evt.clientY - ps.y) <= CLICK_SLOP_PX) return;
        ps.started = true;
        if (ps.first) ps.set.add(ps.first);
        ctl.setPartSelection([...ps.set]);
      }
      const nm = partUnder(evt);
      if (nm && !ps.set.has(nm)) { ps.set.add(nm); ctl.setPartSelection([...ps.set]); }
      return;
    }
    if (selBrush) { brushMove(evt); return; }
    if (brushing) brushAt(evt);
  }

  function brushMove(evt: PointerEvent): void {
    const b = selBrush!;
    if (!b.moved) {
      if (Math.hypot(evt.clientX - b.x, evt.clientY - b.y) <= CLICK_SLOP_PX) return;
      b.moved = true;
      // The brush starts from an empty selection (and clears it after); the
      // hover highlight would wash out the preview.
      ctl.setPartSelection(null);
      ctl.setHoveredPart(null);
      cursorTag.classList.add('hidden');
    }
    const hit = pickFace(evt);
    if (hit) {
      const last = b.points[b.points.length - 1];
      // Dabs closer than a third of the radius add nothing but cost.
      if (Math.hypot(hit.point[0] - last[0], hit.point[1] - last[1], hit.point[2] - last[2]) >= b.radius / 3) b.points.push(hit.point);
      if (hit.triangleIndex !== b.faces[b.faces.length - 1]) b.faces.push(hit.triangleIndex);
    }
    if (!b.raf) {
      b.raf = requestAnimationFrame(() => {
        if (selBrush !== b) return;
        b.raf = 0;
        ctl.setBrushGhost({ points: b.points.slice(), faces: b.faces.slice(), radius: b.radius, mode: b.mode, color: b.color });
      });
    }
  }

  async function finishBrush(b: NonNullable<typeof selBrush>): Promise<void> {
    ctl.setBrushGhost({ points: b.points.slice(), faces: b.faces.slice(), radius: b.radius, mode: b.mode, color: b.color });
    const ok = await edit([{ op: 'brush', to: b.target, points: b.points, radius: b.radius, mode: b.mode }]);
    ctl.setBrushGhost(null);
    if (ok) ctl.setPartSelection(null);
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
    if (paintSelect) {
      const ps = paintSelect;
      paintSelect = null;
      if (ps.started) return;
      // No drag: a Shift-click, which toggles the part under it.
      press = { x: ps.x, y: ps.y, shift: true, alt: evt.altKey, additive: true };
    }
    if (selBrush) {
      const b = selBrush;
      selBrush = null;
      if (b.raf) cancelAnimationFrame(b.raf);
      if (b.moved) { void finishBrush(b); return; }
      // No drag: a plain click, which selects.
      press = { x: b.x, y: b.y, shift: false, alt: b.alt, additive: false };
    }
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
      if (!label) { showToast('Pick a label chip (or type a part name) for the pin first', { variant: 'warn', source: 'parts' }); targetInput.focus(); return; }
      void addPin(label, hit.point, armed && armed.name === label ? armed : null);
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
    lastPointer = { x: evt.clientX, y: evt.clientY };
    if (evt.buttons !== 0 || pinDrag || paintSelect || brushing || selBrush) return;
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
    if (isTyping(evt.target) || evt.metaKey || evt.ctrlKey || popover) return;
    const modal = !!document.querySelector('[role="dialog"][aria-modal="true"]');
    const k = evt.key.toLowerCase();
    const sel = ctl.getPartSelection().parts;
    // Type-to-name: with ONE part selected (Select tool), a letter that is
    // not a panel shortcut starts its name in the rename popover. Shortcut
    // letters keep their meaning; names starting with one go through R,
    // which always opens the popover empty.
    if (tool === 'select' && sel.length === 1 && !modal && !evt.altKey && !evt.repeat && /^[a-z]$/i.test(evt.key) && !PANEL_SHORTCUT_KEYS.has(k)) {
      evt.preventDefault();
      openRenamePopover(sel[0].name, evt.key, lastPointer ?? rowAnchor(sel[0].name));
      return;
    }
    if (k === 'h' && !evt.repeat && !evt.altKey) { holdHide = true; applyMarkerVisibility(); return; }
    if (evt.repeat || evt.altKey) return;
    // 1–9 (and 0 for the tenth) pick label chips while the panel is open,
    // like V/P/B (never from a text field — isTyping above — or under a
    // modal dialog).
    if (/^[0-9]$/.test(evt.key) && !evt.shiftKey) {
      if (modal) return;
      const chip = chipList()[(Number(evt.key) + 9) % 10];
      if (chip) { evt.preventDefault(); void pickChip(chip); }
      return;
    }
    if (modal) return;
    if (k === 'v') setTool('select');
    else if (k === 'p') setTool('pin');
    else if (k === 'b') setTool('fix');
    else if (k === 's') toggleSolo();
    else if (k === 'm') { evt.preventDefault(); void mergeSelection(); }
    else if (k === 'r') {
      const target = ctl.getHoveredPart() ?? (sel.length === 1 ? sel[0].name : null);
      if (!target) { showToast('Hover a part on the model (or select one) to rename it', { variant: 'neutral', source: 'parts' }); return; }
      evt.preventDefault();
      openRenamePopover(target, '', lastPointer ?? rowAnchor(target));
    } else if (evt.key === 'Enter') {
      // Enter accepts — only when nothing else claimed it: another dialog
      // confirming on Enter (it handles the key first and closes itself), or
      // a focused control (Enter activates it).
      if (evt.defaultPrevented) return;
      if (evt.target !== document.body && evt.target !== getCanvas()) return;
      if (acceptBtn.classList.contains('hidden') || acceptBtn.disabled) return;
      evt.preventDefault();
      acceptBtn.click();
    } else if ((evt.key === 'Delete' || evt.key === 'Backspace') && ctl.getPartSelection().parts.length) {
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
    // An open popover or ⋯ menu handles Escape itself (closes first).
    if (popover) return;
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

  /** A cancelled gesture (pen lifted out of range, touch taken over by the
   *  browser) applies nothing: drop every stroke in progress. */
  function onWindowCancel(): void {
    if (selBrush?.raf) cancelAnimationFrame(selBrush.raf);
    selBrush = null;
    paintSelect = null;
    if (brushing?.timer) clearTimeout(brushing.timer);
    brushing = null;
    // A pin dragged mid-cancel snaps back to where it is stored.
    if (pinDrag) { pinsKey = ''; renderPins(); }
    pinDrag = null;
    press = null;
    ctl.setBrushGhost(null);
  }

  window.addEventListener('pointermove', onWindowMove);
  window.addEventListener('pointerup', onWindowUp);
  window.addEventListener('pointercancel', onWindowCancel);
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
    const saved = (r as { parts: { name: string; color: string | null }[] }).parts;
    showToast(`Saved ${saved.length} parts as labels`, { variant: 'success', source: 'parts' });
    if ('note' in r && typeof r.note === 'string') showToast(r.note, { variant: 'neutral', source: 'parts' });
    // Next steps replace Accept: paint one part, or edit the parts again.
    armed = null;
    chipMissed.clear();
    if (tool !== 'select') setTool('select');
    justSaved = { names: saved.map((p) => p.name), colored: saved.some((p) => p.color) };
    renderDraft();
  });
  // After Accept: "Edit parts" (re-open them) and "Open Paint" (scoped to the
  // part picked in the saved card).
  const editSavedBtn = el('button', `${BUTTON_CANCEL} hidden`, 'Edit parts');
  editSavedBtn.title = 'Re-open the saved parts (with their pins) to refine them';
  editSavedBtn.addEventListener('click', async () => {
    const saved = ctl.importsWithParts();
    if (!saved.length) return;
    const r = await ctl.reopenParts({ importIndex: saved[0] });
    if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
  });
  const openPaintBtn = el('button', `${BUTTON_PRIMARY} hidden`, 'Open Paint');
  openPaintBtn.title = 'Open the Paint panel scoped to the chosen part, so colour can’t bleed across its edge';
  let paintScopeSelect: HTMLSelectElement | null = null;
  openPaintBtn.addEventListener('click', () => {
    const scope = paintScopeSelect?.value || null;
    shell.close();
    openPaintWithin(scope);
  });
  footer.append(discardBtn, acceptBtn, editSavedBtn, openPaintBtn);

  function syncFooter(): void {
    const saved = justSaved !== null;
    discardBtn.classList.toggle('hidden', saved);
    acceptBtn.classList.toggle('hidden', saved);
    editSavedBtn.classList.toggle('hidden', !saved);
    openPaintBtn.classList.toggle('hidden', !saved);
  }

  function savedCard(s: { names: string[]; colored: boolean }): HTMLElement {
    const card = el('div', 'flex flex-col gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2');
    card.dataset.partsSaved = '';
    card.appendChild(el('div', 'text-[12px] text-emerald-100 font-semibold', '✓ Parts saved'));
    card.appendChild(el('div', 'text-[12px] text-zinc-200 leading-snug',
      `${s.names.length} part${s.names.length === 1 ? ' is' : 's are'} now labels on the import${s.colored ? ', in the colours shown' : ''}. Next: open Paint scoped to one part (colour can’t bleed across its edge), or edit the parts.`));
    const row = el('label', 'flex items-center gap-1.5 text-[12px] text-zinc-300');
    const sel = el('select', `${INPUT} flex-1 min-w-0 min-h-11 md:min-h-0`);
    sel.setAttribute('aria-label', 'Part to paint within');
    const whole = el('option', '', 'Whole model');
    whole.value = '';
    sel.appendChild(whole);
    for (const nm of s.names) { const o = el('option', '', nm); o.value = nm; sel.appendChild(o); }
    sel.value = s.names[0] ?? '';
    paintScopeSelect = sel;
    row.append(el('span', 'shrink-0', 'Paint within'), sel);
    card.appendChild(row);
    return card;
  }

  // ======================================================== label chips
  function chipList(): LabelChip[] {
    const base = labelPreset(chipSetId).chips;
    return [...base, ...customChips.filter((c) => !base.some((b) => b.name === c.name))];
  }

  function renderChips(): void {
    const d = ctl.getPartDraft();
    const parts = isDraft(d) ? d.parts : [];
    if (!isDraft(d) || parts.length === 0) chipMissed.clear();
    const minFrac = getConfig().segmentation.chipMissAreaFrac;
    chipStrip.replaceChildren();
    chipList().forEach((chip, i) => {
      const state = chipState(chip.name, parts, chipMissed.has(chip.name), minFrac);
      if (state === 'owned') chipMissed.delete(chip.name);
      const part = parts.find((p) => p.name === chip.name);
      const on = armed?.name === chip.name;
      const b = el('button', `${CHIP} ${on ? CHIP_ARMED : state === 'missed' ? CHIP_MISSED : CHIP_IDLE}`);
      b.type = 'button';
      b.dataset.chip = chip.name;
      b.dataset.chipState = state;
      b.setAttribute('aria-pressed', String(on));
      b.title = state === 'missed'
        ? `The last “${chip.name}” pin grew no part — click the model again`
        : `${on ? 'Armed' : 'Pick'} “${chip.name}”: then click it on the model${i < 10 ? ` (key ${(i + 1) % 10})` : ''}`;
      const dot = el('span', 'w-3 h-3 rounded-full border border-zinc-400/70 shrink-0');
      dot.style.backgroundColor = state === 'owned' && part ? part.displayColor : chip.color;
      b.appendChild(dot);
      b.appendChild(el('span', '', chip.name));
      if (state === 'owned') b.appendChild(el('span', 'text-emerald-300', '✓'));
      if (state === 'missed') b.appendChild(el('span', 'text-[11px] text-amber-300', 'missed — click again'));
      if (i < 10) b.appendChild(el('span', 'hidden md:inline text-[10px] text-zinc-500', String((i + 1) % 10)));
      b.addEventListener('click', () => { void pickChip(chip); });
      chipStrip.appendChild(b);
    });
    const add = el('button', `${CHIP} ${CHIP_IDLE} border-dashed text-zinc-400`, '+ custom');
    add.type = 'button';
    add.title = 'Add a label with your own name and colour';
    add.addEventListener('click', () => {
      customRow.classList.toggle('hidden');
      if (!customRow.classList.contains('hidden')) customName.focus();
    });
    chipStrip.appendChild(add);
  }

  /** Arm the Pin tool with a chip. Chips grow parts from pins, so a seedless
   *  method (auto patches, pieces) switches to Crease watershed first. */
  async function pickChip(chip: LabelChip): Promise<void> {
    if (armed?.name === chip.name && tool === 'pin') {
      // Picking the armed chip again disarms it.
      armed = null;
      setTool('select');
      renderChips();
      return;
    }
    if (justSaved) { showToast('These parts are saved: choose Edit parts to change them', { variant: 'neutral', source: 'parts' }); return; }
    // Picking a chip means labelling by hand: a detection still running with
    // no draft yet (the import-time proposal, a Detect click) would land a
    // seedless draft over the chips, so stop it. A chip's own first
    // detection keeps running, and a run over an existing draft is left
    // alone (cancelling drops the draft).
    if (ctl.isBusy()?.cancellable && !chipDetecting && !isDraft(ctl.getPartDraft())) ctl.cancel();
    if (detectorOf(algoSelect.value).seeds === 'none' && info.detectors.some((x) => x.id === 'crease-watershed')) {
      algoSelect.value = 'crease-watershed';
      await onMethodChanged(true);
    }
    armed = chip;
    targetInput.value = chip.name;
    setTool('pin');
    renderChips();
  }

  /** The method changed (dropdown or a chip). A seedless draft (generic
   *  patches with automatic pins) is cleared — undoably — before a seeded
   *  method takes over: new pins would otherwise only re-grow locally inside
   *  the old patches and leave them mixed in. Locks or a focus mean the
   *  user is deliberately re-detecting part of the model, so those keep it. */
  /** `withSeed`: a chip's first pin on a seedless draft — the clear and
   *  the pin land as ONE batch, so a single Undo restores the old parts.
   *  Returns whether that pin was applied here. */
  async function onMethodChanged(viaChip = false, withSeed: Record<string, unknown> | null = null): Promise<boolean> {
    void ctl.showPresetPreview(null);
    carriedEdgeLengths = null;
    buildParams();
    const next = detectorOf(algoSelect.value);
    const d = ctl.getPartDraft();
    const from = isDraft(d) ? info.detectors.find((x) => x.id === d.detector) : undefined;
    let cleared = false;
    // Seeded → seeded keeps the draft: its pins are the next method's input.
    const keepsPins = next.seeds !== 'none' && from?.seeds !== 'none';
    if (isDraft(d) && d.parts.length > 0 && d.detector !== next.id && !keepsPins
      && !d.focus && !d.parts.some((p) => 'locked' in p && p.locked)) {
      const ops: Record<string, unknown>[] = [{ op: 'clear', algorithm: next.id }];
      if (withSeed) ops.push({ op: 'addSeed', seed: withSeed });
      cleared = await edit(ops);
      if (cleared) showUndoBanner(`Started fresh for ${next.name}: cleared the ${from?.name ?? d.detector} parts${withSeed ? ' and placed your pin' : ''}.`);
    }
    if (viaChip) {
      showToast(cleared
        ? `Label chips grow parts from pins: switched to ${next.name} and started fresh (Undo brings the old parts back).`
        : `Label chips grow parts from pins: switched the method to ${next.name}.`, { variant: 'neutral', source: 'parts' });
    }
    renderDraft();
    scheduleLive();
    return cleared && !!withSeed;
  }


  function syncBusy(): void {
    const b = ctl.isBusy();
    detectBtn.disabled = !!b;
    presetBtn.disabled = !!b && !stripOpen;
    cancelBtn.classList.toggle('hidden', !b?.cancellable);
    status.textContent = b ? `${b.message} ${Math.round(b.fraction * 100)}%` : '';
    syncStart();
  }
  const unsubscribe = ctl.subscribe((ev) => {
    if (ev === 'draft') {
      // The import banner describes the proposal it opened with; once another
      // detector's draft replaces it, or it is accepted or discarded, the
      // banner no longer applies.
      const d = ctl.getPartDraft();
      if (contextBanner && (!isDraft(d) || d.detector !== proposedBy)) { contextBanner.remove(); contextBanner = null; }
      cachedDiag = 0;
      // The hover tag names a part of the old draft until the pointer moves.
      cursorTag.classList.add('hidden');
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

  algoSelect.addEventListener('change', () => { void onMethodChanged(); });
  buildParams();
  setTool(isDraft(ctl.getPartDraft()) ? 'select' : detectorOf(algoSelect.value).seeds === 'required' ? 'pin' : 'select');
  // A Separate-pieces proposal of 1–2 pieces on a fused figure: open ready
  // to label it — the first chip is armed, so the first click on the model
  // names a part (the method switches on that click; see addPin).
  if (isDraft(opened) && isFusedPiecesDraft(opened.detector, opened.parts, getConfig().segmentation.fusedPieceMinTris)) {
    armed = chipList()[0];
    targetInput.value = armed.name;
    setTool('pin');
    contextBanner?.insertBefore(
      el('div', 'text-[12px] text-blue-200 leading-snug', `“${armed.name}” is ready: click the ${armed.name} on the model, then pick the next label (keys 1–9).`),
      contextBanner.children[1] ?? null,
    );
  }
  renderDraft();
  renderPins();
  applyMarkerVisibility();
  fitToWindow();
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

