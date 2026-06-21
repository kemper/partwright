// Shared palette colour picker — the modal that replaces the native OS
// `<input type="color">` across the app. It shows the active filament palette
// and the recent-colour history as one-click swatches, plus a freeform picker
// for any colour. A freeform pick is remembered in "Recent" (`recordColor`) so
// it's one click away next time, but it does NOT become a permanent filament
// slot — slots map to real filaments, so promotion to a slot stays an explicit
// action in the palette manager.
//
// It is built as its own stacked overlay rather than via `createModalShell`,
// because it is frequently opened from *inside* another modal/panel (surface,
// params, image-import, the paint panel) and the singleton modalShell would
// force-close that parent. It sits at z-[60] so it floats above modalShell
// (z-50) and the viewport tool panels.

import {
  getActivePalette,
  getColorHistory,
  recordColor,
  onPaletteChange,
} from '../color/palette';

export interface ColorPickerOptions {
  /** Colour shown as selected when the picker opens (`#rrggbb`). */
  initialHex: string;
  /** Modal heading. Defaults to "Pick a colour". */
  title?: string;
  /** Called once with the committed `#rrggbb` when the user chooses a colour. */
  onPick: (hex: string) => void;
  /** Called when the picker closes for any reason (after `onPick` on commit,
   *  or on cancel). */
  onClose?: () => void;
}

function normalizeHex(hex: string): string {
  const h = hex.trim().toLowerCase();
  const m = /^#?([0-9a-f]{6})$/.exec(h);
  if (m) return `#${m[1]}`;
  const short = /^#?([0-9a-f]{3})$/.exec(h);
  if (short) {
    const [r, g, b] = short[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#000000';
}

let openOverlay: HTMLElement | null = null;

/** Open the shared palette colour picker. Idempotent per call — opening a new
 *  one closes any picker already showing. */
export function openColorPicker(opts: ColorPickerOptions): void {
  // Capture the trigger BEFORE force-closing any open picker — the old one's
  // close() restores focus to its own origin, which would otherwise overwrite
  // what we read here.
  const previouslyFocused = document.activeElement as HTMLElement | null;

  // Only one picker at a time; closing the old one fires its onClose.
  if (openOverlay) openOverlay.dispatchEvent(new CustomEvent('picker:force-close'));

  let selected = normalizeHex(opts.initialHex);
  let closed = false;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4';
  overlay.dataset.testid = 'color-picker';

  const panel = document.createElement('div');
  panel.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-xs flex flex-col max-h-[calc(100vh-2rem)]';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', opts.title ?? 'Pick a colour');
  panel.tabIndex = -1;

  // Header
  const header = document.createElement('div');
  header.className = 'px-4 py-2.5 border-b border-zinc-700 flex items-center justify-between';
  const titleEl = document.createElement('h2');
  titleEl.className = 'text-sm font-semibold text-zinc-100';
  titleEl.textContent = opts.title ?? 'Pick a colour';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Dismiss');
  closeBtn.title = 'Close';
  header.append(titleEl, closeBtn);
  panel.appendChild(header);

  // Body (scrollable)
  const body = document.createElement('div');
  body.className = 'px-4 py-3 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0';
  panel.appendChild(body);

  // Selected-colour preview row.
  const previewRow = document.createElement('div');
  previewRow.className = 'flex items-center gap-2';
  const previewSwatch = document.createElement('div');
  previewSwatch.className = 'w-8 h-8 rounded-md border border-zinc-600 shrink-0';
  previewSwatch.style.backgroundColor = selected;
  const previewHex = document.createElement('span');
  previewHex.className = 'text-xs font-mono text-zinc-300';
  previewHex.textContent = selected;
  previewRow.append(previewSwatch, previewHex);
  body.appendChild(previewRow);

  function setSelected(hex: string): void {
    selected = normalizeHex(hex);
    previewSwatch.style.backgroundColor = selected;
    previewHex.textContent = selected;
    if (customInput.value.toLowerCase() !== selected) customInput.value = selected;
    if (hexText.value.toLowerCase() !== selected) hexText.value = selected;
  }

  function commit(hex: string, { record }: { record: boolean }): void {
    const norm = normalizeHex(hex);
    if (record) recordColor(norm);
    opts.onPick(norm);
    close();
  }

  // ── Palette swatches ──────────────────────────────────────────────────────
  const paletteLabel = document.createElement('div');
  paletteLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  paletteLabel.textContent = 'Palette';
  const paletteGrid = document.createElement('div');
  paletteGrid.className = 'grid grid-cols-8 gap-1.5';
  body.append(paletteLabel, paletteGrid);

  // ── Recent colours ────────────────────────────────────────────────────────
  const recentLabel = document.createElement('div');
  recentLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  recentLabel.textContent = 'Recent';
  const recentGrid = document.createElement('div');
  recentGrid.className = 'grid grid-cols-8 gap-1.5';
  body.append(recentLabel, recentGrid);

  function swatchButton(hex: string, name: string, record: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'w-7 h-7 rounded border border-zinc-600/60 hover:border-white/70 transition-colors';
    b.style.backgroundColor = hex;
    b.title = name;
    b.dataset.hex = hex.toLowerCase();
    // One click on a known colour commits immediately — that's the fast path.
    b.addEventListener('click', () => commit(hex, { record }));
    return b;
  }

  function renderSwatches(): void {
    paletteGrid.replaceChildren();
    for (const slot of getActivePalette().slots) {
      paletteGrid.appendChild(swatchButton(slot.hex, `${slot.name} (${slot.hex})`, false));
    }
    const hist = getColorHistory();
    recentLabel.classList.toggle('hidden', hist.length === 0);
    recentGrid.classList.toggle('hidden', hist.length === 0);
    recentGrid.replaceChildren();
    for (const hex of hist) recentGrid.appendChild(swatchButton(hex, hex, false));
  }

  // ── Custom / freeform picker ──────────────────────────────────────────────
  const customLabel = document.createElement('div');
  customLabel.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  customLabel.textContent = 'Custom';
  const customRow = document.createElement('div');
  customRow.className = 'flex items-center gap-2';
  const customInput = document.createElement('input');
  customInput.type = 'color';
  customInput.value = selected;
  customInput.className = 'w-9 h-9 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0';
  customInput.title = 'Pick any colour';
  customInput.dataset.action = 'custom-color';
  customInput.addEventListener('input', () => setSelected(customInput.value));
  const hexText = document.createElement('input');
  hexText.type = 'text';
  hexText.value = selected;
  hexText.spellcheck = false;
  hexText.className = 'flex-1 min-w-0 px-2 py-1 rounded text-xs font-mono bg-zinc-900/60 text-zinc-200 border border-zinc-700 uppercase';
  hexText.setAttribute('aria-label', 'Hex colour');
  hexText.addEventListener('input', () => {
    if (/^#?[0-9a-fA-F]{6}$/.test(hexText.value.trim())) setSelected(hexText.value);
  });
  hexText.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(selected, { record: true }); });
  customRow.append(customInput, hexText);
  body.append(customLabel, customRow);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'px-4 py-2.5 border-t border-zinc-700 flex items-center justify-end gap-2';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => close());
  const applyBtn = document.createElement('button');
  applyBtn.className = 'px-3 py-1.5 rounded text-xs bg-blue-600/80 text-white hover:bg-blue-500 transition-colors';
  applyBtn.textContent = 'Apply';
  applyBtn.title = 'Use the custom colour (also saved to Recent)';
  // Apply commits the freeform selection and records it to history. Palette /
  // recent swatch clicks commit on their own (already-known colours).
  applyBtn.addEventListener('click', () => commit(selected, { record: true }));
  footer.append(cancelBtn, applyBtn);
  panel.appendChild(footer);

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  openOverlay = overlay;

  const offPalette = onPaletteChange(renderSwatches);
  renderSwatches();

  const escHandler = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', escHandler, true);

  // Keep Tab focus inside the picker while it's open — it's a hand-rolled
  // overlay (not modalShell), so it must provide its own focus trap.
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  panel.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const f = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (f.length === 0) { e.preventDefault(); return; }
    const first = f[0];
    const last = f[f.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? f.indexOf(active) : -1;
    if (e.shiftKey && (active === first || idx === -1)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || idx === -1)) { e.preventDefault(); first.focus(); }
  });
  overlay.addEventListener('picker:force-close', () => close());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  closeBtn.addEventListener('click', () => close());

  requestAnimationFrame(() => { if (!closed) hexText.focus(); });

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler, true);
    offPalette();
    overlay.remove();
    if (openOverlay === overlay) openOverlay = null;
    if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    opts.onClose?.();
  }
}

export interface ColorSwatchOptions {
  /** Initial colour shown on the swatch (`#rrggbb`). */
  initialHex: string;
  /** Called with the committed `#rrggbb` when the user picks a colour. */
  onPick: (hex: string) => void;
  /** Swatch button tooltip / accessible name. */
  title?: string;
  /** Modal heading shown when the picker opens. Defaults to `title`. */
  modalTitle?: string;
  /** Override the swatch button classes (omit to use the default swatch look). */
  className?: string;
  /** Optional `data-action` attribute for tests / hooks. */
  dataAction?: string;
}

const DEFAULT_SWATCH_CLASS =
  'w-6 h-6 shrink-0 rounded border border-zinc-500 hover:border-white/70 cursor-pointer transition-colors';

/** Build a swatch button that opens {@link openColorPicker} on click. Returns
 *  the element plus a `setHex` to update its displayed colour from the caller
 *  (e.g. when an external edit changes the bound value). The drop-in replacement
 *  for a native `<input type="color">` styled as a swatch. */
export function createColorSwatch(opts: ColorSwatchOptions): { el: HTMLButtonElement; setHex: (hex: string) => void } {
  let hex = normalizeHex(opts.initialHex);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = opts.className ?? DEFAULT_SWATCH_CLASS;
  el.style.backgroundColor = hex;
  if (opts.title) { el.title = opts.title; el.setAttribute('aria-label', opts.title); }
  if (opts.dataAction) el.dataset.action = opts.dataAction;

  const setHex = (next: string): void => {
    hex = normalizeHex(next);
    el.style.backgroundColor = hex;
  };

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    openColorPicker({
      initialHex: hex,
      title: opts.modalTitle ?? opts.title,
      onPick: (picked) => { setHex(picked); opts.onPick(picked); },
    });
  });

  return { el, setHex };
}
