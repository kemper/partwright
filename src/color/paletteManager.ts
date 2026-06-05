// Standalone palette manager — the central place to edit filament slots,
// opened from the viewport (and from the paint panel's "Manage…" link). Edits
// here flow everywhere the shared palette is read: the paint panel's swatches
// and over-budget badge (they subscribe to `onPaletteChange`) and the Relief
// Studio. Kept separate from the paint panel so the palette can be curated
// without entering paint mode.

import { createModalShell } from '../ui/modalShell';
import { BUTTON_PRIMARY } from '../ui/styleConstants';
import {
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
  hexToRgb,
  type Filament,
} from './palette';
import { recolorRegionsForSlot } from './regions';
import { getSlotId, setSlot } from './paintMode';

let open = false;

/** Open the palette manager modal. Idempotent — a second call is a no-op while
 *  one is showing. */
export function openPaletteManager(): void {
  if (open) return;
  open = true;
  const shell = createModalShell({
    title: '🎨 Filament palette',
    maxWidth: 'sm',
    scrollable: true,
    onClose: () => { open = false; },
  });

  const intro = document.createElement('p');
  intro.className = 'text-xs text-zinc-400 leading-snug';
  intro.textContent = 'Each slot maps to a filament on your printer. Painting with a slot lets a multi-colour model load straight into your slicer. Edits here update the paint swatches and the relief tools.';
  shell.body.appendChild(intro);

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

  // Add / reset row.
  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2 mt-2';
  const addBtn = document.createElement('button');
  addBtn.className = 'px-2.5 py-1 rounded text-xs bg-zinc-700/60 text-zinc-200 hover:bg-zinc-600/60 transition-colors';
  addBtn.textContent = '+ Add slot';
  addBtn.addEventListener('click', () => { addFilament({ name: 'New', hex: '#cccccc', td: 1 }); render(); });
  const resetBtn = document.createElement('button');
  resetBtn.className = 'px-2.5 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors';
  resetBtn.textContent = 'Reset to defaults';
  resetBtn.addEventListener('click', () => { resetPalette(); render(); });
  const capCount = document.createElement('span');
  capCount.className = 'ml-auto text-[10px] text-zinc-500';
  actions.append(addBtn, resetBtn, capCount);
  shell.body.appendChild(actions);

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
  constrainText.textContent = 'Constrain painting to the palette (hide the custom colour picker)';
  constrainRow.append(constrainBox, constrainText);
  shell.body.appendChild(constrainRow);

  // Footer: a single Done button.
  const done = document.createElement('button');
  done.className = BUTTON_PRIMARY;
  done.textContent = 'Done';
  done.addEventListener('click', () => shell.close());
  shell.footer.appendChild(done);

  render();
}
