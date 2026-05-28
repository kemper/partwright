// Relief Studio — a tool-palette overlay over the 3D viewport for image-derived
// parts: edit the colour palette, switch the optical preview mode, set layer
// height, and read the single-nozzle swap guide. Painting itself happens via the
// existing paint tools; this panel is the surrounding controls + guide readout.
// The "stepped relief" knobs (preview mode, swap guide, layer height) are
// gated behind an "advanced" toggle since most users want only the colour
// palette for keychain-style imports.

import type { PreviewMode, SwapGuide } from '../relief/types';
import { hexToRgb } from '../relief/filaments';
import { swapGuideToText, rgbToHex } from '../relief/swapGuide';
import {
  getRegions,
  onChange as onRegionsChange,
  updateRegionColor,
  updateRegionName,
  reorderRegion,
  removeRegion,
} from '../color/regions';

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
  /** Show or hide the small "Edit colors" chip that re-opens the studio
   *  after the user has closed it. The host decides when to surface it (only
   *  when the active session is image-derived). */
  setChipVisible(visible: boolean): void;
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

  // --- Advanced toggle: most users only want the colour palette, so the
  //     stepped-relief knobs (preview mode, layer height, swap guide) are
  //     hidden behind this checkbox. Default off keeps the panel uncluttered.
  let showAdvanced = false;
  const advRow = document.createElement('label');
  advRow.className = 'flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer hover:text-zinc-200 self-end';
  const advBox = document.createElement('input');
  advBox.type = 'checkbox';
  advBox.className = 'w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800';
  advRow.appendChild(advBox);
  const advLabel = document.createElement('span');
  advLabel.textContent = 'Stepped-relief options';
  advRow.appendChild(advLabel);
  body.appendChild(advRow);

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

  // --- Colour palette ---
  const filSection = document.createElement('div');
  filSection.appendChild(sectionLabel('Edit colors'));
  const filHint = document.createElement('div');
  filHint.className = 'text-[10px] text-zinc-500 mb-1.5 leading-snug';
  filHint.textContent = 'Click a swatch to recolor the painted area, click the name to rename, or × to remove. Paint with the Paint tool to add new colors.';
  filSection.appendChild(filHint);
  const filList = document.createElement('div');
  filList.className = 'flex flex-col gap-1';
  filSection.appendChild(filList);
  body.appendChild(filSection);

  // --- Swap guide ---
  const guideSection = document.createElement('div');
  guideSection.appendChild(sectionLabel('Single-nozzle swap guide'));
  const guideBody = document.createElement('div');
  guideSection.appendChild(guideBody);
  body.appendChild(guideSection);

  function applyAdvancedVisibility(): void {
    previewSection.classList.toggle('hidden', !showAdvanced);
    layerSection.classList.toggle('hidden', !showAdvanced);
    guideSection.classList.toggle('hidden', !showAdvanced);
  }
  advBox.addEventListener('change', () => {
    showAdvanced = advBox.checked;
    applyAdvancedVisibility();
  });
  applyAdvancedVisibility();

  host.appendChild(panel);

  // "Edit colors" chip — a small viewport overlay button that re-opens the
  // studio after the user has closed it. Sits in the same corner as the
  // panel; visible only when the host opts in (relief sessions).
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className =
    'hidden absolute top-2 left-2 z-10 px-2.5 py-1.5 rounded-lg text-xs font-medium ' +
    'bg-zinc-800/90 backdrop-blur text-zinc-100 border border-zinc-600/50 shadow ' +
    'hover:bg-zinc-700/90 transition-colors flex items-center gap-1.5';
  chip.title = 'Edit colors · open the Relief Studio';
  const chipSwatch = document.createElement('span');
  chipSwatch.className = 'inline-block w-3 h-3 rounded-sm bg-gradient-to-br from-rose-400 via-amber-400 to-sky-500 border border-black/30';
  const chipLabel = document.createElement('span');
  chipLabel.textContent = 'Edit colors';
  chip.append(chipSwatch, chipLabel);
  chip.addEventListener('click', () => {
    chip.classList.add('hidden');
    handle.show();
  });
  host.appendChild(chip);

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
    // Backed by the SHARED region list — same data the paint UI shows. Edits
    // here (recolour, rename, reorder, delete) call the regions module, which
    // notifies the painted-mesh reconciler so the model updates in realtime.
    const regions = getRegions();
    if (regions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'text-[11px] text-zinc-500';
      empty.textContent = 'No colours yet — paint a face on the model to add one.';
      filList.appendChild(empty);
      return;
    }
    regions.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-1.5 py-1 px-1 -mx-1 rounded hover:bg-zinc-700/40 transition-colors';

      // Click-to-edit swatch. The native `<input type="color">` IS the swatch
      // (styled to look like one), so the OS picker pops up anchored to the
      // swatch — not at the corner of a separately-sized hidden input, which
      // was the root of the "picker closes too easily" complaint. `change`
      // fires once when the picker is committed, so we reconcile the model
      // mesh just once per pick instead of on every channel drag.
      const hex = rgbToHex(r.color);
      const swatchPicker = document.createElement('input');
      swatchPicker.type = 'color';
      swatchPicker.value = hex;
      swatchPicker.className = 'w-5 h-5 shrink-0 rounded-sm border border-black/30 cursor-pointer bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0';
      swatchPicker.title = `Click to change colour (${hex})`;
      swatchPicker.addEventListener('change', () => {
        updateRegionColor(r.id, hexToRgb(swatchPicker.value));
      });
      row.appendChild(swatchPicker);

      // Click-to-rename: name span swaps to an input on click; commits on
      // blur/Enter and reverts on Escape.
      const name = document.createElement('span');
      name.className = 'text-[11px] text-zinc-300 flex-1 truncate cursor-text';
      name.textContent = r.name;
      name.title = 'Click to rename';
      name.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = r.name;
        input.className = 'flex-1 min-w-0 px-1.5 py-0.5 text-[11px] bg-zinc-900 border border-zinc-600 rounded text-zinc-200';
        // settled gates BOTH the keydown handler and the blur handler so each
        // rename can only resolve once. Escape sets it to 'cancel' first,
        // then blurs the input — when the resulting blur event fires, commit
        // sees `settled = 'cancel'` and short-circuits. Enter/blur set
        // 'commit' and remove the blur listener so re-rendering can't
        // re-trigger commit a second time.
        let settled: 'commit' | 'cancel' | null = null;
        const commit = (): void => {
          if (settled) return;
          settled = 'commit';
          input.removeEventListener('blur', commit);
          const trimmed = input.value.trim();
          if (trimmed && trimmed !== r.name) {
            updateRegionName(r.id, trimmed);
          } else {
            renderFilaments();
          }
        };
        const cancel = (): void => {
          if (settled) return;
          settled = 'cancel';
          input.removeEventListener('blur', commit);
          renderFilaments();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { commit(); input.blur(); }
          else if (e.key === 'Escape') { cancel(); }
        });
        row.replaceChild(input, name);
        input.focus();
        input.select();
      });
      row.appendChild(name);

      const triCount = document.createElement('span');
      triCount.className = 'shrink-0 text-[10px] text-zinc-500 tabular-nums';
      triCount.textContent = `${r.triangles.size}△`;
      triCount.title = `${r.triangles.size} triangles painted`;
      row.appendChild(triCount);

      // Reorder buttons (up/down).
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60 text-[10px] disabled:opacity-30';
      upBtn.textContent = '↑';
      upBtn.title = 'Move up';
      upBtn.disabled = i === 0;
      upBtn.addEventListener('click', () => reorderRegion(r.id, i - 1));
      row.appendChild(upBtn);

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'shrink-0 w-5 h-5 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/60 text-[10px] disabled:opacity-30';
      downBtn.textContent = '↓';
      downBtn.title = 'Move down';
      downBtn.disabled = i === regions.length - 1;
      downBtn.addEventListener('click', () => reorderRegion(r.id, i + 1));
      row.appendChild(downBtn);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className =
        'shrink-0 w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-700/60 transition-colors text-base leading-none';
      rm.textContent = '×';
      rm.title = `Remove ${r.name} from the model`;
      rm.addEventListener('click', () => removeRegion(r.id));
      row.appendChild(rm);
      filList.appendChild(row);
    });
  }

  function renderGuide(): void {
    guideBody.replaceChildren();
    const guide = deps.getSwapGuide();

    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1.5 flex-wrap';
    const detectBtn = document.createElement('button');
    detectBtn.className = 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
    detectBtn.textContent = 'Detect levels';
    detectBtn.title = 'Seed color regions from an imported stepped-relief STL\'s existing height plateaus';
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
      chip.classList.add('hidden');
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
    setChipVisible(visible: boolean) {
      // Don't show the chip while the full panel is open — only one or the
      // other should ever be visible.
      const shouldShow = visible && panel.classList.contains('hidden');
      chip.classList.toggle('hidden', !shouldShow);
    },
  };

  // The Edit colors list mirrors the region store; any external mutation
  // (painting, undo, updateRegionColor from the paint UI) should re-render
  // the list so the two views stay in sync.
  onRegionsChange(() => { if (handle.isOpen()) renderFilaments(); });

  handle.refresh();
  return handle;
}

function segButtonClass(active: boolean): string {
  if (active) {
    return 'px-2 py-1.5 rounded text-[11px] bg-blue-500/30 text-blue-200 border border-blue-500/50 transition-colors text-center';
  }
  return 'px-2 py-1.5 rounded text-[11px] bg-zinc-700/40 text-zinc-300 hover:bg-zinc-600/60 border border-transparent transition-colors text-center';
}

