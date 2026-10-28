// Part-selection modal for multi-part exports (3MF / OBJ / STL / GLB). Lets the
// user pick which Session Parts to bundle into one file, with a thumbnail preview
// of each. The currently-viewed part is preselected; a Select-all / Select-none
// toggle handles assemblies with many parts.
//
// With `split` options, each ticked object is measured (baked) in the
// background and, when it has several pieces or parts, gains a "Split" menu:
// Whole / Pieces (N) / Parts (N). A split object lists its items underneath,
// each with its own checkbox, so the export can leave one out. For the Bambu
// project the options pane adds a Custom plate layout (a Plate chip on every
// row) and a top-down preview of each plate, laid out by the same packer the
// exporter uses. Items keep their modelled orientation.
//
// Resolves with the chosen part ids (in list order) when the user confirms, or
// null if they cancel / dismiss. Only the export caller decides what to do with
// the selection — this modal is pure UI; the format-specific title/description
// are passed in by the caller.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { buildPartTree, groupNames } from './partTree';
import { DEFAULT_PACK_STRATEGY, DEFAULT_GRID_GAP_MM, layoutBambuPlates, type BambuPlateLayout, type PackStrategy } from '../export/threemfProject';
import { isExportSplitMode, type ExportSplitMode } from '../export/exportSplit';
import { createToolNote, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';
import { armDialogConfirm } from './dialogConfirmGuard';

/** Pre-set values for the NEXT object picker (from `openTool('export-objects')`).
 *  The picker only opens staged — the user still clicks Export. */
export interface ExportPartsPrefill {
  /** Object names or ids to tick (default: the current object). */
  objects?: string[];
  printer?: string;
  nozzle?: string;
  filament?: string;
  plateLayout?: BambuPlateLayout;
  packStrategy?: PackStrategy;
  /** Object name or id → how it splits. A mode the object can't use (one
   *  piece, no parts) falls back to whole once the object is measured. */
  split?: Record<string, ExportSplitMode>;
  note?: string;
  source?: ToolOpenContext['source'];
}

let stagedPrefill: { prefill: ExportPartsPrefill; settle: (r: ToolOpenResult) => void } | null = null;
let openPicker: { state: () => Record<string, unknown>; close: () => void } | null = null;

/** Split choices made in this tab, per object id, so re-exporting starts where
 *  the user left off. Per tab on purpose (not persisted with the session). */
const rememberedSplit = new Map<string, ExportSplitMode>();

/** Stage a prefill for the next showExportPartsModal call. Resolves once that
 *  picker has opened with it ({applied, ignored}) or rejected it ({error} — the
 *  picker then never shows, so nothing is exported). */
export function stageExportPartsPrefill(prefill: ExportPartsPrefill): Promise<ToolOpenResult> {
  stagedPrefill?.settle({ error: 'superseded by a newer prefill' });
  return new Promise(resolve => { stagedPrefill = { prefill, settle: resolve }; });
}

/** Drop a staged prefill nobody consumed (the export ended before its picker). */
export function clearExportPartsPrefill(reason: string): void {
  if (!stagedPrefill) return;
  stagedPrefill.settle({ error: reason });
  stagedPrefill = null;
}

export function isExportPartsOpen(): boolean { return openPicker !== null; }
export function getExportPartsState(): Record<string, unknown> | null { return openPicker?.state() ?? null; }
export function closeExportPartsModal(): void { openPicker?.close(); }

export interface ExportPartChoice {
  id: string;
  name: string;
  /** Pre-baked preview thumbnail (latest version's). May be null. */
  thumbnail: Blob | null;
  /** Group name (from `Part.group`); parts sharing one list under a collapsible
   *  header with a whole-group select/deselect checkbox. Absent ⇒ ungrouped. */
  group?: string;
}

/** Optional Bambu/Orca controls (printer + nozzle + filament) shown only there. */
export interface ExportPartsBambuOptions {
  /** `bed` (X × Y mm) sizes the plate preview. */
  printers: { id: string; label: string; bed?: [number, number] }[];
  defaultPrinter: string;
  nozzles: string[];
  defaultNozzle: string;
  filaments: { id: string; label: string }[];
  defaultFilament: string;
}

/** One item a measured object can split into. */
export interface ExportSplitItemInfo {
  key: string;
  name: string;
  /** Bounding-box size `[x, y, z]`. */
  size: [number, number, number];
  /** Parts fused into one solid, so they stay together. */
  fused: boolean;
  labels: string[];
}

/** What the picker learns about an object once it's measured. */
export interface ExportObjectSplitInfo {
  size: [number, number, number];
  pieceCount: number;
  pieces: ExportSplitItemInfo[] | null;
  parts: ExportSplitItemInfo[] | null;
}

/** Hooks that turn on the per-object Split control. */
export interface ExportPartsSplitOptions {
  /** Measure one object (bake it). Null when it produced no geometry. */
  analyze: (objectId: string) => Promise<ExportObjectSplitInfo | null>;
  /** Draw a small preview of one item; null when there's nothing to draw. */
  thumbnail?: (objectId: string, mode: ExportSplitMode, itemKey: string) => HTMLCanvasElement | null;
}

/** Modal result: the chosen part ids plus (for Bambu) the printer/nozzle/filament
 *  and the plate layout, and (for 3MF) the packing strategy. */
export interface ExportPartsResult {
  partIds: string[];
  printer?: string;
  nozzle?: string;
  filament?: string;
  /** Bambu only — how selected parts are distributed across build plates. */
  plateLayout?: BambuPlateLayout;
  /** 3MF only — how parts sharing a plate / the generic model are arranged. */
  packStrategy?: PackStrategy;
  /** Object id → split mode, for objects that don't export whole. */
  splits?: Record<string, ExportSplitMode>;
  /** Object id → keys of the items left out of a split object. */
  excluded?: Record<string, string[]>;
  /** `'custom'` layout: object id → item key (`'*'` for a whole object) → plate number. */
  plates?: Record<string, Record<string, number>>;
}

export interface ExportPartsModalOptions {
  /** Part preselected on open (typically the currently-viewed part). */
  activePartId: string | null;
  /** Modal title, e.g. "Export parts to OBJ". */
  title: string;
  /** One-line explanation of how this format bundles the parts. */
  description: string;
  /** When present, render the Bambu printer + nozzle dropdowns. */
  bambu?: ExportPartsBambuOptions;
  /** When true, show the packing-strategy radios in an always-visible options pane
   *  (the generic 3MF export uses this without the Bambu controls). Implied by
   *  `bambu`, which always shows packing alongside its printer/plate controls. */
  packing?: boolean;
  /** Turns on the Split control (pieces / parts) for each object. */
  split?: ExportPartsSplitOptions;
}

/** The key a whole (unsplit) object uses in `plates`. */
export const WHOLE_ITEM_KEY = '*';

const fmtSize = (s: [number, number, number]) => s.map(v => (v >= 100 ? v.toFixed(0) : v.toFixed(1))).join(' × ');

/**
 * Show the multi-part export part picker. Returns the selected part ids (in list
 * order) plus the Bambu printer/nozzle (when those controls are shown), or null on
 * cancel. The caller supplies the format-specific title + description via `opts`.
 */
export function showExportPartsModal(
  parts: ExportPartChoice[],
  opts: ExportPartsModalOptions,
): Promise<ExportPartsResult | null> {
  const { activePartId, title, description, bambu, split } = opts;
  // Any export with an options pane (Bambu controls, or just the 3MF packing
  // strategy) gets the two-pane layout. Bambu always includes packing.
  const showPacking = !!bambu || !!opts.packing;
  const twoPane = showPacking;
  return new Promise((resolve) => {
    const findPart = (want: string) => parts.find(x => x.id === want) ?? parts.find(x => x.name.toLowerCase() === want.toLowerCase());
    // Consume a staged openTool prefill: validate EVERY key against this
    // picker's real objects / options before building anything, so a bad
    // prefill never shows a picker (and can't lead to an export).
    const staged = stagedPrefill;
    stagedPrefill = null;
    let pre: { ids: string[] | null; applied: Record<string, unknown>; ignored: string[]; p: ExportPartsPrefill; split: Map<string, ExportSplitMode> } | null = null;
    if (staged) {
      const p = staged.prefill;
      const errors: string[] = [];
      const ignored: string[] = [];
      const applied: Record<string, unknown> = {};
      let ids: string[] | null = null;
      if (p.objects) {
        ids = [];
        for (const want of p.objects) {
          const hit = findPart(want);
          if (!hit) errors.push(`objects: "${want}" is not an object of this session (objects: ${parts.map(x => `"${x.name}"`).join(', ')})`);
          else if (!ids.includes(hit.id)) ids.push(hit.id);
        }
        if (ids.length === 0 && p.objects.length === 0) errors.push('objects must name at least one object');
        applied.objects = ids.map(id => parts.find(x => x.id === id)!.name);
      }
      const pick = (key: 'printer' | 'nozzle' | 'filament', allowed: string[] | undefined) => {
        const v = p[key];
        if (v === undefined) return;
        if (!allowed) { ignored.push(key); return; }
        if (!allowed.includes(v)) errors.push(`${key} must be one of ${allowed.join(', ')}`);
        else applied[key] = v;
      };
      pick('printer', bambu?.printers.map(x => x.id));
      pick('nozzle', bambu?.nozzles);
      pick('filament', bambu?.filaments.map(x => x.id));
      if (p.plateLayout !== undefined) {
        if (!bambu) ignored.push('plateLayout');
        else applied.plateLayout = p.plateLayout;
      }
      if (p.packStrategy !== undefined) {
        if (!showPacking) ignored.push('packStrategy'); else applied.packStrategy = p.packStrategy;
      }
      const preSplit = new Map<string, ExportSplitMode>();
      if (p.split !== undefined) {
        if (!split) ignored.push('split');
        else {
          const out: Record<string, ExportSplitMode> = {};
          for (const [want, mode] of Object.entries(p.split)) {
            const hit = findPart(want);
            if (!hit) errors.push(`split: "${want}" is not an object of this session`);
            else if (!isExportSplitMode(mode)) errors.push(`split["${want}"] must be one of "whole", "pieces", "parts"`);
            else { preSplit.set(hit.id, mode); out[hit.name] = mode; }
          }
          applied.split = out;
        }
      }
      if (errors.length) { staged.settle({ error: errors.join('; ') }); resolve(null); return; }
      pre = { ids, applied, ignored, p, split: preSplit };
    }

    let result: ExportPartsResult | null = null;
    let closed = false;
    let disarmConfirm: () => void = () => {};
    // Track object URLs so we can revoke them on teardown (no GPU/blob leak).
    const objectUrls: string[] = [];

    const shell = createModalShell({
      title,
      scrollable: true,
      // Exports with an options pane show it beside the part list, so the modal is
      // wider (and side-by-side on desktop). Other formats keep the default
      // single-column width.
      ...(twoPane ? { widthClass: 'max-w-lg sm:max-w-3xl' } : {}),
      onClose: () => {
        closed = true;
        disarmConfirm();
        for (const url of objectUrls) URL.revokeObjectURL(url);
        openPicker = null;
        resolve(result);
      },
    });
    if (pre?.p.note) {
      const note = createToolNote(pre.p.note, pre.p.source);
      shell.body.appendChild(note);
    }

    const sub = document.createElement('p');
    sub.className = 'text-[11px] text-zinc-400 leading-relaxed';
    sub.textContent = split
      ? `${description} An object made of separate pieces or labelled parts can be split so each lands as its own object (pieces keep their modelled orientation).`
      : description;
    shell.body.appendChild(sub);

    // When there's an options pane, split the body into two: the part-list
    // selector on the left and an always-visible options pane on the right
    // (stacked on mobile, side-by-side on desktop). Other formats stay
    // single-column. `listParent` and `optionsParent` point at the right
    // containers for each layout.
    let optionsParent: HTMLElement = shell.body;
    let listParent: HTMLElement = shell.body;
    if (twoPane) {
      const panes = document.createElement('div');
      panes.className = 'flex flex-col sm:flex-row gap-4 sm:gap-5 flex-1 min-h-0 mt-1';
      const leftCol = document.createElement('div');
      leftCol.className = 'flex flex-col gap-1 min-w-0 sm:flex-1 sm:min-h-0 sm:overflow-y-auto';
      const rightCol = document.createElement('div');
      rightCol.className = 'flex flex-col gap-1 sm:w-64 shrink-0 sm:border-l sm:border-zinc-700 sm:pl-5 sm:min-h-0 sm:overflow-y-auto';
      panes.append(leftCol, rightCol);
      shell.body.appendChild(panes);
      listParent = leftCol;
      optionsParent = rightCol;
    }

    // Header row with the count + select-all toggle.
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between mt-1';
    const heading = document.createElement('div');
    heading.className = 'text-xs text-zinc-200 font-medium';
    const toggleAll = document.createElement('button');
    toggleAll.type = 'button';
    toggleAll.className = 'text-[10px] text-blue-400 hover:text-blue-300';
    head.append(heading, toggleAll);
    listParent.appendChild(head);

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1 mt-1';
    listParent.appendChild(list);

    // The checkboxes ARE the selection state (source of truth for selectedIds).
    const checks: HTMLInputElement[] = [];
    // Per-group header updaters, run from sync() to reflect their members'
    // checked state as checked / indeterminate / unchecked.
    const groupSyncers: (() => void)[] = [];

    // ── Split state ──
    // `analysis`: undefined = not asked yet, 'pending' = measuring, null = no geometry.
    const analysis = new Map<string, ExportObjectSplitInfo | null | 'pending'>();
    const modeOf = new Map<string, ExportSplitMode>();
    for (const p of parts) {
      const m = pre?.split.get(p.id) ?? rememberedSplit.get(p.id);
      if (m) modeOf.set(p.id, m);
    }
    /** Item keys left out, as `${objectId}\n${itemKey}`. */
    const excluded = new Set<string>();
    /** Custom plate per item (`${objectId}\n${itemKey}`). */
    const plateOf = new Map<string, number>();
    const ik = (objId: string, key: string) => `${objId}\n${key}`;
    // Per-object DOM slots, filled by renderObject().
    const splitSlots = new Map<string, HTMLElement>();
    const childBoxes = new Map<string, HTMLElement>();
    // Plate chip slot per item key; the chip <select>s persist across syncs.
    const chipSlots = new Map<string, HTMLElement>();
    const chipSelects = new Map<string, HTMLSelectElement>();
    const thumbCache = new Map<string, HTMLCanvasElement | null>();

    const partById = new Map(parts.map(p => [p.id, p]));
    const isChecked = (id: string) => checks.some(c => c.dataset.id === id && c.checked);

    /** The mode an object actually exports with (a mode it can't use → whole). */
    function effectiveMode(id: string): ExportSplitMode {
      const m = modeOf.get(id) ?? 'whole';
      const a = analysis.get(id);
      if (m === 'whole' || !a || a === 'pending') return 'whole';
      return (m === 'pieces' ? a.pieces : a.parts) ? m : 'whole';
    }
    const itemsFor = (id: string, mode: ExportSplitMode): ExportSplitItemInfo[] => {
      const a = analysis.get(id);
      if (!a || a === 'pending') return [];
      return (mode === 'pieces' ? a.pieces : mode === 'parts' ? a.parts : null) ?? [];
    };

    interface PickedItem { key: string; objId: string; itemKey: string; name: string; size: [number, number, number] | null; group?: string; splitOf?: string }
    /** Every item the export would write right now, in list order. */
    function currentItems(): PickedItem[] {
      const out: PickedItem[] = [];
      for (const p of parts) {
        if (!isChecked(p.id)) continue;
        const mode = effectiveMode(p.id);
        const a = analysis.get(p.id);
        if (mode === 'whole') {
          out.push({ key: ik(p.id, WHOLE_ITEM_KEY), objId: p.id, itemKey: WHOLE_ITEM_KEY, name: p.name, size: a && a !== 'pending' ? a.size : null, group: p.group });
          continue;
        }
        for (const it of itemsFor(p.id, mode)) {
          const key = ik(p.id, it.key);
          if (excluded.has(key)) continue;
          out.push({ key, objId: p.id, itemKey: it.key, name: `${p.name} · ${it.name}`, size: it.size, group: p.group, splitOf: p.id });
        }
      }
      return out;
    }

    function ensureAnalyzed(id: string): void {
      if (!split || analysis.has(id)) return;
      analysis.set(id, 'pending');
      renderObject(id);
      split.analyze(id).then(
        info => { if (closed) return; analysis.set(id, info); renderObject(id); sync(); },
        () => { if (closed) return; analysis.set(id, null); renderObject(id); sync(); },
      );
    }

    /** A plate chip slot (filled by syncChips) for one item. */
    function chipSlot(key: string): HTMLElement {
      const slot = document.createElement('div');
      slot.className = 'shrink-0';
      chipSlots.set(key, slot);
      return slot;
    }

    /** Draw an item thumbnail into `box` (lazily, so a 100-piece object doesn't block). */
    function fillThumb(box: HTMLElement, objId: string, mode: ExportSplitMode, itemKey: string): void {
      if (!split?.thumbnail) { box.textContent = '◆'; return; }
      const cacheKey = `${objId}\n${mode}\n${itemKey}`;
      const put = (c: HTMLCanvasElement | null) => {
        box.replaceChildren();
        if (c) { c.className = 'w-full h-full'; box.appendChild(c); } else box.textContent = '◆';
      };
      if (thumbCache.has(cacheKey)) { put(thumbCache.get(cacheKey)!); return; }
      setTimeout(() => {
        if (closed || !box.isConnected) return;
        let c: HTMLCanvasElement | null = null;
        try { c = split.thumbnail!(objId, mode, itemKey); } catch { c = null; }
        thumbCache.set(cacheKey, c);
        put(c);
      }, 0);
    }

    /** (Re)draw one object's Split menu and its item rows. */
    function renderObject(id: string): void {
      const slot = splitSlots.get(id);
      const box = childBoxes.get(id);
      if (!slot || !box) return;
      slot.replaceChildren();
      box.replaceChildren();
      for (const key of [...chipSlots.keys()]) if (key.startsWith(`${id}\n`) && key !== ik(id, WHOLE_ITEM_KEY)) chipSlots.delete(key);
      const a = analysis.get(id);
      if (!isChecked(id)) return;
      if (a === 'pending') {
        const s = document.createElement('span');
        s.className = 'text-[10px] text-zinc-500';
        s.textContent = 'Measuring…';
        slot.appendChild(s);
        return;
      }
      if (a === null) {
        const s = document.createElement('span');
        s.className = 'text-[10px] text-amber-400';
        s.textContent = 'No geometry';
        slot.appendChild(s);
        return;
      }
      if (!a || (!a.pieces && !a.parts)) return;
      const sel = document.createElement('select');
      sel.className = 'bg-zinc-900 border border-zinc-700 rounded text-[11px] text-zinc-200 px-1.5 py-0.5 cursor-pointer';
      sel.dataset.splitFor = id;
      sel.setAttribute('aria-label', `Split ${partById.get(id)?.name ?? 'object'}`);
      sel.title = 'Export this object whole, one object per separate piece, or one object per labelled part';
      const addOpt = (value: ExportSplitMode, label: string) => {
        const o = document.createElement('option');
        o.value = value; o.textContent = label;
        sel.appendChild(o);
      };
      addOpt('whole', 'Whole');
      if (a.pieces) addOpt('pieces', `Pieces (${a.pieces.length})`);
      if (a.parts) addOpt('parts', `Parts (${a.parts.length})`);
      const mode = effectiveMode(id);
      sel.value = mode;
      sel.addEventListener('change', () => {
        const m = sel.value as ExportSplitMode;
        modeOf.set(id, m);
        rememberedSplit.set(id, m);
        renderObject(id);
        sync();
      });
      slot.appendChild(sel);
      if (mode === 'whole') return;

      for (const it of itemsFor(id, mode)) {
        const key = ik(id, it.key);
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2';
        row.dataset.exportItem = it.name;
        const lbl = document.createElement('label');
        lbl.className = 'flex flex-1 min-w-0 items-center gap-2 py-1 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !excluded.has(key);
        cb.className = 'w-3.5 h-3.5 accent-blue-500 cursor-pointer shrink-0';
        cb.setAttribute('aria-label', `Include ${it.name}`);
        cb.addEventListener('change', () => {
          if (cb.checked) excluded.delete(key); else excluded.add(key);
          sync();
        });
        const thumb = document.createElement('div');
        thumb.className = 'w-8 h-8 rounded bg-zinc-900 border border-zinc-700 shrink-0 overflow-hidden flex items-center justify-center text-[10px] text-zinc-600';
        fillThumb(thumb, id, mode, it.key);
        const meta = document.createElement('div');
        meta.className = 'flex-1 min-w-0';
        const nm = document.createElement('div');
        nm.className = 'text-[11px] text-zinc-200 truncate';
        nm.textContent = it.name;
        const dims = document.createElement('div');
        dims.className = 'text-[10px] text-zinc-500 tabular-nums';
        dims.textContent = fmtSize(it.size);
        meta.append(nm, dims);
        if (it.fused) {
          const warn = document.createElement('div');
          warn.className = 'text-[10px] text-amber-400 leading-snug';
          warn.textContent = `⚠ ${it.labels.map(l => `"${l}"`).join(' and ')} share one solid, so they stay together`;
          meta.appendChild(warn);
        }
        lbl.append(cb, thumb, meta);
        row.append(lbl, chipSlot(key));
        box.appendChild(row);
      }
    }

    /** One selectable part row (a <label> so a click anywhere toggles it). When
     *  `indented`, it's a group member and hugs the group's left rule. */
    function buildPartRow(part: ExportPartChoice, indented: boolean): HTMLInputElement {
      const wrap = document.createElement('div');
      wrap.className = 'flex flex-col' + (indented ? ' ml-2' : '');
      wrap.dataset.exportObject = part.name;
      const line = document.createElement('div');
      line.className = 'flex items-center gap-2';
      const row = document.createElement('label');
      row.className = 'flex flex-1 min-w-0 items-center gap-3 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = pre?.ids ? pre.ids.includes(part.id) : part.id === activePartId;
      cb.className = 'w-4 h-4 accent-blue-500 cursor-pointer shrink-0';
      cb.dataset.id = part.id;
      checks.push(cb);

      // Thumbnail (or a placeholder square).
      const thumb = document.createElement('div');
      thumb.className = 'w-12 h-12 rounded bg-zinc-900 border border-zinc-700 shrink-0 overflow-hidden flex items-center justify-center';
      if (part.thumbnail) {
        const url = URL.createObjectURL(part.thumbnail);
        objectUrls.push(url);
        const img = document.createElement('img');
        img.src = url;
        img.className = 'w-full h-full object-contain';
        img.alt = `${part.name} preview`;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '—';
        thumb.classList.add('text-zinc-600', 'text-xs');
      }

      const meta = document.createElement('div');
      meta.className = 'flex-1 min-w-0';
      const nameEl = document.createElement('div');
      nameEl.className = 'text-xs text-zinc-200 font-medium truncate';
      nameEl.textContent = part.name;
      meta.appendChild(nameEl);
      if (part.id === activePartId) {
        const badge = document.createElement('div');
        badge.className = 'text-[10px] text-blue-400';
        badge.textContent = 'Currently viewing';
        meta.appendChild(badge);
      }

      row.append(cb, thumb, meta);
      const splitSlot = document.createElement('div');
      splitSlot.className = 'shrink-0';
      splitSlots.set(part.id, splitSlot);
      line.append(row, splitSlot, chipSlot(ik(part.id, WHOLE_ITEM_KEY)));
      const childBox = document.createElement('div');
      childBox.className = 'flex flex-col ml-7 border-l border-zinc-700/70 pl-3';
      childBoxes.set(part.id, childBox);
      wrap.append(line, childBox);
      list.appendChild(wrap);
      return cb;
    }

    // Render parts threaded by group: ungrouped parts as flat rows, grouped
    // parts under a collapsible-style header carrying a whole-group checkbox.
    for (const node of buildPartTree(parts)) {
      if (node.kind === 'part') {
        buildPartRow(node.part, false);
        continue;
      }

      // Group header with a tri-state checkbox that selects/deselects the group.
      // Appended BEFORE its members so buildPartRow's appends land underneath it.
      const header = document.createElement('label');
      header.className = 'group flex items-center gap-2 py-1 px-2 -mx-2 mt-1 rounded cursor-pointer hover:bg-zinc-700/30';
      header.dataset.exportGroup = node.name;

      const gcb = document.createElement('input');
      gcb.type = 'checkbox';
      gcb.className = 'w-4 h-4 accent-blue-500 cursor-pointer shrink-0';
      gcb.setAttribute('aria-label', `Select all objects in ${node.name}`);

      const folder = document.createElement('span');
      folder.className = 'text-xs leading-none';
      folder.textContent = '📂';

      const gname = document.createElement('span');
      gname.className = 'flex-1 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-300';
      gname.textContent = node.name;

      const gcount = document.createElement('span');
      gcount.className = 'shrink-0 text-[10px] text-zinc-500 tabular-nums';

      header.append(gcb, folder, gname, gcount);
      list.appendChild(header);

      const memberCbs = node.parts.map(p => buildPartRow(p, true));

      gcb.addEventListener('change', () => {
        for (const c of memberCbs) c.checked = gcb.checked;
        onChecksChanged();
      });

      groupSyncers.push(() => {
        const on = memberCbs.filter(c => c.checked).length;
        gcb.checked = on === memberCbs.length;
        gcb.indeterminate = on > 0 && on < memberCbs.length;
        gcount.textContent = `${on}/${memberCbs.length}`;
      });
    }

    // ── Options pane: Bambu printer settings + plate layout, and (for any 3MF)
    //    the packing strategy. Rendered into the right-hand pane. ──
    let printerSel: HTMLSelectElement | null = null;
    let nozzleSel: HTMLSelectElement | null = null;
    let filamentSel: HTMLSelectElement | null = null;
    // Selected plate layout (Bambu only). Default: one part per plate.
    let plateLayout: BambuPlateLayout = (pre?.applied.plateLayout as BambuPlateLayout | undefined) ?? 'separate';
    // Selected packing strategy (any 3MF). Default: compact centred grid.
    let packStrategy: PackStrategy = (pre?.applied.packStrategy as PackStrategy | undefined) ?? DEFAULT_PACK_STRATEGY;
    const hasGroups = groupNames(parts).length > 0;

    /** A titled radio group in the options pane; each option carries a one-line hint.
     *  `divider` draws a top rule + spacing (used to separate sections). Selecting a
     *  radio invokes `onPick`. */
    const mkRadioGroup = <T extends string>(
      name: string, heading: string, current: T,
      options: { value: T; label: string; hint: string }[],
      onPick: (v: T) => void,
      divider: boolean,
    ) => {
      const wrap = document.createElement('div');
      wrap.className = divider ? 'mt-4 pt-3 border-t border-zinc-700' : 'mt-1';
      const head = document.createElement('div');
      head.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5';
      head.textContent = heading;
      wrap.appendChild(head);
      for (const opt of options) {
        const row = document.createElement('label');
        row.className = 'flex items-start gap-2 py-1 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/30';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = name;
        radio.value = opt.value;
        radio.checked = opt.value === current;
        radio.className = 'mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer shrink-0';
        radio.addEventListener('change', () => { if (radio.checked) onPick(opt.value); });
        const text = document.createElement('div');
        text.className = 'flex-1 min-w-0';
        const lbl = document.createElement('div');
        lbl.className = 'text-xs text-zinc-200';
        lbl.textContent = opt.label;
        const hint = document.createElement('div');
        hint.className = 'text-[10px] text-zinc-500 leading-snug';
        hint.textContent = opt.hint;
        text.append(lbl, hint);
        row.append(radio, text);
        wrap.appendChild(row);
      }
      optionsParent.appendChild(wrap);
    };

    let previewBox: HTMLElement | null = null;
    /** The plates the preview last showed (item keys per plate), for seeding Custom. */
    let lastPlates: string[][] = [];

    if (bambu) {
      const mkSelect = (label: string, choices: { value: string; label: string }[], def: string): HTMLSelectElement => {
        const wrap = document.createElement('label');
        wrap.className = 'flex flex-col gap-1 mt-2';
        const lbl = document.createElement('span');
        lbl.className = 'text-[11px] text-zinc-300';
        lbl.textContent = label;
        const sel = document.createElement('select');
        sel.className = 'w-full bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1 cursor-pointer';
        for (const c of choices) {
          const o = document.createElement('option');
          o.value = c.value; o.textContent = c.label;
          if (c.value === def) o.selected = true;
          sel.appendChild(o);
        }
        wrap.append(lbl, sel);
        optionsParent.appendChild(wrap);
        return sel;
      };
      const h = document.createElement('div');
      h.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-0.5';
      h.textContent = 'Bambu Studio settings';
      optionsParent.appendChild(h);
      printerSel = mkSelect('Printer', bambu.printers.map(p => ({ value: p.id, label: p.label })), (pre?.applied.printer as string | undefined) ?? bambu.defaultPrinter);
      nozzleSel = mkSelect('Nozzle', bambu.nozzles.map(n => ({ value: n, label: `${n} mm` })), (pre?.applied.nozzle as string | undefined) ?? bambu.defaultNozzle);
      filamentSel = mkSelect('Filament', bambu.filaments.map(f => ({ value: f.id, label: f.label })), (pre?.applied.filament as string | undefined) ?? bambu.defaultFilament);
      printerSel.addEventListener('change', () => sync());

      // ── Plate layout: how the selected parts spread across build plates ──
      // "Group per plate" appears when the session has groups or objects can be
      // split (a split object's items count as a group of their own).
      const layoutOpts: { value: BambuPlateLayout; label: string; hint: string }[] = [
        { value: 'separate', label: 'Separate plates', hint: split ? 'One object (or split piece) per build plate.' : 'One object per build plate.' },
        { value: 'grid', label: 'Packed together', hint: 'All objects packed to fit the plate, spilling onto more plates as needed.' },
      ];
      if (hasGroups || split) {
        layoutOpts.push({
          value: 'group', label: 'Group per plate',
          hint: split
            ? 'Each group, and each split object, packed onto its own plate(s); other objects print separately.'
            : 'Each group packed onto its own plate(s); ungrouped objects print separately.',
        });
      }
      layoutOpts.push({ value: 'custom', label: 'Custom', hint: 'Pick a plate for each object or piece with the Plate menu on its row.' });
      mkRadioGroup('bambu-plate-layout', 'Plate layout', plateLayout, layoutOpts, v => {
        if (v === 'custom') seedCustomPlates();
        plateLayout = v;
        sync();
      }, true);
    }

    // ── Packing: how parts sharing a plate (Bambu) or the single generic model are
    //    spatially arranged. Shown for any 3MF export (Bambu + generic). ──
    if (showPacking) {
      const packOpts: { value: PackStrategy; label: string; hint: string }[] = [
        { value: 'grid', label: 'Centered grid', hint: bambu ? 'Compact cluster centered on the plate (avoids the non-printable edges).' : 'Compact, roughly-square block centered on the origin.' },
        { value: 'horizontal', label: 'Horizontal rows', hint: 'Fill left-to-right across the full width.' },
        { value: 'vertical', label: 'Vertical columns', hint: 'Stack front-to-back down the full depth.' },
      ];
      mkRadioGroup('export-pack-strategy', 'Packing', packStrategy, packOpts, v => { packStrategy = v; sync(); }, !!bambu);
    }

    if (bambu) {
      const wrap = document.createElement('div');
      wrap.className = 'mt-4 pt-3 border-t border-zinc-700';
      const h = document.createElement('div');
      h.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-400 mb-1.5';
      h.textContent = 'Plates';
      previewBox = document.createElement('div');
      previewBox.className = 'flex flex-col gap-1.5';
      previewBox.dataset.platePreview = '';
      wrap.append(h, previewBox);
      optionsParent.appendChild(wrap);
    }

    const printerBed = (): [number, number] => {
      const p = bambu?.printers.find(x => x.id === printerSel?.value);
      return p?.bed ?? [256, 256];
    };

    /** Lay the measured items out exactly as the exporter will. */
    function planPlates(items: PickedItem[]): { plates: { members: number[]; centers: { cx: number; cy: number }[] }[]; measured: PickedItem[] } {
      const measured = items.filter(i => i.size);
      const plates = layoutBambuPlates(
        measured.map(i => ({
          group: i.group, splitOf: i.splitOf,
          plate: plateLayout === 'custom' ? plateOf.get(i.key) : undefined,
          w: i.size![0], d: i.size![1],
        })),
        plateLayout, printerBed(), DEFAULT_GRID_GAP_MM, packStrategy,
      );
      return { plates, measured };
    }

    /** Custom starts from what the previous layout showed, so switching to it
     *  changes nothing until the user moves something. */
    function seedCustomPlates(): void {
      lastPlates.forEach((keys, i) => { for (const k of keys) if (!plateOf.has(k)) plateOf.set(k, i + 1); });
    }

    /** Give every current item without a custom plate a new plate of its own. */
    function fillCustomPlates(items: PickedItem[]): void {
      let max = 0;
      for (const i of items) max = Math.max(max, plateOf.get(i.key) ?? 0);
      for (const i of items) if (!plateOf.has(i.key)) plateOf.set(i.key, ++max);
    }

    /** Show / update each row's Plate chip (Custom layout only). */
    function syncChips(items: PickedItem[]): void {
      const show = !!bambu && plateLayout === 'custom';
      const current = new Set(items.map(i => i.key));
      let max = 0;
      if (show) for (const i of items) max = Math.max(max, plateOf.get(i.key) ?? 0);
      for (const [key, slot] of chipSlots) {
        if (!show || !current.has(key)) { slot.replaceChildren(); continue; }
        let sel = chipSelects.get(key);
        if (!sel) {
          sel = document.createElement('select');
          sel.className = 'bg-zinc-900 border border-zinc-700 rounded text-[11px] text-zinc-200 px-1 py-0.5 cursor-pointer';
          sel.dataset.plateFor = key.replace('\n', '/');
          const name = items.find(i => i.key === key)?.name ?? 'item';
          sel.setAttribute('aria-label', `Plate for ${name}`);
          const s = sel;
          s.addEventListener('change', () => { plateOf.set(key, Number(s.value)); sync(); });
          chipSelects.set(key, sel);
        }
        // Plates 1..max, plus one more (a new, empty plate).
        if (sel.options.length !== max + 1) {
          sel.replaceChildren();
          for (let n = 1; n <= max + 1; n++) {
            const o = document.createElement('option');
            o.value = String(n);
            o.textContent = n <= max ? `Plate ${n}` : 'New plate';
            sel.appendChild(o);
          }
        }
        sel.value = String(plateOf.get(key) ?? 1);
        if (sel.parentElement !== slot) slot.replaceChildren(sel);
      }
    }

    const colorFor = (objId: string) => {
      const i = parts.findIndex(p => p.id === objId);
      return `hsl(${(i * 137.508) % 360} 55% 55%)`;
    };

    /** Draw the plates preview (Bambu): one bed outline per plate with each
     *  item's footprint where the exporter will put it. */
    function renderPreview(items: PickedItem[]): number {
      if (!previewBox) return 0;
      previewBox.replaceChildren();
      const { plates, measured } = planPlates(items);
      lastPlates = plates.map(pl => pl.members.map(k => measured[k].key));
      const pending = items.length - measured.length;
      const [bw, bh] = printerBed();
      const MAX_SHOWN = 24;
      const grid = document.createElement('div');
      grid.className = 'flex flex-wrap gap-1.5';
      const ns = 'http://www.w3.org/2000/svg';
      plates.slice(0, MAX_SHOWN).forEach((pl, idx) => {
        const fig = document.createElement('figure');
        fig.className = 'flex flex-col items-center gap-0.5';
        fig.dataset.plate = String(idx + 1);
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', `0 0 ${bw} ${bh}`);
        svg.setAttribute('width', '96');
        svg.setAttribute('height', String(Math.round(96 * bh / bw)));
        svg.setAttribute('role', 'img');
        const names = pl.members.map(k => measured[k].name);
        svg.setAttribute('aria-label', `Plate ${idx + 1}: ${names.join(', ')}`);
        const bed = document.createElementNS(ns, 'rect');
        bed.setAttribute('x', '0'); bed.setAttribute('y', '0');
        bed.setAttribute('width', String(bw)); bed.setAttribute('height', String(bh));
        bed.setAttribute('rx', String(Math.min(bw, bh) * 0.04));
        bed.setAttribute('class', 'fill-zinc-900 stroke-zinc-600');
        bed.setAttribute('stroke-width', String(Math.max(bw, bh) * 0.012));
        svg.appendChild(bed);
        pl.members.forEach((k, j) => {
          const it = measured[k];
          const [w, d] = it.size!;
          const { cx, cy } = pl.centers[j];
          // True scale, but never smaller than a few pixels so a small part
          // on a big bed still shows up.
          const dw = Math.max(w, bw * 0.035), dd = Math.max(d, bh * 0.035);
          const r = document.createElementNS(ns, 'rect');
          r.setAttribute('x', String(cx - dw / 2));
          // Bed Y runs back-to-front; draw the front edge at the bottom.
          r.setAttribute('y', String(bh - cy - dd / 2));
          r.setAttribute('width', String(dw));
          r.setAttribute('height', String(dd));
          r.setAttribute('fill', colorFor(it.objId));
          r.setAttribute('fill-opacity', '0.85');
          r.setAttribute('stroke', 'white');
          r.setAttribute('stroke-opacity', '0.6');
          r.setAttribute('stroke-width', String(Math.max(bw, bh) * 0.006));
          const t = document.createElementNS(ns, 'title');
          t.textContent = `${it.name} — ${fmtSize(it.size!)}`;
          r.appendChild(t);
          svg.appendChild(r);
        });
        const cap = document.createElement('figcaption');
        cap.className = 'text-[10px] text-zinc-500 tabular-nums';
        cap.textContent = `${idx + 1} · ${pl.members.length}`;
        fig.append(svg, cap);
        grid.appendChild(fig);
      });
      previewBox.appendChild(grid);
      const note = (text: string, warn = false) => {
        const el = document.createElement('div');
        el.className = `text-[10px] leading-snug ${warn ? 'text-amber-400' : 'text-zinc-500'}`;
        el.textContent = text;
        previewBox!.appendChild(el);
      };
      if (plates.length > MAX_SHOWN) note(`+ ${plates.length - MAX_SHOWN} more plates`);
      if (pending > 0) note(`Measuring ${pending} object${pending === 1 ? '' : 's'}…`);
      const tooBig = measured.filter(i => i.size![0] > bw || i.size![1] > bh);
      if (tooBig.length) note(`⚠ ${tooBig.map(i => `"${i.name}"`).slice(0, 3).join(', ')}${tooBig.length > 3 ? '…' : ''} ${tooBig.length === 1 ? 'is' : 'are'} larger than the ${bw} × ${bh} bed`, true);
      if (plateLayout === 'custom') {
        const bins = new Set(measured.map(i => plateOf.get(i.key)));
        if (plates.length > bins.size) note('A plate that doesn’t fit the bed spills onto the next one.', true);
      }
      return plates.length;
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = BUTTON_PRIMARY;
    shell.footer.appendChild(exportBtn);

    function selectedIds(): string[] {
      return checks.filter(c => c.checked).map(c => c.dataset.id!).filter(Boolean);
    }

    /** The split / excluded / plates maps for the result and the AI state. */
    function splitState(byName: boolean) {
      const ids = selectedIds();
      const label = (id: string) => (byName ? partById.get(id)?.name ?? id : id);
      const splits: Record<string, ExportSplitMode> = {};
      const excludedOut: Record<string, string[]> = {};
      for (const id of ids) {
        const m = effectiveMode(id);
        if (m === 'whole') continue;
        splits[label(id)] = m;
        const out = itemsFor(id, m).filter(it => excluded.has(ik(id, it.key))).map(it => (byName ? it.name : it.key));
        if (out.length) excludedOut[label(id)] = out;
      }
      return { splits, excluded: excludedOut };
    }

    function sync() {
      const ids = selectedIds();
      const items = currentItems();
      const anySplit = items.some(i => i.splitOf);
      heading.textContent = `Objects (${ids.length} of ${parts.length} selected)`;
      if (bambu && plateLayout === 'custom') fillCustomPlates(items);
      syncChips(items);
      const plates = renderPreview(items);
      const n = items.length;
      const what = anySplit ? `${n} item${n === 1 ? '' : 's'}` : `${n} objects`;
      exportBtn.textContent = anySplit || n > 1
        ? `Export ${what}${bambu && plates > 1 ? ` on ${plates} plates` : ''}`
        : 'Export';
      exportBtn.disabled = n === 0;
      exportBtn.classList.toggle('opacity-40', n === 0);
      exportBtn.classList.toggle('cursor-default', n === 0);
      toggleAll.textContent = checks.every(c => c.checked) ? 'Select none' : 'Select all';
      for (const s of groupSyncers) s();
    }

    /** After object checkboxes change: measure newly ticked objects and
     *  show / hide their split controls. */
    function onChecksChanged() {
      for (const p of parts) {
        if (isChecked(p.id)) ensureAnalyzed(p.id);
        renderObject(p.id);
      }
      sync();
    }

    function confirm() {
      const items = currentItems();
      if (items.length === 0) return;
      const ids = selectedIds().filter(id => items.some(i => i.objId === id));
      const { splits, excluded: excludedOut } = splitState(false);
      let plates: Record<string, Record<string, number>> | undefined;
      if (bambu && plateLayout === 'custom') {
        plates = {};
        for (const i of items) (plates[i.objId] ??= {})[i.itemKey] = plateOf.get(i.key) ?? 1;
      }
      result = {
        partIds: ids,
        printer: printerSel?.value,
        nozzle: nozzleSel?.value,
        filament: filamentSel?.value,
        ...(bambu ? { plateLayout } : {}),
        ...(showPacking ? { packStrategy } : {}),
        ...(Object.keys(splits).length ? { splits } : {}),
        ...(Object.keys(excludedOut).length ? { excluded: excludedOut } : {}),
        ...(plates ? { plates } : {}),
      };
      shell.close();
    }

    toggleAll.addEventListener('click', () => {
      const allChecked = checks.every(c => c.checked);
      for (const c of checks) c.checked = !allChecked;
      onChecksChanged();
    });
    for (const c of checks) c.addEventListener('change', onChecksChanged);
    exportBtn.addEventListener('click', confirm);

    for (const p of parts) if (isChecked(p.id)) ensureAnalyzed(p.id);
    sync();
    // Enter-to-confirm; an AI-staged open is guarded (no Export focus, Enter
    // arms only after the user interacts inside the picker).
    disarmConfirm = armDialogConfirm({ within: shell.body, primary: exportBtn, onConfirm: confirm, guarded: !!staged });
    openPicker = {
      state: () => {
        const { splits, excluded: excludedOut } = splitState(true);
        const items = currentItems();
        return {
          // The export this picker belongs to (export-objects' `format` key).
          format: bambu ? '3mf-bambu' : showPacking ? '3mf' : (/\bto (\w+)$/.exec(title)?.[1]?.toLowerCase() ?? null),
          objects: selectedIds().map(id => parts.find(x => x.id === id)?.name ?? id),
          ...(printerSel ? { printer: printerSel.value } : {}),
          ...(nozzleSel ? { nozzle: nozzleSel.value } : {}),
          ...(filamentSel ? { filament: filamentSel.value } : {}),
          ...(bambu ? { plateLayout } : {}),
          ...(showPacking ? { packStrategy } : {}),
          ...(split ? { split: splits, excluded: excludedOut, items: items.length } : {}),
          ...(bambu ? { plates: lastPlates.length } : {}),
          ...(analysis.size && [...analysis.values()].some(v => v === 'pending') ? { measuring: true } : {}),
        };
      },
      close: () => { result = null; shell.close(); },
    };
    if (staged && pre) staged.settle({ applied: pre.applied, ignored: pre.ignored });
  });
}
