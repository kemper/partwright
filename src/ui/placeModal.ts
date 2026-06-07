// Place / Rotate panel — a compact, draggable viewport panel that repositions
// and reorients the current model: drop its lowest point to Z=0, center it on
// X/Y, freely rotate it, or auto lay-flat (rotate the largest flat face onto the
// bed). Each action applies immediately and saves a new version (undo is the
// version history), mirroring the Resize panel.
//
// Write-back mode: when the model is parametric manifold-js with no manual
// paint, the user can keep the result as editable code (the source is wrapped
// and the transform chained) or bake it to a mesh. Otherwise only baking is
// offered, since world-space paint regions can't follow a parametric move.

import { registerCommands } from './commandPalette';
import { showToast } from './toast';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { setInitialPanelPosition, attachViewportPanelDrag } from './viewportPanelDrag';
import { TOOL_PANEL_CLASS, TOOL_PANEL_HEADER, TOOL_PANEL_TITLE, TOOL_PANEL_CLOSE } from './toolPanel';

type Mode = 'parametric' | 'bake' | 'auto';
type PlaceOpts = {
  dropToFloor?: boolean;
  centerX?: boolean;
  centerY?: boolean;
  centerZ?: boolean;
  mode?: Mode;
  preserveColor?: boolean;
};
type RotateOpts = { x?: number; y?: number; z?: number; mode?: Mode; preserveColor?: boolean };

type PlaceResult = { error?: string; ok?: boolean; noop?: boolean; message?: string; warnings?: string[] } & Record<string, unknown>;

export interface PlaceApi {
  placeModel(opts: PlaceOpts): Promise<PlaceResult>;
  rotateModel(opts: RotateOpts): Promise<PlaceResult>;
  layFlatModel(opts: { mode?: Mode; preserveColor?: boolean }): Promise<PlaceResult>;
  canPlaceParametric(): boolean;
  modelHasColor(): boolean;
  getGeometryData(): { boundingBox?: { x?: number[]; y?: number[]; z?: number[] } | null } | Record<string, unknown>;
}

let openModal: HTMLDivElement | null = null;
let currentPlaceClose: (() => void) | null = null;

const placeRegistryEntry = { close(): void { currentPlaceClose?.(); } };

function onPlaceEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  currentPlaceClose?.();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Find the viewport container used by the other overlay panels. */
function getViewportContainer(): HTMLElement {
  return (document.getElementById('clip-controls')?.offsetParent as HTMLElement | null) ?? document.body;
}

function bboxSummary(api: PlaceApi): string | null {
  try {
    const gd = api.getGeometryData() as { boundingBox?: { x?: number[]; y?: number[]; z?: number[] } | null };
    const bb = gd?.boundingBox;
    if (bb?.x && bb?.y && bb?.z) {
      const cx = ((bb.x[0] + bb.x[1]) / 2);
      const cy = ((bb.y[0] + bb.y[1]) / 2);
      return `Floor Z = ${bb.z[0].toFixed(2)} · XY center = (${cx.toFixed(2)}, ${cy.toFixed(2)})`;
    }
  } catch { /* fall through */ }
  return null;
}

export function openPlaceModal(api: PlaceApi): void {
  if (openModal) { openModal.remove(); openModal = null; currentPlaceClose = null; }

  const canParametric = api.canPlaceParametric();
  const hasColor = api.modelHasColor();
  let mode: 'parametric' | 'bake' = canParametric ? 'parametric' : 'bake';
  let preserveColor = true;
  // Preserve-colors only applies to the bake path (parametric re-runs the code,
  // which re-resolves colors). Hidden while the parametric radio is selected.
  let colorRow: HTMLElement | null = null;
  const syncColorRow = () => { if (colorRow) colorRow.style.display = mode === 'bake' ? '' : 'none'; };

  const container = getViewportContainer();
  // Shared tool-panel chrome (grey shell, z-20, unified header/close) so this
  // reads as one family with the other viewport tool panels.
  const panel = el('div', `${TOOL_PANEL_CLASS} text-zinc-100 w-[min(94vw,320px)] max-h-[calc(100%-3.5rem)] select-none`);

  // Header — drag handle + title + × button (shared tool-panel chrome).
  const header = el('div', TOOL_PANEL_HEADER);
  header.append(el('h2', TOOL_PANEL_TITLE, 'Place / Rotate'));
  const closeBtn = el('button', TOOL_PANEL_CLOSE, '×');
  closeBtn.setAttribute('aria-label', 'Close placement panel');
  header.append(closeBtn);
  panel.append(header);
  const dragHandle = attachViewportPanelDrag(header, panel);

  const body = el('div', 'px-4 py-3 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0');
  panel.append(body);

  body.append(el('p', 'text-[11px] text-zinc-400 leading-snug',
    'Reposition or reorient the model: drop it to the floor, center it, rotate it, or auto lay-flat.'));

  // ---- Place actions ----
  const ACTION = 'w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-xs flex items-center gap-2';
  const dropBtn = el('button', ACTION);
  dropBtn.innerHTML = '<span aria-hidden="true">⤓</span><span>Drop to floor <span class="text-zinc-500">(Z → 0)</span></span>';
  const centerBtn = el('button', ACTION);
  centerBtn.innerHTML = '<span aria-hidden="true">⊕</span><span>Center on plate <span class="text-zinc-500">(XY → 0)</span></span>';
  const bothBtn = el('button', ACTION);
  bothBtn.innerHTML = '<span aria-hidden="true">⤓⊕</span><span>Drop &amp; center</span>';
  const layFlatBtn = el('button', ACTION);
  layFlatBtn.innerHTML = '<span aria-hidden="true">▭</span><span>Lay flat <span class="text-zinc-500">(auto-orient largest face down)</span></span>';
  body.append(dropBtn, centerBtn, bothBtn, layFlatBtn);

  // ---- Rotate section ----
  const rotWrap = el('div', 'flex flex-col gap-2 pt-1 border-t border-zinc-800');
  rotWrap.append(el('div', 'text-[11px] text-zinc-400 font-medium pt-2', 'Rotate (degrees, about center)'));
  const axisInputs: Record<'x' | 'y' | 'z', HTMLInputElement> = {} as Record<'x' | 'y' | 'z', HTMLInputElement>;
  const axisRow = el('div', 'flex items-center gap-2');
  (['x', 'y', 'z'] as const).forEach(axis => {
    const cell = el('label', 'flex items-center gap-1 text-xs text-zinc-300');
    cell.append(el('span', 'font-mono text-zinc-400 uppercase w-3', axis));
    const inp = el('input', 'w-full bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-right text-zinc-200 font-mono text-xs focus:border-blue-400 focus:outline-none');
    inp.type = 'number';
    inp.step = '15';
    inp.value = '0';
    inp.setAttribute('aria-label', `Rotate ${axis.toUpperCase()} degrees`);
    axisInputs[axis] = inp;
    cell.append(inp);
    axisRow.append(cell);
  });
  rotWrap.append(axisRow);
  const rotBtnRow = el('div', 'flex items-center gap-2');
  const rotateBtn = el('button', 'flex-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium', 'Apply rotation');
  const rotResetBtn = el('button', 'px-2 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs', 'Reset');
  rotResetBtn.addEventListener('click', () => { axisInputs.x.value = '0'; axisInputs.y.value = '0'; axisInputs.z.value = '0'; });
  rotBtnRow.append(rotateBtn, rotResetBtn);
  rotWrap.append(rotBtnRow);
  body.append(rotWrap);

  // ---- Write-back mode ----
  const modeWrap = el('div', 'flex flex-col gap-1.5 pt-1 border-t border-zinc-800');
  modeWrap.append(el('div', 'text-[11px] text-zinc-400 font-medium pt-2', 'Write-back'));
  if (canParametric) {
    const mkRadio = (value: 'parametric' | 'bake', label: string, hint: string): HTMLElement => {
      const row = el('label', 'flex items-start gap-2 text-xs text-zinc-300 cursor-pointer');
      const radio = el('input', 'accent-blue-500 mt-0.5');
      radio.type = 'radio';
      radio.name = 'place-writeback';
      radio.value = value;
      radio.checked = mode === value;
      radio.addEventListener('change', () => { if (radio.checked) { mode = value; syncColorRow(); } });
      const txt = el('span', '');
      txt.append(el('span', 'text-zinc-200', label));
      txt.append(el('span', 'block text-[10px] text-zinc-500', hint));
      row.append(radio, txt);
      return row;
    };
    modeWrap.append(
      mkRadio('parametric', 'Keep editable code', 'Wraps your model code and translates it — stays parametric.'),
      mkRadio('bake', 'Bake to mesh', 'Flattens the moved model to a fixed mesh.'),
    );
  } else {
    modeWrap.append(el('p', 'text-[11px] text-zinc-500 leading-snug',
      hasColor
        ? 'This model has manual paint, so the result is baked to a mesh (keeps the paint).'
        : 'Baked to a mesh (editable-code transforms need a manifold-js or voxel model).'));
  }
  body.append(modeWrap);

  // ---- Preserve colors (bake path only) ----
  if (hasColor) {
    colorRow = el('label', 'flex items-center gap-2 text-xs text-zinc-300 cursor-pointer');
    const colorCheck = el('input', 'accent-blue-500');
    colorCheck.type = 'checkbox';
    colorCheck.checked = preserveColor;
    colorCheck.addEventListener('change', () => { preserveColor = colorCheck.checked; });
    colorRow.append(colorCheck, el('span', '', 'Preserve colors (best-effort)'));
    body.append(colorRow);
    syncColorRow();
  }

  // ---- Status / current placement ----
  const status = el('div', 'text-[11px] text-zinc-400 min-h-[1rem]');
  const summary = bboxSummary(api);
  if (summary) status.textContent = summary;
  body.append(status);

  // Footer
  const footer = el('div', 'flex justify-end gap-2 px-4 pb-4 shrink-0');
  const closeFooterBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs', 'Close');
  footer.append(closeFooterBtn);
  panel.append(footer);

  const buttons = [dropBtn, centerBtn, bothBtn, layFlatBtn, rotateBtn];
  async function runAction(call: () => Promise<PlaceResult>, verb: string): Promise<void> {
    buttons.forEach(b => (b.disabled = true));
    status.textContent = 'Working…';
    try {
      const result = await call();
      if (result.error) {
        status.textContent = `Error: ${result.error}`;
        return;
      }
      if (result.noop) {
        status.textContent = result.message ?? 'Nothing to do.';
        return;
      }
      const warn = Array.isArray(result.warnings) && result.warnings.length ? ` (${result.warnings.join(' ')})` : '';
      showToast(`${verb}${warn}`, { variant: warn ? 'warn' : 'success' });
      status.textContent = bboxSummary(api) ?? `${verb}.`;
    } catch (e) {
      status.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      buttons.forEach(b => (b.disabled = false));
    }
  }

  dropBtn.addEventListener('click', () => void runAction(() => api.placeModel({ dropToFloor: true, mode, preserveColor }), 'Dropped to floor'));
  centerBtn.addEventListener('click', () => void runAction(() => api.placeModel({ centerX: true, centerY: true, mode, preserveColor }), 'Centered on plate'));
  bothBtn.addEventListener('click', () => void runAction(() => api.placeModel({ dropToFloor: true, centerX: true, centerY: true, mode, preserveColor }), 'Dropped & centered'));
  layFlatBtn.addEventListener('click', () => void runAction(() => api.layFlatModel({ mode, preserveColor }), 'Laid flat'));
  rotateBtn.addEventListener('click', () => {
    const x = parseFloat(axisInputs.x.value) || 0;
    const y = parseFloat(axisInputs.y.value) || 0;
    const z = parseFloat(axisInputs.z.value) || 0;
    void runAction(() => api.rotateModel({ x, y, z, mode, preserveColor }), `Rotated (${x}°, ${y}°, ${z}°)`);
  });

  const close = () => {
    dragHandle.destroy();
    panel.remove();
    openModal = null;
    currentPlaceClose = null;
    closeViewportPanel(placeRegistryEntry);
    document.removeEventListener('keydown', onPlaceEscape);
  };
  closeBtn.addEventListener('click', close);
  closeFooterBtn.addEventListener('click', close);

  container.append(panel);
  setInitialPanelPosition(panel);
  currentPlaceClose = close;
  openViewportPanel(placeRegistryEntry);
  document.addEventListener('keydown', onPlaceEscape);
  openModal = panel as HTMLDivElement;
}

const BTN_BASE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur border border-zinc-700 text-zinc-200 hover:bg-zinc-700';

export function initPlaceUI(api: PlaceApi): void {
  registerCommands([
    {
      id: 'place-model',
      title: 'Place / Rotate model',
      hint: 'Transform',
      keywords: 'place rotate plate floor bed drop center align lay flat ground origin orient transform',
      run: () => openPlaceModal(api),
    },
    {
      id: 'place-drop-floor',
      title: 'Drop model to floor',
      hint: 'Transform',
      keywords: 'drop floor bed z zero ground sink align',
      run: () => { void api.placeModel({ dropToFloor: true, mode: 'auto' }); },
    },
    {
      id: 'place-center-plate',
      title: 'Center model on plate',
      hint: 'Transform',
      keywords: 'center plate origin xy align middle',
      run: () => { void api.placeModel({ centerX: true, centerY: true, mode: 'auto' }); },
    },
    {
      id: 'place-lay-flat',
      title: 'Lay model flat (auto-orient)',
      hint: 'Transform',
      keywords: 'lay flat auto orient rotate largest face down bed level',
      run: () => { void api.layFlatModel({ mode: 'auto' }); },
    },
  ]);

  const mount = () => {
    if (document.getElementById('place-viewport-toggle')) return;
    const styleRef = document.getElementById('resize-viewport-toggle')
      ?? document.getElementById('surface-viewport-toggle')
      ?? document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter(c => c !== 'hidden').join(' ') || BTN_BASE;
    const btn = el('button', btnCls);
    btn.id = 'place-viewport-toggle';
    btn.textContent = '⤓ Place/Rotate';
    btn.title = 'Drop to the floor, center, rotate, or auto lay-flat';
    btn.addEventListener('click', () => openPlaceModal(api));
    host.appendChild(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('place-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
