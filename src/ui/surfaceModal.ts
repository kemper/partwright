// Surface modifiers UI — a small modal for applying fuzzy skin, smooth/round,
// and voxelize to the current model. It drives the public console API
// (`partwright.applyFuzzySkin` / `smoothModel` / `voxelizeModel`), so the modal
// stays decoupled from the editor internals; each apply produces a new version
// exactly as if the user had typed and run the equivalent code (so undo/redo is
// just the app's version history).
//
// Preview is non-destructive: it swaps the viewport mesh via
// `previewSurfaceModifier` without running the engine or saving a version, and
// is cleared (`clearSurfacePreview`) on close/cancel/tab-switch. Slider changes
// trigger a debounced auto-preview; an explicit "Preview" button forces one.

import { registerCommands } from './commandPalette';
import { getConfig } from '../config/appConfig';

type ApplyResult = { error?: string; label?: string } | Record<string, unknown>;
type ModId = 'fuzzy' | 'smooth' | 'voxelize';

/** The subset of the console API the surface UI needs. */
export interface SurfaceApi {
  applyFuzzySkin(opts?: { amplitude?: number; scale?: number; octaves?: number; seed?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  smoothModel(opts?: { iterations?: number; subdivide?: boolean; preserveColor?: boolean }): Promise<ApplyResult>;
  voxelizeModel(opts?: { resolution?: number; smooth?: boolean; preserveColor?: boolean }): Promise<ApplyResult>;
  previewSurfaceModifier(id: ModId, opts?: Record<string, unknown>, preserveColor?: boolean): { ok: true } | { error: string };
  clearSurfacePreview(): { ok: true };
  modelHasColor(): boolean;
  getGeometryData(): { boundingBox?: { min?: number[]; max?: number[] } | null } | Record<string, unknown>;
}

type Tab = ModId;

const BTN_BASE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur border border-zinc-700 text-zinc-200 hover:bg-zinc-700';

let openModal: HTMLDivElement | null = null;

/** Current model's largest bbox dimension, for size-relative slider ranges. */
function modelSpan(api: SurfaceApi): number {
  try {
    const gd = api.getGeometryData() as { boundingBox?: { min?: number[]; max?: number[] } | null };
    const bb = gd?.boundingBox;
    if (bb && bb.min && bb.max) {
      const s = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
      if (Number.isFinite(s) && s > 0) return s;
    }
  } catch { /* fall through to default */ }
  return 10;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** A labeled range slider with a live numeric readout. `onChange` fires on input. */
function slider(label: string, min: number, max: number, value: number, step: number, fmt: (n: number) => string, onChange: () => void) {
  const wrap = el('label', 'block mb-3 text-xs text-zinc-300');
  const head = el('div', 'flex justify-between mb-1');
  head.append(el('span', '', label));
  const readout = el('span', 'text-zinc-400 tabular-nums', fmt(value));
  head.append(readout);
  const input = el('input', 'w-full accent-sky-500');
  input.type = 'range';
  input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
  input.addEventListener('input', () => { readout.textContent = fmt(input.valueAsNumber); onChange(); });
  wrap.append(head, input);
  return { wrap, get: () => input.valueAsNumber };
}

function checkbox(label: string, checked: boolean, onChange: () => void) {
  const wrap = el('label', 'flex items-center gap-2 mb-3 text-xs text-zinc-300 cursor-pointer');
  const input = el('input', 'accent-sky-500');
  input.type = 'checkbox'; input.checked = checked;
  input.addEventListener('change', onChange);
  wrap.append(input, el('span', '', label));
  return { wrap, get: () => input.checked };
}

export function openSurfaceModal(api: SurfaceApi, initialTab: Tab = 'fuzzy'): void {
  if (openModal) openModal.remove();
  const span = modelSpan(api);
  const painted = (() => { try { return api.modelHasColor(); } catch { return false; } })();

  // Right-aligned, matching the Paint / Relief panels (which dock to the right
  // edge) rather than floating dead-center over the viewport.
  const backdrop = el('div', 'fixed inset-0 z-[60] bg-black/60 flex items-center justify-end p-3');
  const panel = el('div', 'bg-zinc-900 text-zinc-100 rounded-lg border border-zinc-700 shadow-xl w-[min(94vw,440px)] max-h-[90vh] overflow-auto p-5');
  backdrop.append(panel);

  const titleRow = el('div', 'flex items-center justify-between mb-1');
  titleRow.append(el('h2', 'text-sm font-semibold', 'Surface modifiers'));
  const closeBtn = el('button', 'text-zinc-400 hover:text-zinc-100 text-lg leading-none', '×');
  titleRow.append(closeBtn);
  panel.append(titleRow);
  panel.append(el('p', 'text-[11px] text-zinc-500 mb-3', 'Previews live in the viewport; Apply saves a new version (undo via version history).'));

  // Tab strip.
  const tabRow = el('div', 'flex gap-1 mb-4');
  const body = el('div', '');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'fuzzy', label: 'Fuzzy skin' },
    { id: 'smooth', label: 'Smooth / round' },
    { id: 'voxelize', label: 'Voxelize' },
  ];
  let active: Tab = initialTab;

  const status = el('div', 'text-[11px] text-zinc-400 min-h-[1rem] mb-2');

  // --- Color handling (shared across tabs) ---
  // Default to preserve; the toggle lets the user clear instead. The warning
  // only shows when the model is actually painted.
  let preserveColor = true;
  const colorRow = el('div', 'mb-3');
  if (painted) {
    const colorBox = checkbox('Preserve colors (best-effort)', true, () => {
      preserveColor = colorBox.get();
      warn.classList.toggle('hidden', preserveColor);
      schedulePreview();
    });
    const warn = el('p', 'hidden text-[11px] text-amber-400/90 mt-1', '⚠ Colors will be cleared by this effect.');
    const note = el('p', 'text-[11px] text-zinc-500 mt-1', 'Voxelize keeps per-voxel color; fuzzy/smooth re-resolve painted regions (brush strokes may not survive re-tessellation).');
    colorRow.append(colorBox.wrap, warn, note);
    // keep reference so the checkbox closure can find `warn` (defined above via hoist).
  }

  // Per-tab option getters → modifier options object for preview/apply.
  let currentOpts: () => Record<string, unknown> = () => ({});

  function renderTab() {
    body.innerHTML = '';
    if (active === 'fuzzy') {
      const amp = slider('Amplitude (depth)', 0, span * 0.1, span * 0.01, span * 0.001, n => n.toFixed(3), schedulePreview);
      const scale = slider('Feature size', span * 0.005, span * 0.25, span * 0.04, span * 0.005, n => n.toFixed(3), schedulePreview);
      const oct = slider('Detail (octaves)', 1, 4, 2, 1, n => String(n), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(amp.wrap, scale.wrap, oct.wrap, seed.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Densifies the mesh, then jitters the surface along its normals — the 3D-print "fuzzy skin" finish.'));
      currentOpts = () => ({ amplitude: amp.get(), scale: scale.get(), octaves: oct.get(), seed: seed.get() });
    } else if (active === 'smooth') {
      const iter = slider('Rounding strength', 1, 12, 4, 1, n => String(n), schedulePreview);
      const sub = checkbox('Subdivide first (rounds sharp corners)', true, schedulePreview);
      body.append(iter.wrap, sub.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Taubin smoothing relaxes edges into a softer form without shrinking the model. Great for low-poly or blocky parts.'));
      currentOpts = () => ({ iterations: iter.get(), subdivide: sub.get() });
    } else {
      const res = slider('Resolution (voxels)', 8, 128, 32, 1, n => String(n), schedulePreview);
      const sm = checkbox('Smooth voxels (rounded corners)', false, schedulePreview);
      body.append(res.wrap, sm.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Rasterizes the model into voxels. The result switches to the voxel engine, so you can paint, re-block, or .vox export it.'));
      currentOpts = () => ({ resolution: res.get(), smooth: sm.get() });
    }
    schedulePreview();
  }

  // --- Live preview (debounced) ---
  let previewTimer: number | undefined;
  let previewDirty = false; // a preview is currently shown (needs clearing on close)
  function runPreview() {
    const r = api.previewSurfaceModifier(active, currentOpts(), preserveColor);
    if ((r as { error?: string }).error) {
      status.textContent = `Preview error: ${(r as { error: string }).error}`;
    } else {
      previewDirty = true;
      status.textContent = 'Previewing — Apply to save a version.';
    }
  }
  function schedulePreview() {
    if (previewTimer !== undefined) clearTimeout(previewTimer);
    status.textContent = 'Updating preview…';
    previewTimer = window.setTimeout(runPreview, getConfig().ui.surfacePreviewDebounceMs);
  }
  function clearPreviewIfDirty() {
    if (previewTimer !== undefined) { clearTimeout(previewTimer); previewTimer = undefined; }
    if (previewDirty) { api.clearSurfacePreview(); previewDirty = false; }
  }

  const tabBtns = new Map<Tab, HTMLButtonElement>();
  function styleTabs() {
    for (const [id, b] of tabBtns) {
      b.className = id === active
        ? 'px-2.5 py-1 rounded text-xs bg-sky-600 text-white'
        : 'px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
    }
  }
  for (const t of tabs) {
    const b = el('button', '', t.label);
    b.addEventListener('click', () => { active = t.id; styleTabs(); renderTab(); });
    tabBtns.set(t.id, b);
    tabRow.append(b);
  }

  panel.append(tabRow, body);
  if (painted) panel.append(colorRow);
  panel.append(status);

  // Footer: Cancel | Apply. (Preview is automatic — it updates live as controls
  // change, so there's no explicit Preview button.)
  const footer = el('div', 'flex justify-end gap-2 mt-2');
  const cancelBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs', 'Cancel');
  const applyBtn = el('button', 'px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium', 'Apply');
  footer.append(cancelBtn, applyBtn);
  panel.append(footer);

  const close = () => { clearPreviewIfDirty(); backdrop.remove(); openModal = null; };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

  applyBtn.addEventListener('click', async () => {
    // The preview swapped the displayed mesh; clear it so the apply re-runs from
    // the real current model (commit re-renders the saved result anyway).
    clearPreviewIfDirty();
    applyBtn.disabled = true;
    const prev = applyBtn.textContent;
    applyBtn.textContent = 'Applying…';
    status.textContent = 'Working…';
    try {
      const opts = { ...currentOpts(), preserveColor };
      const result = active === 'fuzzy' ? await api.applyFuzzySkin(opts)
        : active === 'smooth' ? await api.smoothModel(opts)
        : await api.voxelizeModel(opts);
      const err = (result as { error?: string })?.error;
      if (err) {
        status.textContent = `Error: ${err}`;
        applyBtn.disabled = false;
        applyBtn.textContent = prev;
        return;
      }
      close();
    } catch (e) {
      status.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
      applyBtn.disabled = false;
      applyBtn.textContent = prev;
    }
  });

  styleTabs();
  renderTab(); // kicks off the first preview

  document.body.append(backdrop);
  openModal = backdrop;
}

/** Wire the surface modifiers into the viewport overlay and command palette. */
export function initSurfaceUI(api: SurfaceApi): void {
  // Command palette entries — one per modifier, opening the modal on that tab.
  registerCommands([
    { id: 'surface-fuzzy', title: 'Surface: Fuzzy skin', hint: 'Modifier', keywords: 'texture displacement rough print', run: () => openSurfaceModal(api, 'fuzzy') },
    { id: 'surface-smooth', title: 'Surface: Smooth / round edges', hint: 'Modifier', keywords: 'smooth round fillet taubin low-poly', run: () => openSurfaceModal(api, 'smooth') },
    { id: 'surface-voxelize', title: 'Surface: Voxelize model', hint: 'Modifier', keywords: 'voxel blocky minecraft pixel', run: () => openSurfaceModal(api, 'voxelize') },
  ]);

  // Viewport overlay button — inserted next to the Relief/Paint controls without
  // touching the overlay's creation code. Match the neighbour's styling.
  const mount = () => {
    if (document.getElementById('surface-viewport-toggle')) return;
    const anchor = document.getElementById('relief-viewport-toggle')
      ?? document.getElementById('paint-toggle')
      ?? document.querySelector<HTMLElement>('[id$="-viewport-toggle"]');
    if (!anchor || !anchor.parentElement) return;
    const btn = el('button', anchor.className || BTN_BASE);
    btn.id = 'surface-viewport-toggle';
    btn.textContent = '✦ Surface';
    btn.title = 'Apply fuzzy skin, smooth/round, or voxelize the current model';
    btn.addEventListener('click', () => openSurfaceModal(api));
    anchor.after(btn);
  };
  // The overlay may mount after init; retry a few times then give up (commands
  // still work even if the button never lands).
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('surface-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
