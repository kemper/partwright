// "Colors" tool — a viewport-overlay panel that reduces a model's colors to the
// filament palette. It enumerates the DISTINCT colors currently shown on the
// model (painted regions + code-declared api.label colors, unified in the
// composited tri-color buffer), auto-matches each to the nearest palette color,
// and lets the user override any of them with a palette swatch or a freehand
// color. Changes preview in real time; Apply bakes the result into color
// regions (so it persists + exports); Cancel reverts.
//
// Host wiring lives in main.ts via the ColorRemapHooks (it owns currentMeshData
// + the viewport). Region creation itself goes straight through regions.ts.

import { buildTriColors, addRegion, clearRegions } from './regions';
import { triColorHex, DEFAULT_COLOR_HEX } from '../export/meshClean';
import { loadPalette, nearestPaletteColor, hexToRgb, onPaletteChange } from './palette';
import type { MeshData } from '../geometry/types';

export interface ColorRemapHooks {
  /** The current rendered mesh, or null when nothing is loaded. */
  getMesh: () => MeshData | null;
  /** Push a temporary recolored mesh to the viewport (the buffer carries the
   *  `_painted` sidecar), or pass null to restore the real painted colors. */
  preview: (triColors: Uint8Array | null) => void;
  /** Fired after Apply commits regions (host may mark the version dirty). */
  onApplied?: () => void;
  /** Close any conflicting tool (e.g. paint) when this panel opens. */
  onOpen?: () => void;
}

interface SourceColor {
  hex: string;                       // source color, '#rrggbb'
  triangles: number[];
  /** Target hex the source maps to (defaults to nearest palette, else source). */
  target: string;
}

let hooks: ColorRemapHooks | null = null;
let toggleBtn: HTMLButtonElement | null = null;
let panel: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let emptyEl: HTMLElement | null = null;
let sources: SourceColor[] = [];
let open = false;

const cssOf = (hex: string): string => hex;

export function initColorRemapUI(container: HTMLElement, h: ColorRemapHooks): void {
  hooks = h;

  toggleBtn = document.createElement('button');
  toggleBtn.id = 'colors-toggle';
  toggleBtn.className = 'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';
  toggleBtn.textContent = '🌈 Colors';
  toggleBtn.title = 'Reduce the model\'s colors to your filament palette (auto-match + per-color override, with live preview).';
  toggleBtn.addEventListener('click', () => { open ? closePanel(true) : openPanel(); });
  container.appendChild(toggleBtn);

  panel = document.createElement('div');
  panel.id = 'colors-panel';
  panel.className = [
    'hidden z-20 flex flex-col overflow-hidden bg-zinc-800/95 backdrop-blur border border-zinc-600/60 shadow-xl text-zinc-200',
    'absolute inset-x-2 bottom-2 top-auto max-h-[60%] rounded-xl',
    'md:inset-x-auto md:bottom-auto md:left-auto md:right-2 md:top-12 md:w-72 md:max-h-[calc(100%-3.5rem)] md:rounded-lg',
  ].join(' ');

  const header = document.createElement('div');
  header.className = 'flex items-center justify-between px-3 py-2 border-b border-zinc-700/60 shrink-0';
  const title = document.createElement('div');
  title.className = 'text-xs font-semibold text-zinc-200';
  title.textContent = 'Colors → palette';
  const closeX = document.createElement('button');
  closeX.className = 'text-zinc-400 hover:text-zinc-200 text-sm leading-none';
  closeX.textContent = '✕';
  closeX.title = 'Close (discard preview)';
  closeX.addEventListener('click', () => closePanel(true));
  header.appendChild(title);
  header.appendChild(closeX);
  panel.appendChild(header);

  const content = document.createElement('div');
  content.className = 'flex-1 min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-2';
  panel.appendChild(content);

  const intro = document.createElement('p');
  intro.className = 'text-[11px] text-zinc-500 leading-snug';
  intro.textContent = 'Each color on the model, matched to the nearest filament. Override any target, then Apply.';
  content.appendChild(intro);

  const matchAllBtn = document.createElement('button');
  matchAllBtn.className = 'self-start px-2.5 py-1 rounded text-[11px] font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100';
  matchAllBtn.textContent = 'Match all to palette';
  matchAllBtn.title = 'Snap every model color to its nearest filament-palette color.';
  matchAllBtn.addEventListener('click', matchAllToPalette);
  content.appendChild(matchAllBtn);

  emptyEl = document.createElement('p');
  emptyEl.className = 'hidden text-xs text-zinc-500 italic';
  emptyEl.textContent = 'This model has no colors yet — paint some, or color it in code, then reopen.';
  content.appendChild(emptyEl);

  listEl = document.createElement('div');
  listEl.className = 'flex flex-col gap-2';
  content.appendChild(listEl);

  const footer = document.createElement('div');
  footer.className = 'flex items-center justify-end gap-2 px-3 py-2 border-t border-zinc-700/60 shrink-0';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-2.5 py-1 rounded text-[11px] text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => closePanel(true));
  const applyBtn = document.createElement('button');
  applyBtn.id = 'colors-apply';
  applyBtn.className = 'px-3 py-1 rounded text-[11px] font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white';
  applyBtn.textContent = 'Apply';
  applyBtn.title = 'Bake the recolor into color regions (persists + exports).';
  applyBtn.addEventListener('click', apply);
  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);
  panel.appendChild(footer);

  container.parentElement?.appendChild(panel);

  // Re-render targets if the palette changes while the panel is open (so a new
  // filament shows up in the per-row pickers).
  onPaletteChange(() => { if (open) render(); });
}

/** Build the composited color buffer + its `_painted` sidecar for the mesh. */
function bakedBuffer(mesh: MeshData): { buf: Uint8Array; painted: Uint8Array | undefined } | null {
  const buf = buildTriColors(mesh.numTri, false);
  if (!buf) return null;
  const painted = (buf as Uint8Array & { _painted?: Uint8Array })._painted;
  return { buf, painted };
}

function recompute(): void {
  sources = [];
  const mesh = hooks?.getMesh();
  if (!mesh) return;
  const baked = bakedBuffer(mesh);
  if (!baked) return;
  const palette = loadPalette().colors;
  const byHex = new Map<string, SourceColor>();
  for (let t = 0; t < mesh.numTri; t++) {
    const hex = triColorHex(baked.buf, t);
    // Skip unpainted faces. (triColorHex returns this same sentinel for a region
    // painted the exact default blue #4a9eff, so such a region is left untouched
    // by the remap — an acceptable corner, and it isn't one of the palette colors.)
    if (hex === DEFAULT_COLOR_HEX) continue;
    let s = byHex.get(hex);
    if (!s) {
      const rgb = hexToRgb(hex) ?? [0, 0, 0];
      const near = nearestPaletteColor(rgb, palette);
      s = {
        hex,
        triangles: [],
        target: near ? near.hex : hex, // auto-match, or keep when no palette
      };
      byHex.set(hex, s);
    }
    s.triangles.push(t);
  }
  // Largest swatches first — the dominant colors are what the user cares about.
  sources = [...byHex.values()].sort((a, b) => b.triangles.length - a.triangles.length);
}

function swatchEl(hex: string, size = 'w-5 h-5'): HTMLElement {
  const s = document.createElement('span');
  s.className = `${size} rounded border border-zinc-600 shrink-0 inline-block`;
  s.style.backgroundColor = cssOf(hex);
  return s;
}

function render(): void {
  if (!listEl || !emptyEl) return;
  const applyBtn = panel?.querySelector('#colors-apply') as HTMLButtonElement | null;
  listEl.replaceChildren();
  if (sources.length === 0) {
    emptyEl.classList.remove('hidden');
    if (applyBtn) applyBtn.disabled = true;
    return;
  }
  emptyEl.classList.add('hidden');
  if (applyBtn) applyBtn.disabled = false;

  const palette = loadPalette().colors;
  for (const src of sources) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';

    row.appendChild(swatchEl(src.hex));
    const count = document.createElement('span');
    count.className = 'text-[10px] text-zinc-500 w-12 shrink-0 tabular-nums';
    count.textContent = `${src.triangles.length}▲`;
    count.title = `${src.triangles.length} triangles`;
    row.appendChild(count);

    const arrow = document.createElement('span');
    arrow.className = 'text-zinc-600 text-xs shrink-0';
    arrow.textContent = '→';
    row.appendChild(arrow);

    const targetSwatch = swatchEl(src.target);
    row.appendChild(targetSwatch);

    const select = document.createElement('select');
    select.className = 'flex-1 min-w-0 px-1 py-0.5 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-[11px] focus:border-blue-500 outline-none';
    const keepOpt = new Option('Keep original', '__keep__');
    select.appendChild(keepOpt);
    for (const c of palette) {
      select.appendChild(new Option(c.name ? `${c.name} — ${c.hex}` : c.hex, c.hex));
    }
    select.appendChild(new Option('Custom…', '__custom__'));

    // Freehand color input — revealed only when "Custom…" is chosen.
    const custom = document.createElement('input');
    custom.type = 'color';
    custom.className = 'hidden w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0';
    custom.value = src.target;

    // Pick the option that matches the current target.
    if (src.target === src.hex) select.value = '__keep__';
    else if (palette.some(c => c.hex === src.target)) select.value = src.target;
    else { select.value = '__custom__'; custom.classList.remove('hidden'); custom.value = src.target; }

    select.addEventListener('change', () => {
      if (select.value === '__keep__') { src.target = src.hex; custom.classList.add('hidden'); }
      else if (select.value === '__custom__') { custom.classList.remove('hidden'); src.target = custom.value; }
      else { src.target = select.value; custom.classList.add('hidden'); }
      targetSwatch.style.backgroundColor = cssOf(src.target);
      pushPreview();
    });
    custom.addEventListener('input', () => {
      src.target = custom.value;
      targetSwatch.style.backgroundColor = cssOf(src.target);
      pushPreview();
    });

    row.appendChild(select);
    row.appendChild(custom);
    listEl.appendChild(row);
  }
}

/** Recolor the baked buffer by the current source→target mapping, preserving
 *  the `_painted` sidecar (the set of painted triangles is unchanged). */
function buildPreviewBuffer(): Uint8Array | null {
  const mesh = hooks?.getMesh();
  if (!mesh) return null;
  const baked = bakedBuffer(mesh);
  if (!baked) return null;
  const out = new Uint8Array(baked.buf);
  for (const src of sources) {
    if (src.target === src.hex) continue;
    const rgb = hexToRgb(src.target);
    if (!rgb) continue;
    const r = Math.round(rgb[0] * 255), g = Math.round(rgb[1] * 255), b = Math.round(rgb[2] * 255);
    for (const t of src.triangles) { out[t * 3] = r; out[t * 3 + 1] = g; out[t * 3 + 2] = b; }
  }
  (out as Uint8Array & { _painted?: Uint8Array })._painted = baked.painted;
  return out;
}

function pushPreview(): void {
  hooks?.preview(buildPreviewBuffer());
}

function matchAllToPalette(): void {
  const palette = loadPalette().colors;
  if (palette.length === 0) return;
  for (const src of sources) {
    const rgb = hexToRgb(src.hex) ?? [0, 0, 0];
    const near = nearestPaletteColor(rgb, palette);
    if (near) src.target = near.hex;
  }
  render();
  pushPreview();
}

function apply(): void {
  if (sources.length === 0) { closePanel(true); return; }
  const palette = loadPalette().colors;
  const nameForHex = (hex: string): string => palette.find(c => c.hex === hex)?.name || hex;

  // Group triangles by their TARGET color so multiple source colors mapped to
  // the same palette entry consolidate into one region (the "reduce" case).
  const byTarget = new Map<string, number[]>();
  for (const src of sources) {
    const ids = byTarget.get(src.target) ?? [];
    for (const t of src.triangles) ids.push(t);
    byTarget.set(src.target, ids);
  }

  // Replace existing user regions with the consolidated palette set — the new
  // regions cover every previously-colored triangle, so the result is exactly
  // what the preview showed, persisted + exportable.
  clearRegions();
  for (const [hex, ids] of byTarget) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    addRegion(`Palette: ${nameForHex(hex)}`, rgb, 'subtree', { kind: 'triangles', ids: [...ids] }, new Set(ids));
  }
  // Region creation fires the host's color-change listener, which repaints the
  // viewport with the real region colors (superseding the temp preview).
  hooks?.onApplied?.();
  closePanel(false);
}

function openPanel(): void {
  if (!panel || !toggleBtn) return;
  hooks?.onOpen?.();
  recompute();
  render();
  pushPreview();
  panel.classList.remove('hidden');
  toggleBtn.classList.add('text-zinc-100', 'bg-zinc-700/80', 'border-zinc-500');
  open = true;
}

function closePanel(restore: boolean): void {
  if (!panel || !toggleBtn) return;
  panel.classList.add('hidden');
  toggleBtn.classList.remove('text-zinc-100', 'bg-zinc-700/80', 'border-zinc-500');
  open = false;
  if (restore) hooks?.preview(null); // revert the live preview to real colors
}

/** Host calls this to force the panel shut (e.g. when paint mode opens). */
export function forceCloseColorRemap(): void {
  if (open) closePanel(true);
}

export function isColorRemapOpen(): boolean {
  return open;
}
