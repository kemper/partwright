// Standalone palette manager — the central place to edit filament slots,
// opened from the viewport (and from the paint panel's "Manage…" link). Edits
// here flow everywhere the shared palette is read: the paint panel's swatches
// and over-budget badge (they subscribe to `onPaletteChange`) and the Relief
// Studio. Kept separate from the paint panel so the palette can be curated
// without entering paint mode.

import { createToolPanelShell } from '../ui/toolPanel';
import { BUTTON_PRIMARY } from '../ui/styleConstants';
import { showToast } from '../ui/toast';
import { promptDialog, confirmDialog } from '../ui/dialogs';
import {
  listPalettes,
  setActivePalette,
  createPalette,
  renamePalette,
  deletePalette,
  getActivePaletteId,
  getActivePaletteName,
  DEFAULT_FILAMENTS,
  listFilaments,
  addFilament,
  updateFilament,
  removeFilament,
  reorderFilaments,
  resetPalette,
  getPaletteCapacity,
  setPaletteCapacity,
  isPaletteConstrained,
  setPaletteConstrained,
  getColorHistory,
  recordColor,
  removeColorHistory,
  hexToRgb,
  rgbToHex,
  type Filament,
} from './palette';
import {
  recolorRegionsForSlot,
  getDistinctRegionColors,
  reassignRegionColor,
  applyPaletteAutoMatch,
} from './regions';
import { getSlotId, setSlot } from './paintMode';
import { openPhotoColorPicker } from './photoColorPicker';

let open = false;

/** Open the palette manager — a docked, draggable tool panel (like Paint).
 *  Idempotent — a second call is a no-op while one is showing. */
export function openPaletteManager(): void {
  if (open) return;
  open = true;
  const shell = createToolPanelShell({
    title: '🎨 Filament palette',
    width: 'w-[22rem]',
    onClose: () => { open = false; },
  });

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-snug';
  intro.textContent = 'Each slot maps to a filament on your printer. Painting with a slot lets a multi-colour model load straight into your slicer. Edits here update the paint swatches and the relief tools.';
  shell.body.appendChild(intro);

  // Collections: switch the active palette, or save the current one under a new
  // name. The active palette is the one used everywhere (paint, relief, export).
  const palRow = document.createElement('div');
  palRow.className = 'flex items-center gap-1.5 mt-2 flex-wrap';
  const palSelect = document.createElement('select');
  palSelect.className = 'flex-1 min-w-0 px-2 py-1 rounded text-xs bg-zinc-900/60 text-zinc-200 border border-zinc-700';
  palSelect.title = 'Active palette';
  palSelect.addEventListener('change', () => { setActivePalette(palSelect.value); refreshAll(); });
  const saveAsBtn = document.createElement('button');
  saveAsBtn.className = 'shrink-0 px-2 py-1 rounded text-[10px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
  saveAsBtn.textContent = 'Save as…';
  saveAsBtn.title = 'Save the current slots as a new named palette';
  saveAsBtn.addEventListener('click', async () => {
    const name = await promptDialog('Name this palette', { initialValue: `${getActivePaletteName()} copy`, confirmLabel: 'Save' });
    if (name) { createPalette(name); refreshAll(); }
  });
  const newBtn = document.createElement('button');
  newBtn.className = saveAsBtn.className;
  newBtn.textContent = 'New';
  newBtn.title = 'Create a new palette from the built-in defaults';
  newBtn.addEventListener('click', async () => {
    const name = await promptDialog('Name the new palette', { initialValue: 'Palette', confirmLabel: 'Create' });
    if (name) { createPalette(name, DEFAULT_FILAMENTS.map(f => ({ ...f }))); refreshAll(); }
  });
  const renameBtn = document.createElement('button');
  renameBtn.className = saveAsBtn.className;
  renameBtn.textContent = 'Rename';
  renameBtn.addEventListener('click', async () => {
    const name = await promptDialog('Rename palette', { initialValue: getActivePaletteName(), confirmLabel: 'Rename' });
    if (name) { renamePalette(getActivePaletteId(), name); refreshAll(); }
  });
  const delPalBtn = document.createElement('button');
  delPalBtn.className = 'shrink-0 px-2 py-1 rounded text-[10px] text-zinc-400 hover:text-red-300 hover:bg-zinc-700/60 transition-colors disabled:opacity-30 disabled:cursor-default';
  delPalBtn.textContent = 'Delete';
  delPalBtn.addEventListener('click', async () => {
    // Deleting the active palette hands control to the top palette in the list.
    const activeId = getActivePaletteId();
    const nextActive = listPalettes().find(p => p.id !== activeId);
    const detail = nextActive
      ? ` "${nextActive.name}" (the top palette) will become the active palette. Painted models keep their colours — any that no longer match a slot show as off-palette and can be reconciled.`
      : '';
    if (await confirmDialog(`Delete the palette "${getActivePaletteName()}"?${detail}`, { confirmLabel: 'Delete', danger: true })) {
      deletePalette(activeId);
      refreshAll();
    }
  });
  palRow.append(palSelect, saveAsBtn, newBtn, renameBtn, delPalBtn);
  shell.body.appendChild(palRow);

  function renderCollections(): void {
    const pals = listPalettes();
    palSelect.replaceChildren();
    for (const p of pals) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      opt.selected = p.active;
      palSelect.appendChild(opt);
    }
    delPalBtn.disabled = pals.length <= 1;
  }

  // "Colours in this model" — reconciliation. Shows the distinct colours the
  // current model actually paints with, tagged in/off-palette, with per-colour
  // Replace (swap to a palette/recent colour) and Merge (collapse into another
  // model colour), plus a one-click Apply-palette auto-match. Only shown when
  // the model has painted regions.
  const modelWrap = document.createElement('div');
  modelWrap.className = 'hidden flex-col gap-1.5 mt-2 p-2 rounded border border-zinc-700/70 bg-zinc-900/30';
  shell.body.appendChild(modelWrap);

  const rows = document.createElement('div');
  rows.className = 'flex flex-col gap-1.5 mt-1';
  shell.body.appendChild(rows);

  function buildRow(slot: Filament, index: number, count: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = slot.hex;
    color.className = 'w-7 h-7 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0';
    color.title = 'Slot colour';
    color.addEventListener('input', () => {
      updateFilament(slot.id, { hex: color.value });
      recolorRegionsForSlot(slot.id, hexToRgb(color.value));
      // Keep the active paint colour in sync if this slot is selected.
      if (getSlotId() === slot.id) setSlot(slot.id);
    });
    // Commit (blur / picker-close) records the colour into history.
    color.addEventListener('change', () => { recordColor(color.value); renderHistory(); });

    const slotNo = document.createElement('span');
    slotNo.className = 'text-[10px] text-zinc-500 tabular-nums w-4 text-right shrink-0';
    slotNo.textContent = String(index + 1);

    const name = document.createElement('input');
    name.type = 'text';
    name.value = slot.name;
    name.className = 'flex-1 min-w-0 px-2 py-1 rounded text-xs bg-zinc-900/60 text-zinc-200 border border-zinc-700';
    name.addEventListener('change', () => updateFilament(slot.id, { name: name.value }));

    const up = document.createElement('button');
    up.className = 'shrink-0 w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 disabled:opacity-30 disabled:cursor-default transition-colors';
    up.textContent = '↑';
    up.title = 'Move up (earlier slot)';
    up.disabled = index === 0;
    up.addEventListener('click', () => { move(index, index - 1); });

    const down = document.createElement('button');
    down.className = up.className;
    down.textContent = '↓';
    down.title = 'Move down (later slot)';
    down.disabled = index === count - 1;
    down.addEventListener('click', () => { move(index, index + 1); });

    const del = document.createElement('button');
    del.className = 'shrink-0 w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-red-300 hover:bg-zinc-700/60 transition-colors';
    del.textContent = '×';
    del.title = 'Remove this slot';
    del.addEventListener('click', () => { removeFilament(slot.id); render(); });

    row.append(color, slotNo, name, up, down, del);
    return row;
  }

  function move(from: number, to: number): void {
    const ids = listFilaments().map(s => s.id);
    if (to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorderFilaments(ids);
    render();
  }

  function render(): void {
    rows.replaceChildren();
    const slots = listFilaments();
    slots.forEach((slot, i) => rows.appendChild(buildRow(slot, i, slots.length)));
    capCount.textContent = `${slots.length} slot${slots.length === 1 ? '' : 's'} defined`;
  }

  // Add / import / reset row.
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2 mt-2 flex-wrap';
  const addBtn = document.createElement('button');
  addBtn.className = 'px-2.5 py-1 rounded text-xs bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
  addBtn.textContent = '+ Add slot';
  addBtn.addEventListener('click', () => { addFilament({ name: 'New', hex: '#cccccc', td: 1 }); render(); });
  const importBtn = document.createElement('button');
  importBtn.className = 'px-2.5 py-1 rounded text-xs bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
  importBtn.textContent = '🖼️ Import from photo…';
  importBtn.addEventListener('click', () => {
    // Close this panel while the centered photo picker is up (so the two don't
    // stack); the picker's onClose reopens the manager with the imported slots.
    shell.close();
    openPhotoColorPicker(
      (hexes) => {
        for (const hex of hexes) {
          addFilament({ name: hex, hex, td: 1 });
          recordColor(hex);
        }
      },
      () => openPaletteManager(),
    );
  });
  const resetBtn = document.createElement('button');
  resetBtn.className = 'px-2.5 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors';
  resetBtn.textContent = 'Reset to defaults';
  resetBtn.addEventListener('click', () => { resetPalette(); render(); });
  const capCount = document.createElement('span');
  capCount.className = 'ml-auto text-[10px] text-zinc-500';
  actions.append(addBtn, importBtn, resetBtn, capCount);
  shell.body.appendChild(actions);

  // Recent-colour history — re-add an old colour as a slot, or delete entries.
  const historyWrap = document.createElement('div');
  historyWrap.className = 'hidden flex-col gap-1.5 mt-3 pt-3 border-t border-zinc-700/70';
  const historyHead = document.createElement('div');
  historyHead.className = 'text-[10px] text-zinc-500 uppercase tracking-wider font-medium';
  historyHead.textContent = 'Recent colours';
  const historyGrid = document.createElement('div');
  historyGrid.className = 'grid grid-cols-8 gap-1.5';
  historyWrap.append(historyHead, historyGrid);
  shell.body.appendChild(historyWrap);

  function renderHistory(): void {
    const hist = getColorHistory();
    historyWrap.classList.toggle('hidden', hist.length === 0);
    historyWrap.classList.toggle('flex', hist.length > 0);
    historyGrid.replaceChildren();
    for (const hex of hist) {
      const cell = document.createElement('div');
      cell.className = 'relative w-8 h-8';
      const sw = document.createElement('button');
      sw.className = 'w-full h-full rounded border border-zinc-600/60 hover:border-white/70 transition-colors';
      sw.style.backgroundColor = hex;
      sw.title = `Add ${hex} as a slot`;
      sw.addEventListener('click', () => { addFilament({ name: hex, hex, td: 1 }); recordColor(hex); render(); });
      const del = document.createElement('button');
      del.className = 'absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-zinc-900/90 border border-zinc-600 text-zinc-300 text-[9px] leading-none flex items-center justify-center hover:text-red-300';
      del.textContent = '×';
      del.title = `Remove ${hex} from history`;
      del.addEventListener('click', (e) => { e.stopPropagation(); removeColorHistory(hex); renderHistory(); });
      cell.append(sw, del);
      historyGrid.appendChild(cell);
    }
  }

  // Capacity.
  const capRow = document.createElement('div');
  capRow.className = 'flex items-center gap-2 mt-3 pt-3 border-t border-zinc-700/70';
  const capLabel = document.createElement('label');
  capLabel.className = 'text-xs text-zinc-300 flex-1';
  capLabel.textContent = 'Printer filament slots';
  const capHint = document.createElement('span');
  capHint.className = 'text-[10px] text-zinc-500 block';
  capHint.textContent = 'e.g. 4 for one Bambu AMS — over-budget paints warn, never block';
  capLabel.appendChild(capHint);
  const capInput = document.createElement('input');
  capInput.type = 'number';
  capInput.min = '1';
  capInput.max = '64';
  capInput.value = String(getPaletteCapacity());
  capInput.className = 'w-16 px-2 py-1 rounded text-xs bg-zinc-900/60 text-zinc-200 border border-zinc-700 shrink-0';
  capInput.addEventListener('change', () => {
    const n = parseInt(capInput.value, 10);
    if (Number.isFinite(n) && n > 0) setPaletteCapacity(n);
  });
  capRow.append(capLabel, capInput);
  shell.body.appendChild(capRow);

  // Constrain toggle.
  const constrainRow = document.createElement('label');
  constrainRow.className = 'flex items-center gap-2 mt-2 text-xs text-zinc-300 cursor-pointer';
  const constrainBox = document.createElement('input');
  constrainBox.type = 'checkbox';
  constrainBox.checked = isPaletteConstrained();
  constrainBox.className = 'accent-blue-500';
  constrainBox.addEventListener('change', () => setPaletteConstrained(constrainBox.checked));
  const constrainText = document.createElement('span');
  constrainText.textContent = 'Constrain painting to the palette (snap colours to the nearest slot)';
  constrainRow.append(constrainBox, constrainText);
  shell.body.appendChild(constrainRow);

  // ── Model-colour reconciliation ────────────────────────────────────────────

  /** The palette slot whose colour exactly matches `rgb`, if any. */
  function slotForColor(rgb: [number, number, number]): Filament | undefined {
    const hex = rgbToHex(rgb).toLowerCase();
    return listFilaments().find(s => s.hex.toLowerCase() === hex);
  }

  /** A small swatch button used in the Replace/Merge target picker. */
  function targetSwatch(rgb: [number, number, number], title: string, onPick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.className = 'w-6 h-6 rounded border border-zinc-600/60 hover:border-white/70 transition-colors';
    b.style.backgroundColor = rgbToHex(rgb);
    b.title = title;
    b.addEventListener('click', onPick);
    return b;
  }

  function buildModelColorRow(rgb: [number, number, number], allUsed: [number, number, number][]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1';

    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const sw = document.createElement('span');
    sw.className = 'w-6 h-6 rounded border border-zinc-600/60 shrink-0';
    sw.style.backgroundColor = rgbToHex(rgb);
    const label = document.createElement('span');
    label.className = 'text-[11px] flex-1 min-w-0 truncate';
    const slot = slotForColor(rgb);
    if (slot) {
      label.innerHTML = `<span class="font-mono text-zinc-400">${rgbToHex(rgb)}</span> <span class="text-emerald-400">✓ ${slot.name}</span>`;
    } else {
      label.innerHTML = `<span class="font-mono text-zinc-300">${rgbToHex(rgb)}</span> <span class="text-amber-400">off-palette</span>`;
    }

    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'shrink-0 px-2 py-0.5 rounded text-[10px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
    replaceBtn.textContent = 'Replace…';
    replaceBtn.title = 'Swap this colour for a palette/recent colour, or merge it into another model colour';

    const addBtn = document.createElement('button');
    addBtn.className = 'shrink-0 px-2 py-0.5 rounded text-[10px] bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
    addBtn.textContent = '+ Slot';
    addBtn.title = 'Add this colour to the palette and attribute these regions to it';
    addBtn.addEventListener('click', () => {
      const hex = rgbToHex(rgb);
      const f = addFilament({ name: hex, hex, td: 1 });
      recordColor(hex);
      reassignRegionColor(rgb, rgb, f.id); // attribute the regions to the new slot
      refreshAll();
    });

    row.append(sw, label);
    if (!slot) row.append(addBtn);
    row.append(replaceBtn);
    wrap.append(row);

    // Inline target picker, toggled by Replace.
    const picker = document.createElement('div');
    picker.className = 'hidden flex-wrap items-center gap-1 pl-8';
    replaceBtn.addEventListener('click', () => {
      picker.classList.toggle('hidden');
      picker.classList.toggle('flex');
      if (!picker.classList.contains('hidden')) buildPicker();
    });

    function buildPicker(): void {
      picker.replaceChildren();
      const tag = (t: string) => {
        const s = document.createElement('span');
        s.className = 'text-[9px] text-zinc-500 uppercase tracking-wider w-full';
        s.textContent = t;
        return s;
      };
      // Palette slots.
      const slots = listFilaments();
      if (slots.length) {
        picker.append(tag('Palette'));
        for (const s of slots) {
          picker.append(targetSwatch(hexToRgb(s.hex), `→ ${s.name}`, () => {
            reassignRegionColor(rgb, hexToRgb(s.hex), s.id);
            refreshAll();
          }));
        }
      }
      // Recent colours.
      const hist = getColorHistory();
      if (hist.length) {
        picker.append(tag('Recent'));
        for (const h of hist) {
          const hr = hexToRgb(h);
          picker.append(targetSwatch(hr, `→ ${h}`, () => {
            reassignRegionColor(rgb, hr, slotForColor(hr)?.id);
            refreshAll();
          }));
        }
      }
      // Other model colours → merge.
      const others = allUsed.filter(c => rgbToHex(c) !== rgbToHex(rgb));
      if (others.length) {
        picker.append(tag('Merge into'));
        for (const c of others) {
          picker.append(targetSwatch(c, `Merge into ${rgbToHex(c)}`, () => {
            reassignRegionColor(rgb, c, slotForColor(c)?.id);
            refreshAll();
          }));
        }
      }
    }

    wrap.append(picker);
    return wrap;
  }

  function renderModelColors(): void {
    modelWrap.replaceChildren();
    const used = getDistinctRegionColors();
    modelWrap.classList.toggle('hidden', used.length === 0);
    modelWrap.classList.toggle('flex', used.length > 0);
    if (used.length === 0) return;

    const head = document.createElement('div');
    head.className = 'flex items-center justify-between gap-2';
    const title = document.createElement('div');
    title.className = 'text-[10px] text-zinc-400 uppercase tracking-wider font-medium';
    const off = used.filter(c => !slotForColor(c)).length;
    title.textContent = off > 0 ? `Colours in this model · ${off} off-palette` : 'Colours in this model';
    const apply = document.createElement('button');
    apply.className = 'shrink-0 px-2 py-0.5 rounded text-[10px] bg-blue-600/80 text-white hover:bg-blue-500 transition-colors';
    apply.textContent = 'Apply palette';
    apply.title = 'Snap every colour to the nearest palette slot';
    apply.addEventListener('click', () => {
      const n = applyPaletteAutoMatch(listFilaments().map(s => ({ id: s.id, color: hexToRgb(s.hex) })));
      showToast(n > 0 ? `Matched ${n} region${n === 1 ? '' : 's'} to the palette` : 'Already matched the palette', { variant: n > 0 ? 'success' : 'neutral' });
      refreshAll();
    });
    head.append(title, apply);
    modelWrap.append(head);

    for (const rgb of used) modelWrap.append(buildModelColorRow(rgb, used));
  }

  /** Re-render every section after a reconciliation edit (slot list may gain a
   *  slot, swatches/history may change, model colours re-tag). */
  function refreshAll(): void {
    renderCollections();
    render();
    renderHistory();
    renderModelColors();
  }

  // Footer: a single Done button.
  const done = document.createElement('button');
  done.className = BUTTON_PRIMARY;
  done.textContent = 'Done';
  done.addEventListener('click', () => shell.close());
  shell.footer.appendChild(done);

  renderCollections();
  render();
  renderHistory();
  renderModelColors();
}
