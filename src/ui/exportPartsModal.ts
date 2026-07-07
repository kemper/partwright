// Part-selection modal for multi-part exports (3MF / OBJ / STL / GLB). Lets the
// user pick which Session Parts to bundle into one file, with a thumbnail preview
// of each. The currently-viewed part is preselected; a Select-all / Select-none
// toggle handles assemblies with many parts.
//
// Resolves with the chosen part ids (in list order) when the user confirms, or
// null if they cancel / dismiss. Only the export caller decides what to do with
// the selection — this modal is pure UI; the format-specific title/description
// are passed in by the caller.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { buildPartTree, groupNames } from './partTree';
import type { BambuPlateLayout } from '../export/threemfProject';

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
  printers: { id: string; label: string }[];
  defaultPrinter: string;
  nozzles: string[];
  defaultNozzle: string;
  filaments: { id: string; label: string }[];
  defaultFilament: string;
}

/** Modal result: the chosen part ids plus (for Bambu) the printer/nozzle/filament
 *  and the plate layout. */
export interface ExportPartsResult {
  partIds: string[];
  printer?: string;
  nozzle?: string;
  filament?: string;
  /** Bambu only — how selected parts are distributed across build plates. */
  plateLayout?: BambuPlateLayout;
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
}

/**
 * Show the multi-part export part picker. Returns the selected part ids (in list
 * order) plus the Bambu printer/nozzle (when those controls are shown), or null on
 * cancel. The caller supplies the format-specific title + description via `opts`.
 */
export function showExportPartsModal(
  parts: ExportPartChoice[],
  opts: ExportPartsModalOptions,
): Promise<ExportPartsResult | null> {
  const { activePartId, title, description, bambu } = opts;
  return new Promise((resolve) => {
    let result: ExportPartsResult | null = null;
    // Track object URLs so we can revoke them on teardown (no GPU/blob leak).
    const objectUrls: string[] = [];

    const shell = createModalShell({
      title,
      scrollable: true,
      onClose: () => {
        document.removeEventListener('keydown', onEnter);
        for (const url of objectUrls) URL.revokeObjectURL(url);
        resolve(result);
      },
    });

    const sub = document.createElement('p');
    sub.className = 'text-[11px] text-zinc-400 leading-relaxed';
    sub.textContent = description;
    shell.body.appendChild(sub);

    // Header row with the count + select-all toggle.
    const head = document.createElement('div');
    head.className = 'flex items-center justify-between mt-1';
    const heading = document.createElement('div');
    heading.className = 'text-xs text-zinc-200 font-medium';
    const toggleAll = document.createElement('button');
    toggleAll.type = 'button';
    toggleAll.className = 'text-[10px] text-blue-400 hover:text-blue-300';
    head.append(heading, toggleAll);
    shell.body.appendChild(head);

    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1 mt-1';
    shell.body.appendChild(list);

    // The checkboxes ARE the selection state (source of truth for selectedIds).
    const checks: HTMLInputElement[] = [];
    // Per-group header updaters, run from sync() to reflect their members'
    // checked state as checked / indeterminate / unchecked.
    const groupSyncers: (() => void)[] = [];

    /** One selectable part row (a <label> so a click anywhere toggles it). When
     *  `indented`, it's a group member and hugs the group's left rule. */
    function buildPartRow(part: ExportPartChoice, indented: boolean): HTMLInputElement {
      const row = document.createElement('label');
      row.className = 'flex items-center gap-3 py-1.5 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/40'
        + (indented ? ' ml-2' : '');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = part.id === activePartId;
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
      list.appendChild(row);
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
      gcb.setAttribute('aria-label', `Select all parts in ${node.name}`);

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
        sync();
      });

      groupSyncers.push(() => {
        const on = memberCbs.filter(c => c.checked).length;
        gcb.checked = on === memberCbs.length;
        gcb.indeterminate = on > 0 && on < memberCbs.length;
        gcount.textContent = `${on}/${memberCbs.length}`;
      });
    }

    // ── Bambu printer / nozzle / filament controls (only for the Bambu export) ──
    let printerSel: HTMLSelectElement | null = null;
    let nozzleSel: HTMLSelectElement | null = null;
    let filamentSel: HTMLSelectElement | null = null;
    // Selected plate layout (Bambu only). Default: one part per plate.
    let plateLayout: BambuPlateLayout = 'separate';
    const hasGroups = groupNames(parts).length > 0;
    if (bambu) {
      const mkSelect = (label: string, choices: { value: string; label: string }[], def: string): HTMLSelectElement => {
        const wrap = document.createElement('label');
        wrap.className = 'flex items-center justify-between gap-3 mt-2';
        const lbl = document.createElement('span');
        lbl.className = 'text-[11px] text-zinc-300';
        lbl.textContent = label;
        const sel = document.createElement('select');
        sel.className = 'flex-1 max-w-[60%] bg-zinc-900 border border-zinc-700 rounded text-xs text-zinc-200 px-2 py-1 cursor-pointer';
        for (const c of choices) {
          const o = document.createElement('option');
          o.value = c.value; o.textContent = c.label;
          if (c.value === def) o.selected = true;
          sel.appendChild(o);
        }
        wrap.append(lbl, sel);
        shell.body.appendChild(wrap);
        return sel;
      };
      const div = document.createElement('div');
      div.className = 'mt-3 pt-3 border-t border-zinc-700';
      const h = document.createElement('div');
      h.className = 'text-[11px] text-zinc-400 mb-1';
      h.textContent = 'Bambu Studio settings';
      div.appendChild(h);
      shell.body.appendChild(div);
      printerSel = mkSelect('Printer', bambu.printers.map(p => ({ value: p.id, label: p.label })), bambu.defaultPrinter);
      nozzleSel = mkSelect('Nozzle', bambu.nozzles.map(n => ({ value: n, label: `${n} mm` })), bambu.defaultNozzle);
      filamentSel = mkSelect('Filament', bambu.filaments.map(f => ({ value: f.id, label: f.label })), bambu.defaultFilament);

      // ── Plate layout: how the selected parts spread across build plates ──
      // Each option is a labelled radio with a one-line hint. The "group per plate"
      // option only appears when the session actually has groups (else it's a no-op
      // that behaves like "separate"). Radios drive `plateLayout`.
      const layoutWrap = document.createElement('div');
      layoutWrap.className = 'mt-3 pt-3 border-t border-zinc-700';
      const layoutHead = document.createElement('div');
      layoutHead.className = 'text-[11px] text-zinc-400 mb-1.5';
      layoutHead.textContent = 'Plate layout';
      layoutWrap.appendChild(layoutHead);

      const layoutOpts: { value: BambuPlateLayout; label: string; hint: string }[] = [
        { value: 'separate', label: 'Separate plates', hint: 'One part per build plate.' },
        { value: 'grid', label: 'Single plate (grid)', hint: 'All selected parts arranged on one plate.' },
      ];
      if (hasGroups) {
        layoutOpts.push({ value: 'group', label: 'Group per plate', hint: 'Each group on its own plate; ungrouped parts print separately.' });
      }
      for (const opt of layoutOpts) {
        const row = document.createElement('label');
        row.className = 'flex items-start gap-2 py-1 px-2 -mx-2 rounded cursor-pointer hover:bg-zinc-700/30';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'bambu-plate-layout';
        radio.value = opt.value;
        radio.checked = opt.value === plateLayout;
        radio.className = 'mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer shrink-0';
        radio.addEventListener('change', () => { if (radio.checked) plateLayout = opt.value; });
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
        layoutWrap.appendChild(row);
      }
      shell.body.appendChild(layoutWrap);
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

    function sync() {
      const n = selectedIds().length;
      heading.textContent = `Parts (${n} of ${parts.length} selected)`;
      exportBtn.textContent = n > 1 ? `Export ${n} parts` : 'Export';
      exportBtn.disabled = n === 0;
      exportBtn.classList.toggle('opacity-40', n === 0);
      exportBtn.classList.toggle('cursor-default', n === 0);
      toggleAll.textContent = checks.every(c => c.checked) ? 'Select none' : 'Select all';
      for (const s of groupSyncers) s();
    }

    function confirm() {
      const ids = selectedIds();
      if (ids.length === 0) return;
      result = {
        partIds: ids,
        printer: printerSel?.value,
        nozzle: nozzleSel?.value,
        filament: filamentSel?.value,
        ...(bambu ? { plateLayout } : {}),
      };
      shell.close();
    }

    toggleAll.addEventListener('click', () => {
      const allChecked = checks.every(c => c.checked);
      for (const c of checks) c.checked = !allChecked;
      sync();
    });
    for (const c of checks) c.addEventListener('change', sync);
    exportBtn.addEventListener('click', confirm);

    function onEnter(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
    }
    document.addEventListener('keydown', onEnter);

    sync();
    exportBtn.focus();
  });
}
