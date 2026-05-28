// Relief Studio — a tool-palette overlay over the 3D viewport for HueForge-style
// work: pick reference filaments, switch the optical preview mode, set layer
// height, and read the single-nozzle swap guide. Painting itself happens via the
// existing paint tools; this panel is the surrounding controls + guide readout.

import type { PreviewMode, SwapGuide } from '../relief/types';
import { listFilaments, addFilament, removeFilament, hexToRgb } from '../relief/filaments';
import { swapGuideToText, rgbToHex } from '../relief/swapGuide';

export interface ReliefStudioDeps {
  getLayerHeight(): number;
  setLayerHeight(mm: number): void;
  getPreviewMode(): PreviewMode;
  setPreviewMode(mode: PreviewMode): void;
  getSwapGuide(): SwapGuide | null;
  detectLevels(): void;
  onClose(): void;
}

export interface ReliefStudioHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  isOpen(): boolean;
  refresh(): void;
}

const PREVIEW_MODES: { mode: PreviewMode; label: string; caption: string }[] = [
  { mode: 'flat', label: 'Flat', caption: 'Raw paint colours — no optical simulation.' },
  { mode: 'ams', label: 'Multi-material', caption: 'Glossy AMS / multi-material look — one filament per region, no light bleed.' },
  { mode: 'single-nozzle', label: 'Single nozzle', caption: 'Translucent swap simulation — light bleeds through thin layers.' },
];

function rgbToCSS([r, g, b]: [number, number, number]): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

function makeSwatch(rgb: [number, number, number], size = 'w-4 h-4'): HTMLElement {
  const s = document.createElement('span');
  s.className = `${size} rounded-sm shrink-0 border border-black/30`;
  s.style.backgroundColor = rgbToCSS(rgb);
  return s;
}

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5 font-medium';
  el.textContent = text;
  return el;
}

export function mountReliefStudio(host: HTMLElement, deps: ReliefStudioDeps): ReliefStudioHandle {
  const panel = document.createElement('div');
  panel.id = 'relief-studio';
  panel.className =
    'hidden absolute top-2 left-2 z-10 w-[300px] max-w-[calc(100vw-1rem)] max-h-[calc(100%-1rem)] ' +
    'flex flex-col bg-zinc-800/90 backdrop-blur border border-zinc-600/50 rounded-lg shadow-xl overflow-hidden';

  // === Header ===
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-3 py-2 border-b border-zinc-700/70 shrink-0';
  const title = document.createElement('span');
  title.className = 'text-sm font-medium text-zinc-100 flex-1';
  title.textContent = '✦ Relief Studio';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className =
    'shrink-0 w-8 h-8 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/70 transition-colors text-lg leading-none';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close Relief Studio';
  closeBtn.addEventListener('click', () => deps.onClose());
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // === Scroll body ===
  const body = document.createElement('div');
  body.className = 'flex flex-col gap-4 px-3 py-3 overflow-y-auto min-h-0';
  panel.appendChild(body);

  // --- Preview mode (segmented) ---
  const previewSection = document.createElement('div');
  previewSection.appendChild(sectionLabel('Preview mode'));
  const seg = document.createElement('div');
  seg.className = 'grid grid-cols-3 gap-1';
  const segButtons = new Map<PreviewMode, HTMLButtonElement>();
  for (const { mode, label } of PREVIEW_MODES) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.title = label;
    btn.className = segButtonClass(false);
    btn.addEventListener('click', () => {
      deps.setPreviewMode(mode);
      handle.refresh();
    });
    segButtons.set(mode, btn);
    seg.appendChild(btn);
  }
  previewSection.appendChild(seg);
  const previewCaption = document.createElement('div');
  previewCaption.className = 'text-[10px] text-zinc-500 mt-1.5 leading-relaxed';
  previewSection.appendChild(previewCaption);
  body.appendChild(previewSection);

  // --- Layer height ---
  const layerSection = document.createElement('div');
  layerSection.appendChild(sectionLabel('Layer height'));
  const layerRow = document.createElement('div');
  layerRow.className = 'flex items-center gap-2';
  const layerInput = document.createElement('input');
  layerInput.type = 'number';
  layerInput.step = '0.02';
  layerInput.min = '0.04';
  layerInput.max = '2';
  layerInput.className =
    'flex-1 min-w-0 px-2 py-1.5 text-sm bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  layerInput.title = 'Print layer height in mm — drives the swap guide';
  const applyLayer = (): void => {
    const raw = parseFloat(layerInput.value);
    if (!Number.isFinite(raw) || raw < 0.04 || raw > 2) {
      layerInput.value = deps.getLayerHeight().toFixed(2);
      return;
    }
    deps.setLayerHeight(raw);
    handle.refresh();
  };
  layerInput.addEventListener('change', applyLayer);
  layerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { applyLayer(); layerInput.blur(); }
  });
  layerRow.appendChild(layerInput);
  const layerUnit = document.createElement('span');
  layerUnit.className = 'text-xs text-zinc-500';
  layerUnit.textContent = 'mm';
  layerRow.appendChild(layerUnit);
  layerSection.appendChild(layerRow);
  body.appendChild(layerSection);

  // --- Filament palette ---
  const filSection = document.createElement('div');
  filSection.appendChild(sectionLabel('Filament palette'));
  const filHint = document.createElement('div');
  filHint.className = 'text-[10px] text-zinc-500 mb-1.5 leading-snug';
  filHint.textContent = 'TD = transmission distance, how far light passes through (mm). Larger = more translucent. Used by the Single-nozzle preview.';
  filSection.appendChild(filHint);
  const filList = document.createElement('div');
  filList.className = 'flex flex-col gap-1';
  filSection.appendChild(filList);
  filSection.appendChild(buildAddFilamentForm(() => handle.refresh()));
  body.appendChild(filSection);

  // --- Swap guide ---
  const guideSection = document.createElement('div');
  guideSection.appendChild(sectionLabel('Single-nozzle swap guide'));
  const guideBody = document.createElement('div');
  guideSection.appendChild(guideBody);
  body.appendChild(guideSection);

  host.appendChild(panel);

  function renderPreview(): void {
    const active = deps.getPreviewMode();
    for (const [mode, btn] of segButtons) {
      btn.className = segButtonClass(mode === active);
    }
    const entry = PREVIEW_MODES.find((m) => m.mode === active);
    previewCaption.textContent = entry ? entry.caption : '';
  }

  function renderLayer(): void {
    if (document.activeElement !== layerInput) {
      layerInput.value = deps.getLayerHeight().toFixed(2);
    }
  }

  function renderFilaments(): void {
    filList.replaceChildren();
    const filaments = listFilaments();
    if (filaments.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-[11px] text-zinc-500';
      empty.textContent = 'No filaments yet.';
      filList.appendChild(empty);
      return;
    }
    for (const f of filaments) {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2 py-1 px-1 -mx-1 rounded hover:bg-zinc-700/40 transition-colors';
      row.appendChild(makeSwatch(hexToRgb(f.hex)));
      const name = document.createElement('span');
      name.className = 'text-[11px] text-zinc-300 flex-1 truncate';
      name.textContent = f.name;
      row.appendChild(name);
      const td = document.createElement('span');
      td.className = 'text-[10px] text-zinc-500 tabular-nums shrink-0';
      td.textContent = `TD ${f.td}mm`;
      row.appendChild(td);
      const rm = document.createElement('button');
      rm.className =
        'shrink-0 w-8 h-8 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60 transition-colors text-base leading-none';
      rm.textContent = '×';
      rm.title = `Remove ${f.name}`;
      rm.addEventListener('click', () => {
        removeFilament(f.id);
        handle.refresh();
      });
      row.appendChild(rm);
      filList.appendChild(row);
    }
  }

  function renderGuide(): void {
    guideBody.replaceChildren();
    const guide = deps.getSwapGuide();

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1.5 flex-wrap';
    const detectBtn = document.createElement('button');
    detectBtn.className = 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
    detectBtn.textContent = 'Detect levels';
    detectBtn.title = "Seed color regions from an imported HueForge's existing height steps";
    detectBtn.addEventListener('click', () => {
      deps.detectLevels();
      handle.refresh();
    });
    actions.appendChild(detectBtn);

    if (!guide) {
      const hint = document.createElement('div');
      hint.className = 'text-[11px] text-zinc-500 leading-relaxed mb-2';
      hint.textContent = 'Paint the relief, then a single-nozzle swap guide appears here.';
      guideBody.appendChild(hint);
      guideBody.appendChild(actions);
      return;
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
    copyBtn.textContent = 'Copy guide';
    copyBtn.title = 'Copy the swap guide as plain text';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(swapGuideToText(guide));
        copyBtn.textContent = 'Copied';
        window.setTimeout(() => { copyBtn.textContent = 'Copy guide'; }, 1200);
      } catch {
        copyBtn.textContent = 'Copy failed';
        window.setTimeout(() => { copyBtn.textContent = 'Copy guide'; }, 1200);
      }
    });
    actions.appendChild(copyBtn);

    // Base color
    const base = guide.bands[0];
    const baseRow = document.createElement('div');
    baseRow.className = 'flex items-center gap-2 mb-2';
    if (base) {
      baseRow.appendChild(makeSwatch(base.color));
      const baseLabel = document.createElement('span');
      baseLabel.className = 'text-[11px] text-zinc-300';
      baseLabel.textContent = `Base · ${rgbToHex(base.color)} (load at layer 0)`;
      baseRow.appendChild(baseLabel);
    } else {
      const baseLabel = document.createElement('span');
      baseLabel.className = 'text-[11px] text-zinc-500';
      baseLabel.textContent = 'Base · (none — empty relief)';
      baseRow.appendChild(baseLabel);
    }
    guideBody.appendChild(baseRow);

    // Swaps (ordered)
    if (guide.swaps.length === 0) {
      const none = document.createElement('div');
      none.className = 'text-[11px] text-zinc-500 mb-2';
      none.textContent = 'No swaps — single color throughout.';
      guideBody.appendChild(none);
    } else {
      const ol = document.createElement('ol');
      ol.className = 'flex flex-col gap-1 mb-2';
      guide.swaps.forEach((swap, i) => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-2';
        const idx = document.createElement('span');
        idx.className = 'text-[10px] text-zinc-600 tabular-nums w-4 text-right shrink-0';
        idx.textContent = `${i + 1}.`;
        li.appendChild(idx);
        li.appendChild(makeSwatch(swap.color, 'w-3.5 h-3.5'));
        const text = document.createElement('span');
        text.className = 'text-[11px] text-zinc-300 leading-tight';
        const name = swap.filamentName ? ` · ${swap.filamentName}` : '';
        text.textContent = `Layer ${swap.atLayer} · Z=${swap.atZ.toFixed(2)} mm · ${rgbToHex(swap.color)}${name}`;
        li.appendChild(text);
        ol.appendChild(li);
      });
      guideBody.appendChild(ol);
    }

    // Totals
    const totals = document.createElement('div');
    totals.className = 'text-[11px] text-zinc-400 tabular-nums mb-2';
    totals.textContent = `${guide.totalLayers} layers · ${guide.totalHeight.toFixed(2)} mm tall`;
    guideBody.appendChild(totals);

    // Printability bar
    const printPct = Math.round(Math.max(0, Math.min(1, guide.printability)) * 100);
    const printWrap = document.createElement('div');
    printWrap.className = 'mb-2';
    printWrap.title = 'How faithfully a single-nozzle swap print can reproduce the painting. ≥90% green: clean. 60–89% amber: some layer mixing. <60% red: needs AMS, or constrain paint to Z-slabs.';
    const printLabel = document.createElement('div');
    printLabel.className = 'flex items-center justify-between text-[10px] text-zinc-500 mb-0.5';
    const printText = document.createElement('span');
    printText.textContent = 'Printability';
    const printVal = document.createElement('span');
    printVal.className = 'tabular-nums';
    printVal.textContent = `${printPct}%`;
    printLabel.appendChild(printText);
    printLabel.appendChild(printVal);
    printWrap.appendChild(printLabel);
    const track = document.createElement('div');
    track.className = 'h-1.5 rounded-full bg-zinc-700/70 overflow-hidden';
    const fill = document.createElement('div');
    fill.className = `h-full rounded-full ${printPct >= 90 ? 'bg-emerald-500' : printPct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`;
    fill.style.width = `${printPct}%`;
    track.appendChild(fill);
    printWrap.appendChild(track);
    guideBody.appendChild(printWrap);

    // Warnings
    if (guide.warnings.length > 0) {
      const warnWrap = document.createElement('div');
      warnWrap.className = 'flex flex-col gap-1 mb-2';
      for (const w of guide.warnings) {
        const note = document.createElement('div');
        note.className = 'text-[10px] text-amber-400/90 leading-relaxed flex gap-1';
        const icon = document.createElement('span');
        icon.className = 'shrink-0';
        icon.textContent = '⚠';
        const msg = document.createElement('span');
        msg.textContent = w;
        note.appendChild(icon);
        note.appendChild(msg);
        warnWrap.appendChild(note);
      }
      guideBody.appendChild(warnWrap);
    }

    guideBody.appendChild(actions);
  }

  const handle: ReliefStudioHandle = {
    show() {
      panel.classList.remove('hidden');
      handle.refresh();
    },
    hide() {
      panel.classList.add('hidden');
    },
    toggle() {
      if (handle.isOpen()) handle.hide();
      else handle.show();
    },
    isOpen() {
      return !panel.classList.contains('hidden');
    },
    refresh() {
      renderPreview();
      renderLayer();
      renderFilaments();
      renderGuide();
    },
  };

  handle.refresh();
  return handle;
}

function segButtonClass(active: boolean): string {
  if (active) {
    return 'px-2 py-1.5 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center';
  }
  return 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

function buildAddFilamentForm(onAdded: () => void): HTMLElement {
  const form = document.createElement('div');
  form.className = 'flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-700/70';

  const color = document.createElement('input');
  color.type = 'color';
  color.value = '#888888';
  color.className = 'shrink-0 w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent';
  color.title = 'Filament color';

  const name = document.createElement('input');
  name.type = 'text';
  name.placeholder = 'Name';
  name.className = 'flex-1 min-w-0 px-2 py-1.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200';
  name.title = 'Filament name';

  const td = document.createElement('input');
  td.type = 'number';
  td.step = '0.1';
  td.min = '0';
  td.value = '1';
  td.className = 'w-14 shrink-0 px-1.5 py-1.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums';
  td.title = 'Transmission distance (mm) — how far light penetrates';

  const add = document.createElement('button');
  add.className = 'shrink-0 px-2 py-1.5 rounded text-[11px] bg-blue-500/30 text-blue-200 hover:bg-blue-500/50 border border-blue-500/50 transition-colors';
  add.textContent = '+ Add';
  add.title = 'Add this filament to the palette';

  const submit = (): void => {
    const trimmed = name.value.trim();
    if (!trimmed) {
      name.focus();
      return;
    }
    const tdVal = parseFloat(td.value);
    addFilament({ name: trimmed, hex: color.value, td: Number.isFinite(tdVal) && tdVal >= 0 ? tdVal : 1 });
    name.value = '';
    td.value = '1';
    color.value = '#888888';
    onAdded();
  };
  add.addEventListener('click', submit);
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  td.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  form.appendChild(color);
  form.appendChild(name);
  form.appendChild(td);
  form.appendChild(add);
  return form;
}
