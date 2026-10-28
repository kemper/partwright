// The Parts panel — a viewport tool panel that acts on the selected parts of
// the open object (or on every part when nothing is selected).
//
// It took over the actions the Objects rail used to show in a drawer under the
// selected row (isolate, rename, colour, go to code, bake, extract / move /
// split, hide, delete, ask the AI), and adds the layout tools: arrange (grid,
// pack, pack onto the printer bed), align / distribute, drop / centre / snap,
// nudge and move, rotate / lay flat / mirror / scale, copies (duplicate,
// arrays), and grouping (group, ungroup, batch rename, cut with a part).
//
// Layout tools write `api.movePart(…)`-style lines into the code — see
// src/editor/partOpCode.ts — through `partwright.partAction`, so the panel is a
// thin view over the same API agents call. It opens on its own when parts get
// selected (unless another tool panel is open, or it was closed for this
// selection), and from the Tools menu / command palette.

import { createColorSwatch } from './colorPickerModal';
import { registerCommands } from './commandPalette';
import { promptDialog } from './dialogs';
import { getExtendTaps, setExtendTaps, type ObjectPartsActions } from './objectPartsPanel';
import { describePartKeys, getSelectedPartKeys, onPartSelectionChange, partSelectionSignature } from './partSelection';
import { BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { createToolPanelShell, type ToolPanelShell } from './toolPanel';
import { registerTool, openTool } from './toolRegistry';
import { getActiveViewportPanel } from './viewportPanelRegistry';

type Vec3 = [number, number, number];

/** What the panel drives. Implemented by main.ts over `partwright.*`. */
export interface PartsPanelApi {
  parts: ObjectPartsActions;
  /** `partwright.partAction(action, opts)`. */
  run(action: string, opts?: Record<string, unknown>): Promise<{ ok: true; message: string } | { error: string }>;
  /** `partwright.undoPartEdit()`. */
  undo(): Promise<{ ok: true; undone: string } | { error: string }>;
  canUndo(): boolean;
  /** Whether layout edits apply (a JavaScript object). */
  canEditParts(): boolean;
  /** Parts made by `api.groupParts` lines (Ungroup applies to these). */
  groups(): Set<string>;
  /** The configured nudge / snap steps (Advanced settings). */
  nudgeStep(): number;
  snapStep(): number;
  /** A free name for a new group ("Group 1", "Group 2"…). */
  suggestGroupName(): string;
}

let api: PartsPanelApi | null = null;
let shell: ToolPanelShell | null = null;
let lastSignature = '';
let busy = false;
/** How many parts were selected when the panel was last closed (-1: not
 *  since the selection last cleared). It pops up again only when a selection
 *  that started below 2 grows to 2+. */
let closedAtCount = -1;
/** Arrow-key nudges that arrived while an edit was running; sent as one move. */
let pendingNudge: Vec3 | null = null;

/** Field values kept across rebuilds (the body redraws on every selection or
 *  mesh change). Empty string = use the default. */
const fields = {
  gap: '',
  nudge: '',
  offset: ['0', '0', '0'],
  scale: '1',
  count: '3',
  cols: '2',
  rows: '2',
};

const ACTION_BTN = 'px-1.5 py-1 min-h-[44px] md:min-h-0 rounded text-[11px] leading-tight text-zinc-300 bg-zinc-800 border border-zinc-700 [@media(hover:hover)]:hover:bg-zinc-700 [@media(hover:hover)]:hover:text-zinc-100 disabled:opacity-40 disabled:pointer-events-none text-left truncate';
const INPUT = 'w-full min-w-0 min-h-[44px] md:min-h-0 px-1.5 py-1 rounded bg-zinc-900 border border-zinc-700 text-[11px] text-zinc-200 tabular-nums focus:outline-none focus:border-blue-500/70';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function fmt(n: number): string {
  const a = Math.abs(n);
  return a >= 100 ? n.toFixed(0) : a >= 10 ? n.toFixed(1) : n.toFixed(2);
}

const num = (s: string, fallback: number): number => {
  const v = Number(s);
  return s.trim() !== '' && Number.isFinite(v) ? v : fallback;
};

/** Whether the Parts panel is open. */
export function isPartsPanelOpen(): boolean {
  return shell !== null;
}

/** Redraw the open panel when what it shows changed (coalesced by the caller —
 *  the Objects rail's refresh). Cheap no-op when closed or unchanged. */
export function refreshPartsPanel(): void {
  if (!shell || !api) return;
  const sig = signature();
  if (sig === lastSignature) return;
  render();
}

function signature(): string {
  const view = api?.parts.getView();
  return JSON.stringify([
    getSelectedPartKeys(), api?.parts.getIsolatedKey(), api?.canUndo(), api?.canEditParts(), busy, getExtendTaps(),
    view?.parts.map(p => [p.name, p.color, p.colorSource, p.hidden]), view?.pieces.map(p => [p.index, p.hidden]), view?.codeActions,
    [...(api?.groups() ?? [])],
  ]);
}

/** Open the panel (or bring it up to date if it is). */
export function openPartsPanel(): void {
  if (!api) return;
  if (shell) { render(); return; }
  const s = createToolPanelShell({
    title: 'Parts',
    width: 'w-[21rem]',
    onClose: () => {
      document.removeEventListener('keydown', onKey, true);
      if (shell === s) shell = null;
      lastSignature = '';
      closedAtCount = getSelectedPartKeys().length;
    },
  });
  shell = s;
  s.panel.id = 'parts-panel';
  document.addEventListener('keydown', onKey, true);
  render();
}

export function closePartsPanel(): void {
  shell?.close();
}

/** Run a part action, report it, and keep the panel's busy state. */
async function act(action: string, opts: Record<string, unknown> = {}): Promise<boolean> {
  if (!api || busy) return false;
  busy = true;
  render();
  try {
    // The selected parts — the API acts on every part unless told otherwise.
    const selected = getSelectedPartKeys().filter(k => k.startsWith('part:')).map(k => k.slice(5));
    const r = await api.run(action, { ...(selected.length > 0 && !opts.parts ? { parts: selected } : {}), ...opts });
    if ('error' in r) { showToast(r.error, { variant: 'warn' }); return false; }
    showToast(r.message, { variant: 'success' });
    return true;
  } finally {
    busy = false;
    render();
    flushNudge();
  }
}

function nudge(d: Vec3): void {
  if (busy) {
    pendingNudge = pendingNudge ? [pendingNudge[0] + d[0], pendingNudge[1] + d[1], pendingNudge[2] + d[2]] : d;
    return;
  }
  void act('move', { offset: d, nudge: true });
}

function flushNudge(): void {
  if (!pendingNudge || busy) return;
  const d = pendingNudge;
  pendingNudge = null;
  void act('move', { offset: d, nudge: true });
}

function nudgeStep(): number {
  return num(fields.nudge, api?.nudgeStep() ?? 1);
}

/** Arrow keys nudge the selected parts while the panel is open (X/Y; PageUp /
 *  PageDown for Z; Shift = ten steps). Skipped while typing or in a dialog. */
function onKey(e: KeyboardEvent): void {
  if (!api || !shell || e.altKey || e.ctrlKey || e.metaKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || t.closest('input, textarea, select, .cm-editor, [aria-modal="true"]'))) return;
  if (getSelectedPartKeys().length === 0 || !getSelectedPartKeys().every(k => k.startsWith('part:')) || !api.canEditParts()) return;
  const s = nudgeStep() * (e.shiftKey ? 10 : 1);
  const d: Record<string, Vec3> = {
    ArrowLeft: [-s, 0, 0], ArrowRight: [s, 0, 0], ArrowUp: [0, s, 0], ArrowDown: [0, -s, 0], PageUp: [0, 0, s], PageDown: [0, 0, -s],
  };
  const delta = d[e.key];
  if (!delta) return;
  e.preventDefault();
  e.stopPropagation();
  nudge(delta);
}

function render(): void {
  if (!shell || !api) return;
  lastSignature = signature();
  const a = api.parts;
  const { body, footer } = shell;
  const focusedField = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('#parts-panel [data-field]')?.dataset.field;
  body.replaceChildren();
  footer.replaceChildren();
  body.className = 'flex-1 min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-2.5 text-[11px] text-zinc-200';

  const view = a.getView();
  const keys = getSelectedPartKeys();
  if (!view) {
    body.appendChild(el('div', 'text-zinc-500 italic', 'Run the code to list this object’s parts.'));
    return;
  }
  const partNames = view.parts.filter(p => p.triangleCount > 0).map(p => p.name);
  const selectedParts = keys.filter(k => k.startsWith('part:')).map(k => k.slice(5));
  const piecesOnly = keys.length > 0 && keys.every(k => k.startsWith('piece:'));
  const partsOnly = keys.every(k => k.startsWith('part:'));
  const targets = keys.length > 0 ? selectedParts : partNames;
  const isolated = a.getIsolatedKey();
  const isIsolated = keys.length > 0 && isolated === (keys.length === 1 ? keys[0] : partSelectionSignature(keys));

  // --- What it acts on ---
  const head = el('div', 'flex items-center gap-1.5');
  const what = el('div', 'flex-1 min-w-0 truncate ' + (keys.length > 0 ? 'text-amber-100' : 'text-zinc-400'));
  what.dataset.partsTarget = '';
  what.textContent = keys.length === 0
    ? (partNames.length > 0 ? `All ${partNames.length} part${partNames.length === 1 ? '' : 's'} — none selected` : 'No named parts')
    : keys.length === 1 ? describePartKeys(keys) : `${keys.length} ${piecesOnly ? 'pieces' : 'parts'} selected`;
  what.title = keys.length > 0 ? describePartKeys(keys) : 'Nothing is selected, so Arrange and the other layout tools act on every part. Click parts in the Objects list (Shift-click for a range), or Shift-drag a box in the viewport.';
  head.appendChild(what);
  const smallBtn = (text: string, title: string, onClick: () => void, action: string) => {
    const b = el('button', 'shrink-0 px-1.5 py-0.5 min-h-[44px] md:min-h-0 rounded text-[10px] text-zinc-400 [@media(hover:hover)]:hover:text-zinc-100 [@media(hover:hover)]:hover:bg-zinc-700', text);
    b.type = 'button';
    b.title = title;
    b.dataset.partAction = action;
    b.addEventListener('click', onClick);
    head.appendChild(b);
  };
  if (partNames.length > 0 && selectedParts.length < partNames.length) smallBtn('All', 'Select every part (⌘/Ctrl-A)', () => a.selectKeys(partNames.map(n => `part:${n}`)), 'select-all');
  if (keys.length > 0) smallBtn('Clear', 'Clear the selection (Esc)', () => a.select(null), 'clear-selection');
  body.appendChild(head);

  const section = (title: string, tip: string) => {
    const s = el('div', 'flex flex-col gap-1');
    const h = el('div', 'text-[10px] font-semibold uppercase tracking-wide text-zinc-500', title);
    h.title = tip;
    s.appendChild(h);
    body.appendChild(s);
    return s;
  };
  const grid = (parent: HTMLElement, cols = 3) => {
    const g = el('div', `grid gap-1 ${cols === 4 ? 'grid-cols-4' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`);
    parent.appendChild(g);
    return g;
  };
  const btn = (parent: HTMLElement, action: string, text: string, title: string, onClick: () => void, opts: { disabled?: boolean; pressed?: boolean } = {}) => {
    const b = el('button', ACTION_BTN + (opts.pressed ? ' !bg-amber-400/20 !text-amber-100 !border-amber-400/40' : ''), text);
    b.type = 'button';
    b.dataset.partAction = action;
    b.title = title;
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
    b.disabled = busy || !!opts.disabled;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    parent.appendChild(b);
    return b;
  };
  const input = (field: string, value: string, placeholder: string, title: string, onInput: (v: string) => void) => {
    const i = el('input', INPUT);
    i.type = 'number';
    i.step = 'any';
    i.value = value;
    i.placeholder = placeholder;
    i.title = title;
    i.setAttribute('aria-label', title);
    i.dataset.field = field;
    i.addEventListener('input', () => onInput(i.value));
    return i;
  };
  const note = (parent: HTMLElement, text: string) => parent.appendChild(el('div', 'text-[10px] text-zinc-500 leading-snug', text));

  // --- Selection: the actions the rail drawer used to hold ---
  const sel = section('Selection', 'Actions on the selected parts or pieces');
  if (keys.length === 0) {
    note(sel, 'Select parts in the Objects list (Shift-click a range, ⌘/Ctrl-click to add one) or Shift-drag a box in the viewport.');
  } else {
    const single = keys.length === 1 ? keys[0] : null;
    const part = single?.startsWith('part:') ? view.parts.find(p => p.name === single.slice(5)) : undefined;
    if (part) {
      const row = el('div', 'flex items-center gap-1.5');
      const swatch = createColorSwatch({
        initialHex: part.color ?? '#71717a',
        title: `Colour the whole "${part.name}" part`,
        modalTitle: `Colour for "${part.name}"`,
        className: 'shrink-0 w-5 h-5 rounded border border-zinc-500 [@media(hover:hover)]:hover:border-white/70 cursor-pointer',
        dataAction: 'set-part-color',
        onPick: (hex) => a.setPartColor(part.name, hex),
      });
      row.appendChild(swatchHit(swatch.el));
      row.appendChild(el('span', 'flex-1 min-w-0 truncate text-zinc-400', part.colorSource === 'painted' ? 'Painted over the code colour' : 'Colour'));
      if (part.colorSource === 'painted') {
        const reset = el('button', 'px-1.5 py-0.5 min-h-[44px] md:min-h-0 rounded text-[10px] text-zinc-300 [@media(hover:hover)]:hover:bg-zinc-700', '↺ Reset');
        reset.type = 'button';
        reset.dataset.partAction = 'reset-color';
        reset.title = `Remove the paint that fills "${part.name}" and go back to the colour the code gives it`;
        reset.addEventListener('click', () => a.resetPartColor(part.name));
        row.appendChild(reset);
      }
      sel.appendChild(row);
    } else if (selectedParts.length > 1 && partsOnly) {
      const row = el('div', 'flex items-center gap-1.5');
      const swatch = createColorSwatch({
        initialHex: '#71717a',
        title: `Colour all ${selectedParts.length} parts`,
        modalTitle: `Colour for ${selectedParts.length} parts`,
        className: 'shrink-0 w-5 h-5 rounded border border-zinc-500 [@media(hover:hover)]:hover:border-white/70 cursor-pointer',
        dataAction: 'set-parts-color',
        onPick: (hex) => { for (const n of selectedParts) a.setPartColor(n, hex); },
      });
      row.appendChild(swatchHit(swatch.el));
      row.appendChild(el('span', 'flex-1 min-w-0 truncate text-zinc-400', 'Colour them all'));
      sel.appendChild(row);
    }
    const g = grid(sel);
    btn(g, 'isolate', isIsolated ? '◑ Show all' : '◐ Isolate', isIsolated ? 'Show the whole object again' : 'Ghost everything else so only the selection is drawn solid', () => a.isolate(isIsolated ? null : keys), { pressed: isIsolated });
    const unlabeled = single === 'unlabeled';
    if (!unlabeled) btn(g, 'hide-selection', '◌ Hide', 'Hide in the viewport (view only — the code and exports keep it). Shift-H shows hidden parts again.', () => a.hideMany(keys));
    const blocked = keys.map(k => a.getDelete(k)).find(d => !d.show || d.reason);
    if (!unlabeled) btn(g, 'delete-selection', '✕ Delete', blocked?.reason ?? 'Delete — adds removal lines to the top of the code (recoverable from Recover deleted)', () => { void (single ? a.deletePart(single) : a.deleteMany(keys)); }, { disabled: !!blocked });
    if (part) {
      btn(g, 'go-to-code', '⌖ Code', `Show where "${part.name}" is labelled in the code`, () => a.goToCode(part.name));
      btn(g, 'rename', '✎ Rename', `Rename "${part.name}" in the code, its paint and its texture scopes`, () => {
        void promptDialog(`Rename part "${part.name}" to:`, { title: 'Rename part', initialValue: part.name, confirmLabel: 'Rename' }).then((next) => {
          const v = next?.trim();
          if (v && v !== part.name) void a.renamePart(part.name, v);
        });
      });
      btn(g, 'bake-color', '⤓ Bake', view.codeActions
        ? `Write "${part.name}"’s current colour into the code (api.paint.label) so it’s part of the model, not an overlay`
        : 'Baking a colour into code needs a JavaScript (manifold-js) object', () => { void a.bakePartColor(part.name); }, { disabled: !view.codeActions || !part.color });
    } else if (selectedParts.length > 1 && partsOnly) {
      btn(g, 'rename', '✎ Rename…', 'Rename the selected parts from a pattern — {n} becomes 1, 2, 3…', () => {
        void promptDialog(`New names for ${selectedParts.length} parts — {n} becomes 1, 2, 3… in list order:`, { title: 'Rename parts', initialValue: `${selectedParts[0].replace(/\s*\d+$/, '')} {n}`, confirmLabel: 'Rename' }).then((pattern) => {
          const v = pattern?.trim();
          if (v) void act('rename', { pattern: v });
        });
      }, { disabled: !api.canEditParts() });
    }
    const noCode = !view.codeActions;
    const why = 'Moving parts to other objects rewrites the code, which needs a JavaScript (manifold-js) object';
    if (single?.startsWith('piece:')) {
      const index = Number(single.slice(6));
      btn(g, 'extract-piece', '⤴ Extract', noCode ? why : 'Move this piece into its own new object (both objects’ code gets a piece filter; version history keeps the original)', () => { void a.extractPiece(index); }, { disabled: noCode || view.pieces.length < 2 });
      btn(g, 'export-piece', '⤓ STL', 'Download just this piece as an STL', () => a.exportPiece(index));
    } else if (part) {
      btn(g, 'extract-part', '⤴ Extract', noCode ? why : `Move "${part.name}" into its own new object (the original's version history keeps the code as it is now)`, () => { void a.moveSelection(keys, false); }, { disabled: noCode || view.parts.length < 2 });
      if (a.canArrange(part.name)) btn(g, 'arrange', '⧉ Gizmo', `Move, resize or align "${part.name}" with handles in arrange mode`, () => a.arrange(part.name));
    } else if (keys.length > 1 && single === null) {
      btn(g, 'move-selection', '⤴ Move', noCode ? why : 'Move these together into one new object', () => { void a.moveSelection(keys, false); }, { disabled: noCode });
      btn(g, 'split-selection', '⫶ Split', noCode ? why : 'Move each of these into its own new object', () => { void a.moveSelection(keys, true); }, { disabled: noCode });
    }
    btn(g, 'edit-with-ai', '✦ Ask AI', 'Ask the AI to change the selection', () => a.editWithAI(keys));
    const add = btn(g, 'select-more', getExtendTaps() ? '☑ Adding' : '☐ Add', 'Click (or tap) other rows to add them to the selection — the same as Shift-click', () => {
      setExtendTaps(!getExtendTaps());
      add.textContent = getExtendTaps() ? '☑ Adding' : '☐ Add';
      add.setAttribute('aria-pressed', String(getExtendTaps()));
    }, { pressed: getExtendTaps() });
    if (single) {
      const info = a.info(single);
      if (info) {
        const line = el('div', 'text-[10px] text-zinc-500 tabular-nums leading-snug');
        line.dataset.partInfo = '';
        const bits = [`${fmt(info.size[0])} × ${fmt(info.size[1])} × ${fmt(info.size[2])}`, `area ${fmt(info.area)}`];
        if (info.pieces.length > 1) bits.push(`spans pieces ${info.pieces.join(', ')}`);
        else if (info.pieces.length === 1 && view.pieces.length > 1 && !single.startsWith('piece:')) bits.push(`piece ${info.pieces[0]}`);
        line.textContent = bits.join(' · ');
        line.title = 'Bounding-box size, surface area and the separate solids this touches';
        sel.appendChild(line);
      }
    }
    if (part) note(sel, 'Paint, Surface and the AI now act on this part only.');
  }

  // --- Layout tools (code lines) ---
  const layoutBlock = !api.canEditParts()
    ? 'Arrange, copies and grouping write JavaScript lines (api.movePart & co.), so they work on JavaScript objects.'
    : partNames.length === 0 ? 'Arrange, copies and grouping work on named parts — import files as parts, detect parts, or wrap shapes in api.label(shape, "name").'
      : !partsOnly ? 'Arrange, copies and grouping work on named parts — the selection has pieces or unlabeled geometry.'
        : null;
  if (layoutBlock) {
    note(section('Arrange', ''), layoutBlock);
  } else {
    const n = targets.length;
    const arr = section('Arrange', 'Lay the parts out. Each edit is a line in the code (api.movePart…) that you can see, change or delete.');
    const g1 = grid(arr);
    btn(g1, 'grid', '▦ Grid', 'Lay the parts out in a grid on the plate, a gap apart', () => { void act('grid', gapOpt()); }, { disabled: n < 2 });
    btn(g1, 'pack', '▤ Pack', 'Pack the parts tightly on the plate (biggest first)', () => { void act('pack', gapOpt()); }, { disabled: n < 2 });
    btn(g1, 'bed', '▣ Bed', 'Pack the parts onto the printer bed (Print settings); what doesn’t fit goes onto more plates beside it', () => { void act('bed', gapOpt()); });
    btn(g1, 'drop', '⤓ Drop', 'Drop the parts onto the plate (z = 0)', () => { void act('drop'); });
    btn(g1, 'center', '◎ Centre', 'Centre the parts, together, on the origin', () => { void act('center'); });
    btn(g1, 'snap', '⌗ Snap', `Snap each part’s corner to a ${api.snapStep()} grid (Advanced settings → Part snap step)`, () => { void act('snap'); });
    const gapRow = el('label', 'flex items-center gap-1.5 text-zinc-400');
    gapRow.append('Gap');
    gapRow.appendChild(input('gap', fields.gap, 'auto', 'Space between parts for Grid, Pack, Bed and copies (blank = a fifth of a part’s width)', (v) => { fields.gap = v; }));
    arr.appendChild(gapRow);

    const al = section('Align', 'Line the selected parts up on one axis (2 or more), or space them evenly (3 or more)');
    const g2 = grid(al, 4);
    for (const axis of ['x', 'y', 'z'] as const) {
      g2.appendChild(el('div', 'self-center text-zinc-500 uppercase', axis));
      for (const [mode, label] of [['min', 'Min'], ['center', 'Centre'], ['max', 'Max']] as const) {
        btn(g2, `align-${axis}-${mode}`, label, `Align the parts’ ${mode === 'center' ? 'centres' : `${mode} edges`} on ${axis.toUpperCase()}`, () => { void act('align', { axis, mode }); }, { disabled: n < 2 });
      }
    }
    const g3 = grid(al, 3);
    for (const axis of ['x', 'y', 'z'] as const) {
      btn(g3, `distribute-${axis}`, `↔ Space ${axis.toUpperCase()}`, `Space the parts evenly along ${axis.toUpperCase()} (equal gaps, the end parts stay put)`, () => { void act('distribute', { axis }); }, { disabled: n < 3 });
    }

    const mv = section('Move', 'Nudge with the arrow keys while this panel is open (PageUp / PageDown for Z, Shift for ×10), or move by an exact offset');
    const pad = el('div', 'grid grid-cols-[auto_auto_auto_1fr] gap-1 items-center');
    const step = () => nudgeStep();
    const padBtn = (action: string, text: string, title: string, d: () => Vec3) => btn(pad, action, text, title, () => nudge(d()));
    padBtn('nudge-x-', '←', 'Nudge −X (←)', () => [-step(), 0, 0]);
    padBtn('nudge-y+', '↑', 'Nudge +Y (↑)', () => [0, step(), 0]);
    padBtn('nudge-x+', '→', 'Nudge +X (→)', () => [step(), 0, 0]);
    const stepLabel = el('label', 'flex items-center gap-1 text-zinc-400 row-span-2');
    stepLabel.append('Step');
    stepLabel.appendChild(input('nudge', fields.nudge, String(api.nudgeStep()), 'How far each nudge moves (Advanced settings → Part nudge step)', (v) => { fields.nudge = v; }));
    pad.appendChild(stepLabel);
    padBtn('nudge-z-', 'Z−', 'Nudge −Z (PageDown)', () => [0, 0, -step()]);
    padBtn('nudge-y-', '↓', 'Nudge −Y (↓)', () => [0, -step(), 0]);
    padBtn('nudge-z+', 'Z+', 'Nudge +Z (PageUp)', () => [0, 0, step()]);
    mv.appendChild(pad);
    const offRow = el('div', 'grid grid-cols-[1fr_1fr_1fr_auto] gap-1 items-center');
    (['x', 'y', 'z'] as const).forEach((axis, i) => {
      offRow.appendChild(input(`offset-${axis}`, fields.offset[i], axis.toUpperCase(), `Move by this much on ${axis.toUpperCase()}`, (v) => { fields.offset[i] = v; }));
    });
    btn(offRow, 'move', 'Move', 'Move the parts by the offset', () => {
      const o = fields.offset.map(s => num(s, 0)) as Vec3;
      void act('move', { offset: o });
    });
    mv.appendChild(offRow);

    const tf = section('Turn & size', 'Rotate a quarter turn about the part’s centre, lay it on its largest flat face, mirror it, or scale it (about its base)');
    const g4 = grid(tf, 3);
    for (const axis of ['x', 'y', 'z'] as const) {
      btn(g4, `rotate-${axis}`, `⟳ 90° ${axis.toUpperCase()}`, `Turn 90° about ${axis.toUpperCase()}`, () => { void act('rotate', { degrees: axis === 'x' ? [90, 0, 0] : axis === 'y' ? [0, 90, 0] : [0, 0, 90] }); });
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      btn(g4, `mirror-${axis}`, `⇋ Mirror ${axis.toUpperCase()}`, `Mirror across ${axis.toUpperCase()} (about the part’s centre)`, () => { void act('mirror', { axis }); });
    }
    btn(g4, 'layFlat', '▁ Lay flat', 'Turn each part onto its largest flat face and set it on the plate', () => { void act('layFlat'); });
    const scaleRow = el('div', 'grid grid-cols-[1fr_auto] gap-1 col-span-2');
    scaleRow.appendChild(input('scale', fields.scale, '1', 'Scale factor (1 = same size, 2 = twice as big)', (v) => { fields.scale = v; }));
    btn(scaleRow, 'scale', '⤢ Scale', 'Scale the parts by the factor, about their base', () => { void act('scale', { factor: num(fields.scale, 1) }); });
    g4.appendChild(scaleRow);

    const cp = section('Copies', 'Copies are code lines too (api.copyPart). Deleting a copy removes it; Undo takes the copy back out of the code.');
    const g5 = el('div', 'grid grid-cols-[auto_1fr_auto] gap-1 items-center');
    btn(g5, 'duplicate', '⧉ Duplicate', 'Make one copy of each part beside it', () => { void act('duplicate', gapOpt()); });
    g5.appendChild(el('span'));
    g5.appendChild(el('span'));
    g5.appendChild(el('span', 'text-zinc-400', 'Row of'));
    g5.appendChild(input('count', fields.count, '3', 'How many in the row, the original included', (v) => { fields.count = v; }));
    btn(g5, 'array', '⋯ Array', 'Repeat each part in a row along X', () => { void act('array', { count: Math.round(num(fields.count, 3)), ...gapOpt() }); });
    g5.appendChild(el('span', 'text-zinc-400', 'Grid'));
    const cr = el('div', 'grid grid-cols-[1fr_auto_1fr] gap-1 items-center');
    cr.appendChild(input('cols', fields.cols, '2', 'Columns (along X)', (v) => { fields.cols = v; }));
    cr.appendChild(el('span', 'text-zinc-500', '×'));
    cr.appendChild(input('rows', fields.rows, '2', 'Rows (along Y)', (v) => { fields.rows = v; }));
    g5.appendChild(cr);
    btn(g5, 'gridArray', '▦ Grid', 'Repeat each part in a grid on the plate', () => { void act('gridArray', { cols: Math.round(num(fields.cols, 2)), rows: Math.round(num(fields.rows, 2)), ...gapOpt() }); });
    cp.appendChild(g5);

    const gp = section('Group', 'A group is one part made of several (api.groupParts) — it moves, copies and colours as one');
    const g6 = grid(gp, 3);
    btn(g6, 'group', '⊕ Group', 'Join the selected parts into one named part', () => {
      void promptDialog(`Name for the group of ${n} parts:`, { title: 'Group parts', initialValue: api?.suggestGroupName() ?? 'Group 1', confirmLabel: 'Group' }).then((name) => {
        const v = name?.trim();
        if (v) void act('group', { name: v });
      });
    }, { disabled: n < 2 || keys.length === 0 });
    const groups = api.groups();
    const ungroupable = targets.filter(t => groups.has(t));
    btn(g6, 'ungroup', '⊖ Ungroup', ungroupable.length > 0 ? 'Split the group back into its parts' : 'Select a group made with Group to split it', () => { void act('ungroup', { parts: ungroupable }); }, { disabled: ungroupable.length === 0 });
    btn(g6, 'cut', '✂ Cut with', 'Subtract this part from the rest of the object (it stays in the code as a cutter)', () => { void act('cut'); }, { disabled: selectedParts.length !== 1 });
  }

  // --- Footer: undo ---
  const status = el('div', 'flex-1 min-w-0 truncate text-[10px] text-zinc-500', busy ? 'Applying…' : 'Each edit saves a version.');
  footer.appendChild(status);
  const undo = el('button', BUTTON_SMALL_SECONDARY + ' disabled:opacity-40', '↶ Undo');
  undo.type = 'button';
  undo.dataset.partAction = 'undo';
  undo.title = 'Undo the last part edit in this object';
  undo.disabled = busy || !api.canUndo();
  undo.addEventListener('click', () => {
    if (!api || busy) return;
    busy = true;
    render();
    void api.undo().then((r) => {
      if ('error' in r) showToast(r.error, { variant: 'warn' });
      else showToast(`Undid “${r.undone}”`, { variant: 'neutral' });
    }).finally(() => { busy = false; render(); });
  });
  footer.appendChild(undo);

  if (focusedField) body.querySelector<HTMLElement>(`[data-field="${CSS.escape(focusedField)}"]`)?.focus();
}

/** A small colour swatch inside a 44 px tap target on touch screens. */
function swatchHit(swatch: HTMLElement): HTMLElement {
  const hit = el('span', 'shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 cursor-pointer');
  hit.addEventListener('click', (e) => { if (e.target === hit) { e.stopPropagation(); swatch.click(); } });
  hit.appendChild(swatch);
  return hit;
}

function gapOpt(): Record<string, unknown> {
  const g = num(fields.gap, NaN);
  return Number.isFinite(g) && g >= 0 ? { gap: g } : {};
}

/** Wire the panel into the Tools menu, the command palette and the tool
 *  registry, and open it when parts get selected. */
export function initPartsPanel(panelApi: PartsPanelApi): void {
  api = panelApi;
  registerTool({
    id: 'tool-parts',
    title: 'Parts',
    hint: 'Arrange',
    open: () => { openPartsPanel(); },
    isOpen: () => isPartsPanelOpen(),
    close: () => closePartsPanel(),
  });
  registerCommands([
    { id: 'tool-parts', title: 'Parts panel', hint: 'Arrange', keywords: 'parts arrange layout grid pack bed plate align distribute copy duplicate array group ungroup rename mirror rotate scale nudge', run: () => { void openTool('tool-parts'); } },
    { id: 'parts-grid', title: 'Arrange parts in a grid', hint: 'Parts', keywords: 'arrange layout grid parts', run: () => { void act('grid', gapOpt()); } },
    { id: 'parts-bed', title: 'Pack parts onto the printer bed', hint: 'Parts', keywords: 'arrange pack bed plate print parts', run: () => { void act('bed', gapOpt()); } },
    { id: 'parts-undo', title: 'Undo the last part edit', hint: 'Parts', keywords: 'undo part edit arrange', run: () => {
      void panelApi.undo().then((r) => showToast('error' in r ? r.error : `Undid “${r.undone}”`, { variant: 'error' in r ? 'warn' : 'neutral' }));
    } },
  ]);

  // Pop up when parts get selected — unless another tool panel is up (opening
  // would close it). Once closed by hand it stays down for this selection,
  // except that growing it from one part to several brings it back.
  let prevCount = 0;
  onPartSelectionChange(() => {
    const count = getSelectedPartKeys().length;
    if (count === 0) closedAtCount = -1;
    const grew = count > prevCount;
    prevCount = count;
    if (shell || !grew || count === 0 || getActiveViewportPanel()) return;
    if (closedAtCount < 0 || (closedAtCount < 2 && count >= 2)) openPartsPanel();
  });

  const mount = () => {
    if (document.getElementById('parts-panel-toggle')) return;
    const styleRef = document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter(c => c !== 'hidden').join(' ') || BUTTON_SMALL_SECONDARY;
    const b = el('button', btnCls, '▦ Parts');
    b.id = 'parts-panel-toggle';
    b.title = 'Arrange, copy, group and edit the parts of this object';
    b.addEventListener('click', () => (shell ? closePartsPanel() : openPartsPanel()));
    host.appendChild(b);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('parts-panel-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
