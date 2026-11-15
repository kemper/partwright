// "Print preview" block of the 3MF export dialog: an optional look at how a
// ticked object will print, before the file is written. It shows the object as
// the export will colour it (its layer-colour bands, or its own paint), with a
// layer slider that cuts it like a slicer's and, for layer colours, the
// estimated-blending view.
//
// Pure UI: the caller supplies `render`, which draws one object off screen.
// Nothing here changes what is exported.

import { createSliderEntry, type SliderEntry } from './sliderEntry';
import { BUTTON_SMALL_SECONDARY } from './styleConstants';

/** One drawn frame of the preview. */
export interface ExportPrintPreviewFrame {
  canvas: HTMLCanvasElement;
  /** `'layerColors'`: bands by layer height. `'paint'`: the object's own colours. */
  kind: 'layerColors' | 'paint';
  totalLayers: number;
  /** Layers shown (equals `totalLayers` when not cut). */
  layer: number;
  /** Height of the cut in mm above the bed, or null when shown whole. */
  z: number | null;
  /** The object's height in mm. */
  height: number;
  /** Anything worth saying about this object's export (e.g. its layer colours are left out). */
  note?: string;
}

export interface ExportPrintPreviewHooks {
  /** Draw one object as it will print. `layer` null shows it whole. Resolves
   *  null when the object produced no geometry. */
  render(objectId: string, view: { layer: number | null; blend: boolean; size: number }): Promise<ExportPrintPreviewFrame | null>;
}

export interface ExportPrintPreviewBlock {
  el: HTMLElement;
  /** Call when the ticked objects change. */
  sync(): void;
  /** For `toolState`. */
  state(): Record<string, unknown>;
  dispose(): void;
}

/** Whether the block was open the last time, in this tab (not persisted). */
let rememberedShown = false;

const PREVIEW_PX = 360;
const TOUCH = 'min-h-[44px] md:min-h-0';
const fmtMm = (n: number) => `${Number(n.toFixed(2))} mm`;

export function createExportPrintPreview(
  hooks: ExportPrintPreviewHooks,
  /** The ticked objects, in list order. */
  objects: () => { id: string; name: string }[],
  opts: { show?: boolean } = {},
): ExportPrintPreviewBlock {
  let shown = opts.show ?? rememberedShown;
  let objectId: string | null = null;
  let layer: number | null = null;
  let blend = false;
  let frame: ExportPrintPreviewFrame | null = null;
  let generation = 0;
  let raf = 0;
  let disposed = false;
  let slider: SliderEntry | null = null;

  const el = document.createElement('div');
  el.className = 'mt-4 pt-3 border-t border-zinc-700';
  el.dataset.exportPrintPreview = '';

  const head = document.createElement('div');
  head.className = 'flex items-center justify-between gap-2';
  const title = document.createElement('div');
  title.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400';
  title.textContent = 'Print preview';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `${BUTTON_SMALL_SECONDARY} ${TOUCH}`;
  toggle.dataset.exportPrintPreviewToggle = '';
  head.append(title, toggle);

  const hint = document.createElement('div');
  hint.className = 'text-[10px] text-zinc-500 leading-snug mt-1';
  hint.textContent = 'See how an object will print before exporting: its colours, layer by layer.';

  const body = document.createElement('div');
  body.className = 'flex flex-col gap-2 mt-2';

  const objectSel = document.createElement('select');
  objectSel.className = 'w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1 cursor-pointer';
  objectSel.setAttribute('aria-label', 'Object to preview');

  const stage = document.createElement('div');
  stage.className = 'relative w-full aspect-square rounded border border-zinc-700 bg-zinc-900 overflow-hidden flex items-center justify-center';
  stage.dataset.exportPrintPreviewStage = '';
  const status = document.createElement('div');
  status.className = 'text-[11px] text-zinc-500';

  const layerRow = document.createElement('div');
  layerRow.className = 'flex flex-col gap-1';
  const layerLabel = document.createElement('div');
  layerLabel.className = 'flex items-baseline justify-between text-[11px]';
  const layerTitle = document.createElement('span');
  layerTitle.className = 'text-zinc-300';
  layerTitle.textContent = 'Layer';
  const readout = document.createElement('span');
  readout.className = 'tabular-nums text-zinc-400';
  readout.dataset.exportPrintPreviewReadout = '';
  layerLabel.append(layerTitle, readout);
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'flex items-center gap-2';
  layerRow.append(layerLabel, sliderWrap);

  const blendLabel = document.createElement('label');
  blendLabel.className = `flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer ${TOUCH}`;
  const blendBox = document.createElement('input');
  blendBox.type = 'checkbox';
  blendBox.className = 'accent-blue-500';
  blendBox.dataset.exportPrintPreviewBlend = '';
  const blendText = document.createElement('span');
  blendText.textContent = 'Estimated blending (a rough guide for thin top layers)';
  blendLabel.append(blendBox, blendText);

  const caption = document.createElement('div');
  caption.className = 'text-[10px] text-zinc-500 leading-snug';
  caption.dataset.exportPrintPreviewCaption = '';

  body.append(objectSel, stage, layerRow, blendLabel, caption);
  // The controls join the dialog only while the preview is shown, so a dialog
  // that never asks for it is exactly the dialog it was.
  el.append(head, hint);

  function renderChrome(): void {
    toggle.textContent = shown ? 'Hide' : 'Show';
    toggle.setAttribute('aria-expanded', String(shown));
    if (shown) el.appendChild(body); else body.remove();
    hint.classList.toggle('hidden', shown);
  }

  function showFrame(): void {
    stage.replaceChildren();
    if (!frame) {
      stage.appendChild(status);
      layerRow.classList.add('hidden');
      blendLabel.classList.add('hidden');
      caption.textContent = '';
      return;
    }
    frame.canvas.className = 'w-full h-full object-contain';
    stage.appendChild(frame.canvas);
    const total = Math.max(1, frame.totalLayers);
    layerRow.classList.remove('hidden');
    if (!slider || Number(slider.range.max) !== total) {
      sliderWrap.replaceChildren();
      slider = createSliderEntry({
        label: 'Layers printed',
        min: 1, max: total, step: 1, value: Math.min(frame.layer || total, total),
        format: (v: number) => String(Math.round(v)),
        onChange: (v: number) => {
          const n = Math.round(v);
          layer = n >= total ? null : n;
          schedule();
        },
      });
      slider.range.classList.add('flex-1', ...TOUCH.split(' '));
      slider.range.dataset.exportPrintPreviewLayer = '';
      slider.input.classList.add(...TOUCH.split(' '));
      sliderWrap.append(slider.range, slider.input);
    } else if (!raf) {
      slider.set(Math.min(frame.layer || total, total));
    }
    readout.textContent = `${frame.layer} of ${frame.totalLayers}, ${fmtMm(frame.z ?? frame.height)}`;
    blendLabel.classList.toggle('hidden', frame.kind !== 'layerColors');
    blendBox.checked = blend;
    const what = frame.kind === 'layerColors'
      ? 'Colours by layer height, as this export writes them.'
      : 'This object\'s own colours. It has no colours by layer height.';
    caption.textContent = frame.note ? `${what} ${frame.note}` : what;
  }

  async function draw(): Promise<void> {
    if (disposed || !shown) return;
    const id = objectId;
    if (!id) { frame = null; status.textContent = 'Tick an object to preview it.'; showFrame(); return; }
    const mine = ++generation;
    if (!frame) { status.textContent = 'Preparing the preview…'; showFrame(); }
    let next: ExportPrintPreviewFrame | null = null;
    try {
      next = await hooks.render(id, { layer, blend, size: PREVIEW_PX * Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1))) });
    } catch {
      next = null;
    }
    if (disposed || mine !== generation) return;
    frame = next;
    if (!frame) status.textContent = 'This object has nothing to preview.';
    showFrame();
  }

  /** One redraw per frame at most while the slider is dragged. */
  function schedule(): void {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; void draw(); });
  }

  function syncObjects(): void {
    const list = objects();
    objectSel.replaceChildren();
    for (const o of list) {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      objectSel.appendChild(opt);
    }
    objectSel.classList.toggle('hidden', list.length < 2);
    const keep = objectId !== null && list.some(o => o.id === objectId);
    const nextId = keep ? objectId : list[0]?.id ?? null;
    if (nextId !== objectId) {
      objectId = nextId;
      layer = null;
      frame = null;
      slider = null;
    }
    if (objectId) objectSel.value = objectId;
  }

  toggle.addEventListener('click', () => {
    shown = !shown;
    rememberedShown = shown;
    renderChrome();
    if (shown) { syncObjects(); void draw(); }
  });
  objectSel.addEventListener('change', () => {
    objectId = objectSel.value || null;
    layer = null;
    frame = null;
    slider = null;
    void draw();
  });
  blendBox.addEventListener('change', () => { blend = blendBox.checked; void draw(); });

  renderChrome();
  if (shown) { syncObjects(); void draw(); }

  return {
    el,
    sync() {
      if (disposed || !shown) return;
      const before = objectId;
      syncObjects();
      // The same object stays on screen; a different (or no) one is redrawn.
      if (objectId !== before || !frame) void draw();
    },
    state() {
      if (!shown) return { shown: false };
      const name = objects().find(o => o.id === objectId)?.name ?? null;
      return {
        shown: true,
        object: name,
        ...(frame ? { kind: frame.kind, layer: frame.layer, totalLayers: frame.totalLayers, z: frame.z, blend: frame.kind === 'layerColors' && blend } : { ready: false }),
      };
    },
    dispose() {
      disposed = true;
      generation++;
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
