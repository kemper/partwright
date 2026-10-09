// The open object's expandable PARTS / PIECES section in the Objects rail, and
// the part actions it offers (#1003).
//
// Design rule: the rail is a SELECTOR, not a second editor. Clicking a part
// selects it (src/ui/partSelection.ts) and the existing tools — Paint, Image
// stamp, Surface textures, the AI — confine themselves to it. The only edits
// that live here are the ones that are about the part itself: its colour (the
// swatch = fill the whole part), isolate/info/go-to-code, rename, bake its
// colour into code, and the piece actions (extract / export / delete). Paint
// that no longer matches the code ("unmatched paint") is surfaced and fixed
// here too, because the rail is where the parts it should match are listed.

import { createColorSwatch } from './colorPickerModal';
import { promptDialog } from './dialogs';

/** What the section lists. Mirrors `partwright.listObjectParts()` (minus the
 *  object id/name). */
export interface ObjectPartsView {
  /** api.label regions, in declaration order. `color` is the drawn colour;
   *  `colorSource` says where it comes from: `code` (api.label colour /
   *  api.paint) or `painted` (a paint region fills the part). */
  parts: { name: string; triangleCount: number; color?: string; colorSource?: 'code' | 'painted' }[];
  /** Labels the code declared that ended up with no triangles. */
  lostParts: string[];
  /** Triangles no part covers (0 when the object declares no parts). */
  unlabeledTriangleCount: number;
  /** Connected components; `part` names the part covering most of each. */
  pieces: { index: number; triangleCount: number; part?: string }[];
  /** Paint regions tied to a part the code no longer has (they paint nothing).
   *  `kept` ones were acknowledged with "Keep" and stay dormant — they come
   *  back on their own if the label returns. */
  unmatchedPaint: { regionId: number; name: string; label: string; color: string; kept: boolean }[];
  /** Geometric paint regions that resolve to no triangles on this geometry. */
  emptyPaint: { regionId: number; name: string }[];
  /** "Looks like a rename": a part with unmatched paint vanished in the same
   *  run another appeared in about the same place. */
  renameSuggestions: { from: string; to: string }[];
  /** Whether code-writing actions (bake, piece filters) apply — the object is
   *  a manifold-js object. */
  codeActions: boolean;
}

export interface PartInfo {
  size: [number, number, number];
  area: number;
  triangleCount: number;
  /** 1-based piece numbers the selection touches (empty when it's one piece). */
  pieces: number[];
}

/** Everything the section reads and does. Implemented by main.ts. */
export interface ObjectPartsActions {
  getView(): ObjectPartsView | null;
  /** The selected `part:<name>` | `piece:<n>` | `unlabeled`, or null. */
  getSelectedKey(): string | null;
  getIsolatedKey(): string | null;
  select(key: string | null): void;
  isolate(key: string | null): void;
  info(key: string): PartInfo | null;
  setPartColor(name: string, hex: string): void;
  resetPartColor(name: string): void;
  goToCode(name: string): void;
  renamePart(name: string, newName: string): void | Promise<void>;
  bakePartColor(name: string): void | Promise<void>;
  editWithAI(key: string): void;
  /** True when arrange mode can move this part (it's an arrange-managed element). */
  canArrange(name: string): boolean;
  arrange(name: string): void;
  extractPiece(index: number): void | Promise<void>;
  exportPiece(index: number): void;
  deletePiece(index: number): void | Promise<void>;
  reassignPaint(regionId: number, label: string): void;
  keepPaint(regionId: number): void;
  deletePaint(regionId: number): void;
  acceptRename(from: string, to: string): void;
}

function compactCount(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function fmt(n: number): string {
  const a = Math.abs(n);
  return a >= 100 ? n.toFixed(0) : a >= 10 ? n.toFixed(1) : n.toFixed(2);
}

const ACTION_BTN = 'px-1.5 py-1 min-h-[36px] md:min-h-0 rounded text-[10px] leading-tight text-zinc-300 bg-zinc-800 border border-zinc-700 [@media(hover:hover)]:hover:bg-zinc-700 [@media(hover:hover)]:hover:text-zinc-100 disabled:opacity-40 disabled:pointer-events-none text-left truncate';

/** Build the `#object-parts` section. Rebuilt wholesale on every mesh update
 *  and selection change (see refreshObjectParts in partList.ts). */
export function buildObjectPartsSection(a: ObjectPartsActions): HTMLElement {
  const section = document.createElement('div');
  section.id = 'object-parts';
  section.className = 'ml-6 mr-1 mb-1 pl-2 border-l border-zinc-700/60 text-[11px]';
  const view = a.getView();
  const selected = a.getSelectedKey();
  const isolated = a.getIsolatedKey();

  const heading = (text: string, title: string) => {
    const h = document.createElement('div');
    h.className = 'px-1 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500';
    h.textContent = text;
    h.title = title;
    section.appendChild(h);
    return h;
  };
  const note = (text: string, parent: HTMLElement = section) => {
    const n = document.createElement('div');
    n.className = 'px-1 py-0.5 text-[10px] text-zinc-600 italic leading-snug';
    n.textContent = text;
    parent.appendChild(n);
    return n;
  };

  /** One selectable row. Parts get a colour swatch (fill the whole part);
   *  pieces and the unlabeled remainder get a plain chip. */
  const item = (key: string, name: string, count: number, opts: { color?: string; italic?: boolean; title: string; partName?: string; badge?: string }) => {
    const on = selected === key;
    const row = document.createElement('div');
    row.className = 'flex items-center gap-1 rounded transition-colors '
      + (on ? 'bg-amber-400/15' : '[@media(hover:hover)]:hover:bg-zinc-700/40');
    if (opts.partName !== undefined) {
      const partName = opts.partName;
      const swatch = createColorSwatch({
        initialHex: opts.color ?? '#71717a',
        title: `Colour the whole "${partName}" part`,
        modalTitle: `Colour for "${partName}"`,
        className: 'shrink-0 ml-1 w-3 h-3 rounded-sm border border-zinc-500 [@media(hover:hover)]:hover:border-white/70 cursor-pointer',
        dataAction: 'set-part-color',
        onPick: (hex) => a.setPartColor(partName, hex),
      });
      swatch.el.dataset.part = partName;
      row.appendChild(swatch.el);
    } else {
      const sw = document.createElement('span');
      sw.className = 'shrink-0 ml-1 w-3 h-3 rounded-sm border border-zinc-600';
      sw.style.background = opts.color ?? '#71717a';
      row.appendChild(sw);
    }
    const b = document.createElement('button');
    b.dataset.objectPart = key;
    b.setAttribute('aria-pressed', String(on));
    b.title = opts.title;
    // ≥44px tall on mobile (the rail is a full-width touch pane there).
    b.className = 'flex-1 min-w-0 flex items-center gap-1.5 px-1 py-1 min-h-[44px] md:min-h-0 rounded text-left '
      + (on ? 'text-amber-100' : 'text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200');
    const label = document.createElement('span');
    label.className = 'flex-1 min-w-0 truncate' + (opts.italic ? ' italic' : '');
    label.textContent = name;
    b.appendChild(label);
    if (opts.badge) {
      const badge = document.createElement('span');
      badge.className = 'shrink-0 text-[9px] uppercase tracking-wide ' + (opts.badge === 'painted' ? 'text-emerald-400/80' : 'text-zinc-500');
      badge.dataset.colorSource = opts.badge;
      badge.textContent = opts.badge;
      badge.title = opts.badge === 'painted'
        ? 'Coloured by paint (an overlay on the code). Use ↺ to go back to the code colour.'
        : 'Coloured in code (api.label colour / api.paint)';
      b.appendChild(badge);
    }
    const c = document.createElement('span');
    c.className = 'shrink-0 tabular-nums text-[10px] text-zinc-600';
    c.textContent = compactCount(count);
    b.appendChild(c);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      a.select(on ? null : key);
    });
    row.appendChild(b);
    section.appendChild(row);
    if (on && view) section.appendChild(buildDrawer(a, key, view, isolated === key));
  };

  heading('Parts', 'Named regions of this object, declared in code with api.label(shape, "name"). They stay tracked through unions and cuts, even when several parts fuse into one solid. Select one and Paint, Surface and the AI act on just that part.');
  if (!view) {
    note('Run the code to list this object’s parts.');
    return section;
  }
  if (view.parts.length === 0 && view.lostParts.length === 0) {
    note('No labelled parts — wrap shapes in api.label(shape, "name") to name them.');
  }
  for (const p of view.parts) {
    item(`part:${p.name}`, p.name, p.triangleCount, {
      color: p.color,
      partName: p.name,
      badge: p.colorSource,
      title: `Select part "${p.name}" (${p.triangleCount} triangles) — Paint, Surface and the AI then act on just this part`,
    });
  }
  if (view.parts.length > 0 && view.unlabeledTriangleCount > 0) {
    item('unlabeled', 'Unlabeled', view.unlabeledTriangleCount, { italic: true, title: 'Select the geometry no part covers' });
  }
  for (const name of view.lostParts) {
    const lost = document.createElement('div');
    lost.className = 'flex items-center gap-1.5 px-1 py-1 text-zinc-600';
    lost.title = `"${name}" was labelled in code but has no triangles left — an operation consumed it (e.g. it was fully subtracted, or a smoothing/level-set step dropped the label).`;
    const sw = document.createElement('span');
    sw.className = 'shrink-0 ml-1 w-3 h-3 rounded-sm border border-dashed border-zinc-600';
    lost.appendChild(sw);
    const label = document.createElement('span');
    label.className = 'flex-1 min-w-0 truncate line-through';
    label.textContent = name;
    lost.appendChild(label);
    const tag = document.createElement('span');
    tag.className = 'shrink-0 text-[10px] uppercase tracking-wide';
    tag.textContent = 'lost';
    lost.appendChild(tag);
    section.appendChild(lost);
  }

  appendUnmatchedPaint(section, a, view);

  if (view.pieces.length > 1) {
    heading(`Pieces · ${view.pieces.length}`, 'Physically separate solids — what comes off the print bed as its own lump (e.g. the moving parts of a print-in-place mechanism).');
    for (const piece of view.pieces) {
      const name = piece.part ? `Piece ${piece.index + 1} · ${piece.part}` : `Piece ${piece.index + 1}`;
      item(`piece:${piece.index}`, name, piece.triangleCount, { title: `Select piece ${piece.index + 1}${piece.part ? ` (mostly "${piece.part}")` : ''}` });
    }
  }
  return section;
}

/** The action drawer under the selected part / piece / unlabeled row. */
function buildDrawer(a: ObjectPartsActions, key: string, view: ObjectPartsView, isolated: boolean): HTMLElement {
  const drawer = document.createElement('div');
  drawer.id = 'object-part-drawer';
  drawer.dataset.key = key;
  drawer.className = 'ml-4 mr-0.5 mb-1 mt-0.5 p-1.5 rounded border border-zinc-700/70 bg-zinc-900/50 flex flex-col gap-1';

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-2 gap-1';
  const btn = (action: string, text: string, title: string, onClick: () => void, opts: { disabled?: boolean; pressed?: boolean } = {}) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.partAction = action;
    b.className = ACTION_BTN + (opts.pressed ? ' !bg-amber-400/20 !text-amber-100 !border-amber-400/40' : '');
    b.textContent = text;
    b.title = title;
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
    b.disabled = !!opts.disabled;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    grid.appendChild(b);
    return b;
  };

  const isolateBtn = () => btn('isolate', isolated ? '◑ Show all' : '◐ Isolate', isolated ? 'Show the whole object again' : 'Ghost everything else so only this is drawn solid', () => a.isolate(isolated ? null : key), { pressed: isolated });

  if (key.startsWith('part:')) {
    const name = key.slice(5);
    const part = view.parts.find(p => p.name === name);
    if (part?.colorSource === 'painted') {
      const row = document.createElement('div');
      row.className = 'flex items-center gap-1 text-[10px] text-zinc-500';
      const t = document.createElement('span');
      t.className = 'flex-1';
      t.textContent = 'Painted over the code colour';
      row.appendChild(t);
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.dataset.partAction = 'reset-color';
      reset.className = 'px-1.5 py-0.5 rounded text-[10px] text-zinc-300 [@media(hover:hover)]:hover:bg-zinc-700';
      reset.textContent = '↺ Reset';
      reset.title = `Remove the paint that fills "${name}" and go back to the colour the code gives it`;
      reset.addEventListener('click', (e) => { e.stopPropagation(); a.resetPartColor(name); });
      row.appendChild(reset);
      drawer.appendChild(row);
    }
    isolateBtn();
    btn('go-to-code', '⌖ Code', `Show where "${name}" is labelled in the code`, () => a.goToCode(name));
    btn('rename', '✎ Rename', `Rename "${name}" in the code, its paint and its texture scopes`, () => {
      void promptDialog(`Rename part "${name}" to:`, { title: 'Rename part', initialValue: name, confirmLabel: 'Rename' }).then((next) => {
        const v = next?.trim();
        if (v && v !== name) void a.renamePart(name, v);
      });
    });
    btn('bake-color', '⤓ Bake', view.codeActions
      ? `Write "${name}"’s current colour into the code (api.paint.label) so it’s part of the model, not an overlay`
      : 'Baking a colour into code needs a JavaScript (manifold-js) object', () => { void a.bakePartColor(name); }, { disabled: !view.codeActions || !part?.color });
    btn('edit-with-ai', '✦ Ask AI', `Ask the AI to change "${name}"`, () => a.editWithAI(key));
    if (a.canArrange(name)) btn('arrange', '⧉ Arrange', `Move, resize or align "${name}" in arrange mode`, () => a.arrange(name));
  } else if (key.startsWith('piece:')) {
    const index = Number(key.slice(6));
    isolateBtn();
    const noCode = !view.codeActions;
    const why = 'Rewriting the code to split pieces needs a JavaScript (manifold-js) object';
    btn('extract-piece', '⤴ Extract', noCode ? why : 'Move this piece into its own new object (both objects’ code gets a piece filter; version history keeps the original)', () => { void a.extractPiece(index); }, { disabled: noCode || view.pieces.length < 2 });
    btn('export-piece', '⤓ STL', 'Download just this piece as an STL', () => a.exportPiece(index));
    btn('delete-piece', '✕ Delete', noCode ? why : 'Remove this stray piece from the object (adds a piece filter to the code)', () => { void a.deletePiece(index); }, { disabled: noCode || view.pieces.length < 2 });
    btn('edit-with-ai', '✦ Ask AI', 'Ask the AI about this piece', () => a.editWithAI(key));
  } else {
    isolateBtn();
    btn('edit-with-ai', '✦ Ask AI', 'Ask the AI to label or change the unlabeled geometry', () => a.editWithAI(key));
  }
  drawer.appendChild(grid);

  const info = a.info(key);
  if (info) {
    const line = document.createElement('div');
    line.dataset.partInfo = '';
    line.className = 'px-0.5 text-[10px] text-zinc-500 tabular-nums leading-snug';
    const parts = [`${fmt(info.size[0])} × ${fmt(info.size[1])} × ${fmt(info.size[2])}`, `area ${fmt(info.area)}`];
    if (info.pieces.length > 1) parts.push(`spans pieces ${info.pieces.join(', ')}`);
    else if (info.pieces.length === 1 && view.pieces.length > 1 && !key.startsWith('piece:')) parts.push(`piece ${info.pieces[0]}`);
    line.textContent = parts.join(' · ');
    line.title = 'Bounding-box size, surface area and the separate solids this touches';
    drawer.appendChild(line);
  }
  if (key.startsWith('part:')) {
    const hint = document.createElement('div');
    hint.className = 'px-0.5 text-[10px] text-zinc-600 leading-snug';
    hint.textContent = 'Paint, Surface and the AI now act on this part only.';
    drawer.appendChild(hint);
  }
  return drawer;
}

/** "Unmatched paint (N)": paint keyed to parts the code no longer has. */
function appendUnmatchedPaint(section: HTMLElement, a: ObjectPartsActions, view: ObjectPartsView): void {
  const live = view.unmatchedPaint.filter(u => !u.kept);
  const kept = view.unmatchedPaint.filter(u => u.kept);
  if (live.length === 0 && view.emptyPaint.length === 0 && view.renameSuggestions.length === 0 && kept.length === 0) return;
  const box = document.createElement('div');
  box.id = 'unmatched-paint';
  box.className = 'mt-1 mb-1 rounded border border-amber-700/50 bg-amber-900/15 p-1';
  const count = live.length + view.emptyPaint.length;
  const h = document.createElement('div');
  h.className = 'px-0.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide ' + (count > 0 ? 'text-amber-300' : 'text-zinc-500');
  h.textContent = count > 0 ? `Unmatched paint (${count})` : 'Unmatched paint';
  h.title = 'Paint that no longer lands anywhere on this object — usually because the code renamed or removed the part it was painted on. Nothing is deleted until you say so.';
  box.appendChild(h);

  for (const s of view.renameSuggestions) {
    const row = document.createElement('div');
    row.dataset.renameSuggestion = `${s.from}→${s.to}`;
    row.className = 'flex items-center gap-1 px-0.5 py-0.5 text-[10px] text-amber-100';
    const t = document.createElement('span');
    t.className = 'flex-1 min-w-0 leading-snug';
    t.textContent = `Looks like “${s.from}” → “${s.to}”. Move its colour?`;
    row.appendChild(t);
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.dataset.partAction = 'accept-rename';
    yes.className = 'shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-100 [@media(hover:hover)]:hover:bg-amber-500/30';
    yes.textContent = 'Move';
    yes.addEventListener('click', (e) => { e.stopPropagation(); a.acceptRename(s.from, s.to); });
    row.appendChild(yes);
    box.appendChild(row);
  }

  const partNames = view.parts.map(p => p.name);
  const regionRow = (regionId: number, name: string, detail: string, color: string | null, opts: { reassign: boolean; keep: boolean }) => {
    const row = document.createElement('div');
    row.dataset.unmatchedRegion = String(regionId);
    row.className = 'flex flex-col gap-0.5 px-0.5 py-0.5';
    const top = document.createElement('div');
    top.className = 'flex items-center gap-1 text-[10px] text-zinc-300';
    const sw = document.createElement('span');
    sw.className = 'shrink-0 w-2.5 h-2.5 rounded-sm border border-zinc-500';
    if (color) sw.style.background = color;
    top.appendChild(sw);
    const t = document.createElement('span');
    t.className = 'flex-1 min-w-0 truncate';
    t.textContent = `${name} — ${detail}`;
    t.title = `${name} — ${detail}`;
    top.appendChild(t);
    row.appendChild(top);
    const actions = document.createElement('div');
    actions.className = 'flex items-center gap-1 pl-3.5';
    if (opts.reassign && partNames.length > 0) {
      const sel = document.createElement('select');
      sel.dataset.partAction = 'reassign-paint';
      sel.className = 'min-w-0 flex-1 text-[10px] bg-zinc-900 border border-zinc-600 rounded px-1 py-0.5 text-zinc-200';
      sel.setAttribute('aria-label', `Reassign "${name}" to another part`);
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = 'Reassign to…';
      sel.appendChild(ph);
      for (const p of partNames) {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = p;
        sel.appendChild(o);
      }
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => { if (sel.value) a.reassignPaint(regionId, sel.value); });
      actions.appendChild(sel);
    }
    const small = (action: string, text: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.partAction = action;
      b.className = 'shrink-0 px-1.5 py-0.5 rounded text-[10px] text-zinc-300 bg-zinc-800 border border-zinc-700 [@media(hover:hover)]:hover:bg-zinc-700';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      actions.appendChild(b);
    };
    if (opts.keep) small('keep-paint', 'Keep', 'Leave it dormant — it paints again on its own if that part comes back', () => a.keepPaint(regionId));
    small('delete-paint', 'Delete', 'Delete this paint region', () => a.deletePaint(regionId));
    row.appendChild(actions);
    box.appendChild(row);
  };
  for (const u of live) regionRow(u.regionId, u.name, `part “${u.label}” is gone`, u.color, { reassign: true, keep: true });
  for (const e of view.emptyPaint) regionRow(e.regionId, e.name, 'paints nothing on this geometry', null, { reassign: false, keep: false });
  if (kept.length > 0) note(`${kept.length} dormant (kept) — ${kept.map(k => k.label).join(', ')}`, box);
  section.appendChild(box);

  function note(text: string, parent: HTMLElement) {
    const n = document.createElement('div');
    n.className = 'px-0.5 pt-0.5 text-[10px] text-zinc-500 italic leading-snug';
    n.textContent = text;
    parent.appendChild(n);
  }
}
