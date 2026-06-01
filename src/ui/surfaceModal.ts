// Surface modifiers UI — a floating panel for applying fuzzy skin, smooth/round,
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
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { setInitialPanelPosition, attachViewportPanelDrag } from './viewportPanelDrag';

type ApplyResult = { error?: string; label?: string } | Record<string, unknown>;
type ModId = 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'smooth' | 'voxelize';

/** The subset of the console API the surface UI needs. */
export interface SurfaceApi {
  applyFuzzySkin(opts?: { amplitude?: number; scale?: number; octaves?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyKnitTexture(opts?: { amplitude?: number; stitchWidth?: number; stitchHeight?: number; rowOffset?: number; roundness?: number; grainAngleDeg?: number; variation?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyCableKnit(opts?: { amplitude?: number; cableWidth?: number; cablePitch?: number; plyWidth?: number; grainAngleDeg?: number; variation?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyWaffleStitch(opts?: { amplitude?: number; cellWidth?: number; cellHeight?: number; sharpness?: number; rowOffset?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyFurVelvet(opts?: { amplitude?: number; fiberSpacing?: number; fiberLength?: number; octaves?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
  applyWovenFabric(opts?: { amplitude?: number; threadSpacing?: number; threadWidth?: number; underDepth?: number; grainAngleDeg?: number; seed?: number; quality?: number; preserveColor?: boolean }): Promise<ApplyResult>;
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
let currentSurfaceClose: (() => void) | null = null;

const surfaceRegistryEntry = { close(): void { currentSurfaceClose?.(); } };

function onSurfaceEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  currentSurfaceClose?.();
}

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

/** Find the viewport container used by the other overlay panels. */
function getViewportContainer(): HTMLElement {
  return (document.getElementById('clip-controls')?.offsetParent as HTMLElement | null) ?? document.body;
}

export function openSurfaceModal(api: SurfaceApi, initialTab: Tab = 'fuzzy'): void {
  if (openModal) { openModal.remove(); openModal = null; currentSurfaceClose = null; }
  const span = modelSpan(api);
  const painted = (() => { try { return api.modelHasColor(); } catch { return false; } })();

  const container = getViewportContainer();

  // Floating panel — absolutely positioned inside the viewport container.
  const panel = el('div', 'absolute z-[60] bg-zinc-900 text-zinc-100 rounded-lg border border-zinc-700 shadow-xl w-[min(94vw,400px)] select-none flex flex-col') as HTMLDivElement;

  // Header — drag handle + title + × button.
  const header = el('div', 'flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0');
  header.append(el('h2', 'text-sm font-semibold', 'Surface modifiers'));
  const closeBtn = el('button', 'text-zinc-400 hover:text-zinc-100 text-lg leading-none', '×');
  closeBtn.setAttribute('aria-label', 'Close surface panel');
  header.append(closeBtn);
  panel.append(header);
  attachViewportPanelDrag(header, panel);

  // Scrollable body.
  const scrollBody = el('div', 'overflow-y-auto flex-1 p-4 max-h-[min(80vh,30rem)]');
  panel.append(scrollBody);

  scrollBody.append(el('p', 'text-[11px] text-zinc-500 mb-3', 'Previews live in the viewport; Apply saves a new version (undo via version history).'));

  // Tab strip — wraps to a second line when there are too many to fit on one row.
  const tabRow = el('div', 'flex flex-wrap gap-1 mb-4');
  const body = el('div', '');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'fuzzy', label: 'Fuzzy' },
    { id: 'knit', label: 'Knit' },
    { id: 'cable', label: 'Cable' },
    { id: 'waffle', label: 'Waffle' },
    { id: 'fur', label: 'Fur' },
    { id: 'woven', label: 'Woven' },
    { id: 'smooth', label: 'Smooth' },
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

  // Shared detail slider — persists across texture-tab switches so the user's
  // chosen quality level is preserved when comparing different textures.
  // Not shown for smooth/voxelize (those have their own quality controls).
  const detailLabels = ['Draft', 'Low', 'Medium', 'High', 'Ultra'];
  const detail = slider('Mesh detail', 1, 5, 3, 1, n => detailLabels[n - 1], schedulePreview);

  // Per-tab option getters → modifier options object for preview/apply.
  let currentOpts: () => Record<string, unknown> = () => ({});

  function renderTab() {
    body.innerHTML = '';
    if (active === 'fuzzy') {
      const amp = slider('Amplitude (depth)', 0, span * 0.1, span * 0.01, span * 0.001, n => n.toFixed(3), schedulePreview);
      const scale = slider('Feature size', span * 0.005, span * 0.25, span * 0.04, span * 0.005, n => n.toFixed(3), schedulePreview);
      const oct = slider('Detail (octaves)', 1, 4, 2, 1, n => String(n), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(amp.wrap, scale.wrap, oct.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Densifies the mesh, then jitters the surface along its normals — the 3D-print "fuzzy skin" finish.'));
      currentOpts = () => ({ amplitude: amp.get(), scale: scale.get(), octaves: oct.get(), seed: seed.get(), quality: detail.get() });
    } else if (active === 'knit') {
      const sw = slider('Stitch width', span * 0.01, span * 0.25, span * 0.05, span * 0.005, n => n.toFixed(3), schedulePreview);
      const sh = slider('Stitch height', span * 0.01, span * 0.35, span * 0.07, span * 0.005, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (depth)', 0, span * 0.08, span * 0.03, span * 0.001, n => n.toFixed(3), schedulePreview);
      const round = slider('Roundness', 0, 1, 0.5, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const variation = slider('Variation', 0, 0.5, 0.1, 0.01, n => n.toFixed(2), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(sw.wrap, sh.wrap, amp.wrap, round.wrap, grain.wrap, variation.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Stockinette (V-stitch) pattern via brick-offset cosine bumps. Roundness 0 = sharp ridges; 1 = soft round bumps. Grain angle rotates the stitch direction.'));
      currentOpts = () => ({
        stitchWidth: sw.get(),
        stitchHeight: sh.get(),
        amplitude: amp.get(),
        roundness: round.get(),
        grainAngleDeg: grain.get(),
        variation: variation.get(),
        seed: seed.get(),
        quality: detail.get(),
      });
    } else if (active === 'cable') {
      const cw = slider('Cable width', span * 0.02, span * 0.3, span * 0.08, span * 0.005, n => n.toFixed(3), schedulePreview);
      const cp = slider('Cable pitch', span * 0.05, span * 0.6, span * 0.2, span * 0.005, n => n.toFixed(3), schedulePreview);
      const pw = slider('Ply width', span * 0.005, span * 0.1, span * 0.024, span * 0.001, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (depth)', 0, span * 0.08, span * 0.03, span * 0.001, n => n.toFixed(3), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const variation = slider('Variation', 0, 0.4, 0.08, 0.01, n => n.toFixed(2), schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(cw.wrap, cp.wrap, pw.wrap, amp.wrap, grain.wrap, variation.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Rope-like cable columns with crossing ply ridges. Cable pitch controls how tightly the plies twist.'));
      currentOpts = () => ({
        cableWidth: cw.get(),
        cablePitch: cp.get(),
        plyWidth: pw.get(),
        amplitude: amp.get(),
        grainAngleDeg: grain.get(),
        variation: variation.get(),
        seed: seed.get(),
        quality: detail.get(),
      });
    } else if (active === 'waffle') {
      const cw = slider('Cell width', span * 0.01, span * 0.3, span * 0.06, span * 0.005, n => n.toFixed(3), schedulePreview);
      const ch = slider('Cell height', span * 0.01, span * 0.3, span * 0.06, span * 0.005, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (border height)', 0, span * 0.08, span * 0.025, span * 0.001, n => n.toFixed(3), schedulePreview);
      const sharp = slider('Sharpness', 1, 10, 3, 0.5, n => n.toFixed(1), schedulePreview);
      const rowOff = slider('Row offset (0=grid, 0.5=honeycomb)', 0, 1, 0, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      body.append(cw.wrap, ch.wrap, amp.wrap, sharp.wrap, rowOff.wrap, grain.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Recessed cells with raised borders. Sharpness 1=soft round, 3=crisp waffle, 8+=very thin border. Row offset 0.5 = honeycomb pattern.'));
      currentOpts = () => ({
        cellWidth: cw.get(),
        cellHeight: ch.get(),
        amplitude: amp.get(),
        sharpness: sharp.get(),
        rowOffset: rowOff.get(),
        grainAngleDeg: grain.get(),
        quality: detail.get(),
      });
    } else if (active === 'fur') {
      const fs = slider('Fiber spacing', span * 0.003, span * 0.1, span * 0.02, span * 0.001, n => n.toFixed(3), schedulePreview);
      const fl = slider('Fiber length', span * 0.01, span * 0.4, span * 0.12, span * 0.005, n => n.toFixed(3), schedulePreview);
      const amp = slider('Amplitude (pile height)', 0, span * 0.08, span * 0.025, span * 0.001, n => n.toFixed(3), schedulePreview);
      const oct = slider('Detail (octaves)', 1, 4, 2, 1, n => String(n), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      const seed = slider('Seed', 1, 99, 1, 1, n => String(n), schedulePreview);
      body.append(fs.wrap, fl.wrap, amp.wrap, oct.wrap, grain.wrap, seed.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Anisotropic noise: fine cross-grain (fiber width), coarse along-grain (fiber length). Smaller spacing = finer velvet; larger = shaggy fur.'));
      currentOpts = () => ({
        fiberSpacing: fs.get(),
        fiberLength: fl.get(),
        amplitude: amp.get(),
        octaves: oct.get(),
        grainAngleDeg: grain.get(),
        seed: seed.get(),
        quality: detail.get(),
      });
    } else if (active === 'woven') {
      const ts = slider('Thread spacing', span * 0.005, span * 0.2, span * 0.04, span * 0.002, n => n.toFixed(3), schedulePreview);
      const tw = slider('Thread width (fraction)', 0.1, 0.9, 0.4, 0.05, n => n.toFixed(2), schedulePreview);
      const amp = slider('Amplitude (thread height)', 0, span * 0.06, span * 0.02, span * 0.001, n => n.toFixed(3), schedulePreview);
      const ud = slider('Under-thread depth', 0, 1, 0.5, 0.05, n => n.toFixed(2), schedulePreview);
      const grain = slider('Grain angle (°)', 0, 180, 0, 5, n => String(n) + '°', schedulePreview);
      body.append(ts.wrap, tw.wrap, amp.wrap, ud.wrap, grain.wrap, detail.wrap);
      body.append(el('p', 'text-[11px] text-zinc-500', 'Plain-weave interlacing: warp and weft threads alternate over/under. Thread width 0.4=open weave, 0.7=tight. Under-depth 0=flat valleys, 1=deep recess.'));
      currentOpts = () => ({
        threadSpacing: ts.get(),
        threadWidth: tw.get(),
        amplitude: amp.get(),
        underDepth: ud.get(),
        grainAngleDeg: grain.get(),
        quality: detail.get(),
      });
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

  scrollBody.append(tabRow, body);
  if (painted) scrollBody.append(colorRow);
  scrollBody.append(status);

  // Footer: Cancel | Apply.
  const footer = el('div', 'flex justify-end gap-2 mt-2');
  const cancelBtn = el('button', 'px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs', 'Cancel');
  const applyBtn = el('button', 'px-3 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium', 'Apply');
  footer.append(cancelBtn, applyBtn);
  scrollBody.append(footer);

  const close = () => {
    clearPreviewIfDirty();
    panel.remove();
    openModal = null;
    currentSurfaceClose = null;
    closeViewportPanel(surfaceRegistryEntry);
    document.removeEventListener('keydown', onSurfaceEscape);
  };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);

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
        : active === 'knit' ? await api.applyKnitTexture(opts)
        : active === 'cable' ? await api.applyCableKnit(opts)
        : active === 'waffle' ? await api.applyWaffleStitch(opts)
        : active === 'fur' ? await api.applyFurVelvet(opts)
        : active === 'woven' ? await api.applyWovenFabric(opts)
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

  container.append(panel);
  setInitialPanelPosition(panel);
  currentSurfaceClose = close;
  openViewportPanel(surfaceRegistryEntry);
  document.addEventListener('keydown', onSurfaceEscape);
  openModal = panel;
}

/** Wire the surface modifiers into the viewport overlay and command palette. */
export function initSurfaceUI(api: SurfaceApi): void {
  // Command palette entries — one per modifier, opening the modal on that tab.
  registerCommands([
    { id: 'surface-fuzzy', title: 'Surface: Fuzzy skin', hint: 'Modifier', keywords: 'texture displacement rough print fuzzy', run: () => openSurfaceModal(api, 'fuzzy') },
    { id: 'surface-knit', title: 'Surface: Knit texture', hint: 'Modifier', keywords: 'knit stitch fabric texture sweater yarn stockinette', run: () => openSurfaceModal(api, 'knit') },
    { id: 'surface-cable', title: 'Surface: Cable knit', hint: 'Modifier', keywords: 'cable knit aran rope twist ply yarn sweater', run: () => openSurfaceModal(api, 'cable') },
    { id: 'surface-waffle', title: 'Surface: Waffle stitch', hint: 'Modifier', keywords: 'waffle stitch grid honeycomb cell recessed border', run: () => openSurfaceModal(api, 'waffle') },
    { id: 'surface-fur', title: 'Surface: Fur / velvet', hint: 'Modifier', keywords: 'fur velvet pile fabric soft directional fiber', run: () => openSurfaceModal(api, 'fur') },
    { id: 'surface-woven', title: 'Surface: Woven fabric', hint: 'Modifier', keywords: 'woven weave fabric basket cloth interlace thread', run: () => openSurfaceModal(api, 'woven') },
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
    const btnCls = anchor.className.split(' ').filter(c => c !== 'hidden').join(' ') || BTN_BASE;
    const btn = el('button', btnCls);
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
