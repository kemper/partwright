// Print preview panel (Inspect → Print preview): see the model as the colour
// bands that will print, scrub through its layers like a slicer's layer
// slider, optionally with an estimated blend, and edit the colour changes.
//
// The colours themselves live in the model's code as
// `api.print.layerColors([...])`. Edits here preview live from a draft and
// are written to the code only on Apply (one run and one saved version, not
// one per tweak). Everything goes through the same handlers the
// `window.partwright` methods use, so the panel can't do anything an agent
// can't.

import { createToolPanelShell, TOOL_TOGGLE_ACTIVE, TOOL_TOGGLE_IDLE, type ToolPanelShell } from './toolPanel';
import { registerTool } from './toolRegistry';
import { registerCommands } from './commandPalette';
import { viewportInspectMount } from './popoverMenu';
import { createSliderEntry, type SliderEntry } from './sliderEntry';
import { BUTTON_SMALL_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { DEFAULT_LAYER_BASE_COLOR } from '../print/layerColors';

export interface PrintPreviewChange { z: number; color: string }

export interface PrintPreviewLayerInfo {
  declared: boolean;
  changes: PrintPreviewChange[];
  layerHeight: number;
  firstLayerHeight: number;
  modelHeight: number;
  totalLayers: number;
  warnings?: string[];
}

export interface PrintPreviewView {
  enabled: boolean;
  showing: boolean;
  layer: number;
  totalLayers: number;
  z: number | null;
  blend: boolean;
  notes?: string[];
}

export interface PrintPreviewHandlers {
  hasModel(): boolean;
  /** False when the session's language can't declare layer colours (not manifold-js). */
  canEdit(): { ok: true } | { ok: false; reason: string };
  getLayerColors(): PrintPreviewLayerInfo;
  getView(): PrintPreviewView;
  setView(opts: { enabled?: boolean; layer?: number | null; blend?: boolean }): PrintPreviewView | { error: string };
  /** Preview these changes without touching the code; null goes back to the code's own. */
  setDraft(changes: PrintPreviewChange[] | null): void;
  /** False once the draft was dropped because another object or session came on screen. */
  hasDraft(): boolean;
  apply(changes: PrintPreviewChange[]): Promise<{ ok: true } | { error: string }>;
  clear(): Promise<{ ok: true } | { error: string }>;
  /** Register a callback for "the model re-ran or the preview changed". */
  onChange(cb: (() => void) | null): void;
}

const TOUCH = 'min-h-[44px] md:min-h-0';
/** Filament-ish defaults offered for a newly added change, in turn. */
const NEW_CHANGE_COLORS = ['#dc1e1e', '#1e50dc', '#f5c518', '#1faa4b', '#111111', '#ffffff'];

let handlers: PrintPreviewHandlers | null = null;
let shell: ToolPanelShell | null = null;
let toggleBtn: HTMLButtonElement | null = null;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
};

export function isPrintPreviewOpen(): boolean {
  return shell !== null;
}

function closePanel(): void {
  shell?.close();
}

/** Open the panel (a no-op when it is open, or before the UI exists). The
 *  preview and the panel always go together: `setPrintPreview({ enabled })`
 *  calls these, so a preview turned on by a script is visible and closable. */
export function openPrintPreviewPanel(): void {
  openPanel();
}

export function closePrintPreviewPanel(): void {
  closePanel();
}

function openPanel(): void {
  if (!handlers || shell) return;
  const h: PrintPreviewHandlers = handlers;
  if (!h.hasModel()) { showToast('Run a model first, then open the print preview.', { variant: 'neutral' }); return; }

  /** The changes being edited (always sorted by height; the first is the base at 0 mm). */
  let draft: PrintPreviewChange[] = [];
  let dirty = false;
  let busy = false;
  let slider: SliderEntry | null = null;
  let pendingLayer: number | null = null;
  let raf = 0;

  const panelShell = createToolPanelShell({
    title: 'Print preview',
    width: 'w-[22rem]',
    onClose: () => {
      // Cleared first: turning the preview off below asks for the panel to be closed.
      shell = null;
      if (raf) cancelAnimationFrame(raf);
      h.onChange(null);
      h.setDraft(null);
      h.setView({ enabled: false, layer: null });
      syncToggle();
    },
  });
  shell = panelShell;
  panelShell.panel.id = 'print-preview-panel';
  const { body, footer } = panelShell;

  const summary = el('div', 'text-[12px] text-zinc-400');
  summary.dataset.printPreviewSummary = '';
  const notes = el('div', 'hidden rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-100 leading-snug');
  notes.dataset.printPreviewNotes = '';

  // ── Layer slider ──
  const layerRow = el('div', 'flex flex-col gap-1');
  const layerLabel = el('div', 'flex items-baseline justify-between text-[12px]');
  const layerTitle = el('span', 'text-zinc-300', 'Layer');
  const layerReadout = el('span', 'tabular-nums text-zinc-400');
  layerReadout.dataset.printPreviewReadout = '';
  layerLabel.append(layerTitle, layerReadout);
  const sliderWrap = el('div', 'flex items-center gap-2');
  layerRow.append(layerLabel, sliderWrap);

  // ── Blending ──
  const blendLabel = el('label', `flex items-start gap-2 text-[12px] text-zinc-300 cursor-pointer ${TOUCH}`);
  const blendBox = el('input', 'mt-0.5 accent-blue-500');
  blendBox.type = 'checkbox';
  blendBox.id = 'print-preview-blend';
  const blendText = el('span', '');
  blendText.append(el('span', 'block', 'Estimated blending'), el('span', 'block text-[11px] text-zinc-500', 'A rough guide to how thin top layers mix with the colour underneath. Real results vary by filament.'));
  blendLabel.append(blendBox, blendText);
  blendBox.addEventListener('change', () => { h.setView({ blend: blendBox.checked }); });

  // ── Colour changes ──
  const listTitle = el('div', 'flex items-baseline justify-between');
  listTitle.append(el('span', 'text-[12px] text-zinc-300', 'Colours by height'), el('span', 'text-[11px] text-zinc-500', 'from this height up'));
  const list = el('div', 'flex flex-col gap-1.5');
  list.dataset.printPreviewList = '';
  const addBtn = el('button', `${BUTTON_SMALL_SECONDARY} ${TOUCH} self-start`, '+ Add change at this layer');
  addBtn.type = 'button';
  addBtn.dataset.printPreviewAdd = '';
  const editNote = el('div', 'hidden text-[11px] text-zinc-500');

  body.append(summary, notes, layerRow, blendLabel, listTitle, list, addBtn, editNote);

  const clearBtn = el('button', `${BUTTON_SMALL_SECONDARY} ${TOUCH}`, 'Remove colours');
  clearBtn.type = 'button';
  clearBtn.title = 'Delete the layer colours from this object\'s code';
  const revertBtn = el('button', `${BUTTON_SMALL_SECONDARY} ${TOUCH}`, 'Revert');
  revertBtn.type = 'button';
  revertBtn.title = 'Discard unsaved edits and go back to the colours in the code';
  const applyBtn = el('button', `${BUTTON_SMALL_PRIMARY} ${TOUCH}`, 'Apply to code');
  applyBtn.type = 'button';
  applyBtn.dataset.printPreviewApply = '';
  applyBtn.title = 'Write these colours into the model code as api.print.layerColors and save a version';
  footer.append(clearBtn, revertBtn, applyBtn);

  const fmtMm = (n: number) => `${Number(n.toFixed(2))} mm`;

  function loadDraftFromCode(): void {
    const info = h.getLayerColors();
    const base = info.changes.find((c) => c.z <= info.firstLayerHeight / 2);
    const later = info.changes.filter((c) => c.z > info.firstLayerHeight / 2);
    draft = [{ z: 0, color: base?.color ?? DEFAULT_LAYER_BASE_COLOR }, ...later.map((c) => ({ z: c.z, color: c.color }))];
    dirty = false;
  }

  function pushDraft(): void {
    draft.sort((a, b) => a.z - b.z);
    dirty = true;
    h.setDraft(draft.map((c) => ({ ...c })));
    render();
  }

  function renderList(info: PrintPreviewLayerInfo, editable: boolean): void {
    list.replaceChildren();
    draft.forEach((change, i) => {
      const row = el('div', 'flex items-center gap-2');
      row.dataset.printPreviewRow = String(i);
      const color = el('input', `h-7 w-9 shrink-0 cursor-pointer rounded border border-zinc-700 bg-zinc-800 p-0.5 ${TOUCH}`);
      color.type = 'color';
      color.value = change.color;
      color.disabled = !editable;
      color.setAttribute('aria-label', i === 0 ? 'Colour of the first layers' : `Colour from ${fmtMm(change.z)}`);
      color.addEventListener('change', () => { change.color = color.value; pushDraft(); });
      row.append(color);
      if (i === 0) {
        row.append(el('span', 'flex-1 text-[12px] text-zinc-400', 'from the bed'));
      } else {
        const z = el('input', `w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[12px] text-right tabular-nums text-zinc-200 ${TOUCH}`);
        z.type = 'number';
        z.min = '0';
        z.max = String(info.modelHeight);
        z.step = String(info.layerHeight);
        z.value = String(Number(change.z.toFixed(3)));
        z.disabled = !editable;
        z.setAttribute('aria-label', 'Height in mm above the bed');
        z.addEventListener('change', () => {
          const v = z.valueAsNumber;
          if (!Number.isFinite(v) || v < 0) { z.value = String(change.z); return; }
          change.z = Math.min(v, info.modelHeight);
          pushDraft();
        });
        const remove = el('button', `${BUTTON_SMALL_SECONDARY} ${TOUCH} shrink-0`, 'Remove');
        remove.type = 'button';
        remove.disabled = !editable;
        remove.setAttribute('aria-label', `Remove the change at ${fmtMm(change.z)}`);
        remove.addEventListener('click', () => { draft.splice(i, 1); pushDraft(); });
        row.append(el('span', 'text-[12px] text-zinc-400', 'from'), z, el('span', 'flex-1 text-[12px] text-zinc-400', 'mm'), remove);
      }
      list.append(row);
    });
  }

  function render(): void {
    const info = h.getLayerColors();
    const view = h.getView();
    const edit = h.canEdit();
    const editable = edit.ok && !busy;

    summary.textContent = info.totalLayers > 0
      ? `${info.totalLayers} layers of ${fmtMm(info.layerHeight)}${info.firstLayerHeight !== info.layerHeight ? ` (first ${fmtMm(info.firstLayerHeight)})` : ''}, ${fmtMm(info.modelHeight)} tall`
      : 'No model on screen.';

    const messages = [...(info.warnings ?? []), ...(view.notes ?? []).filter(() => draft.length <= 1 && !dirty)];
    notes.textContent = messages.join(' ');
    notes.classList.toggle('hidden', messages.length === 0);

    // Layer slider: rebuilt only when the layer count changes.
    const total = Math.max(1, info.totalLayers);
    if (!slider || Number(slider.range.max) !== total) {
      sliderWrap.replaceChildren();
      slider = createSliderEntry({
        label: 'Layers printed',
        min: 1, max: total, step: 1, value: Math.min(view.layer || total, total),
        format: (v: number) => String(Math.round(v)),
        onChange: (v: number) => {
          // One rebuild per frame at most: a big model can't re-cut per pixel of drag.
          pendingLayer = Math.round(v);
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            const layer = pendingLayer!;
            h.setView({ layer: layer >= total ? null : layer });
            renderReadout();
          });
        },
      });
      slider.range.classList.add('flex-1', ...TOUCH.split(' '));
      slider.range.id = 'print-preview-layer';
      slider.input.classList.add(...TOUCH.split(' '));
      sliderWrap.append(slider.range, slider.input);
    } else if (!raf) {
      slider.set(Math.min(view.layer || total, total));
    }
    blendBox.checked = view.blend;
    renderReadout();

    renderList(info, editable);
    addBtn.disabled = !editable;
    editNote.textContent = edit.ok ? '' : edit.reason;
    editNote.classList.toggle('hidden', edit.ok);
    applyBtn.disabled = !editable || !dirty;
    revertBtn.disabled = busy || !dirty;
    clearBtn.disabled = !editable || !info.declared;
    applyBtn.textContent = busy ? 'Applying…' : 'Apply to code';
  }

  function renderReadout(): void {
    const info = h.getLayerColors();
    const view = h.getView();
    const top = view.z ?? info.modelHeight;
    layerReadout.textContent = info.totalLayers > 0 ? `${view.layer} of ${info.totalLayers}, ${fmtMm(top)}` : '';
  }

  addBtn.addEventListener('click', () => {
    const info = h.getLayerColors();
    const view = h.getView();
    // At the slider's cut when the model is cut, else halfway up.
    let z = view.z ?? info.modelHeight / 2;
    // Keep clear of an existing change at the same height.
    while (draft.some((c) => Math.abs(c.z - z) < info.layerHeight / 2) && z + info.layerHeight < info.modelHeight) z += info.layerHeight;
    draft.push({ z: Number(z.toFixed(3)), color: NEW_CHANGE_COLORS[(draft.length - 1) % NEW_CHANGE_COLORS.length] });
    pushDraft();
  });

  revertBtn.addEventListener('click', () => {
    h.setDraft(null);
    loadDraftFromCode();
    render();
  });

  const run = async (work: () => Promise<{ ok: true } | { error: string }>, done: string) => {
    busy = true;
    render();
    const r = await work();
    busy = false;
    if ('error' in r) {
      showToast(r.error, { variant: 'warn' });
    } else {
      h.setDraft(null);
      loadDraftFromCode();
      showToast(done, { variant: 'success' });
    }
    if (shell === panelShell) render();
  };
  applyBtn.addEventListener('click', () => { void run(() => h.apply(draft.map((c) => ({ ...c }))), 'Layer colours saved to the model code.'); });
  clearBtn.addEventListener('click', () => { void run(() => h.clear(), 'Layer colours removed from the model code.'); });

  loadDraftFromCode();
  h.setView({ enabled: true });
  // The model re-ran (or an agent changed the preview): pick up the code's colours unless the user is mid-edit.
  h.onChange(() => {
    if (shell !== panelShell || busy) return;
    // Another object or session came on screen: the unsaved edits were for the one that left.
    if (dirty && !h.hasDraft()) dirty = false;
    if (!dirty) loadDraftFromCode();
    render();
  });
  render();
  syncToggle();
}

function syncToggle(): void {
  if (!toggleBtn) return;
  toggleBtn.className = isPrintPreviewOpen() ? TOOL_TOGGLE_ACTIVE : TOOL_TOGGLE_IDLE;
  toggleBtn.setAttribute('aria-pressed', String(isPrintPreviewOpen()));
}

export function initPrintPreviewUI(controlsContainer: HTMLElement, h: PrintPreviewHandlers): void {
  handlers = h;

  toggleBtn = document.createElement('button');
  toggleBtn.id = 'print-preview-toggle';
  toggleBtn.type = 'button';
  toggleBtn.className = TOOL_TOGGLE_IDLE;
  toggleBtn.textContent = '🎚 Print preview';
  toggleBtn.title = 'See the colours each layer prints in, and scrub through the layers';
  toggleBtn.addEventListener('click', () => (isPrintPreviewOpen() ? closePanel() : openPanel()));
  // Read-only analysis until you press Apply: lives in Inspect, next to Print and Cross-section.
  viewportInspectMount(controlsContainer).appendChild(toggleBtn);

  registerTool({
    id: 'tool-print-preview',
    title: 'Print preview (colours by layer)',
    hint: 'Inspect',
    enabled: () => h.hasModel(),
    open: () => { openPanel(); },
    getState: () => (isPrintPreviewOpen() ? { ...h.getView() } : null),
    isOpen: isPrintPreviewOpen,
    close: closePanel,
  });
  registerCommands([
    {
      id: 'tool-print-preview',
      title: 'Print preview (colours by layer)',
      hint: 'Inspect',
      keywords: 'layer slider filament change colour color height band slice sliced preview multicolor multicolour swap',
      run: () => (isPrintPreviewOpen() ? closePanel() : openPanel()),
      enabled: () => h.hasModel(),
    },
  ]);
}
