// Modal that lets the user choose what to embed in a `.partwright.json`
// session export. Defaults match the historical behavior — everything
// session-bound is on, thumbnails off (importer regenerates from code).

import type { ExportOptions } from '../storage/sessionManager';
import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';
import { createToolNote, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';
import { armDialogConfirm } from './dialogConfirmGuard';

/** The include-flag keys an `openTool('export-session')` prefill may set. */
export const EXPORT_SESSION_FLAGS = ['includeThumbnails', 'includeAnnotations', 'includeNotes', 'includeColorRegions', 'includeChat'] as const;

/** Pre-set values for the NEXT session-export dialog. It only opens staged —
 *  the user still clicks Export. */
export interface ExportOptionsPrefill extends Partial<Record<(typeof EXPORT_SESSION_FLAGS)[number], boolean>> {
  /** Version indices to keep in the file (default: all). */
  versions?: number[];
  note?: string;
  source?: ToolOpenContext['source'];
}

let stagedPrefill: { prefill: ExportOptionsPrefill; settle: (r: ToolOpenResult) => void } | null = null;
let openDialog: { state: () => Record<string, unknown>; close: () => void } | null = null;

/** Stage a prefill for the next showExportOptionsDialog; resolves when it opens
 *  ({applied, ignored}) or rejects the prefill ({error} — nothing shows). */
export function stageExportOptionsPrefill(prefill: ExportOptionsPrefill): Promise<ToolOpenResult> {
  stagedPrefill?.settle({ error: 'superseded by a newer prefill' });
  return new Promise(resolve => { stagedPrefill = { prefill, settle: resolve }; });
}
export function clearExportOptionsPrefill(reason: string): void {
  if (!stagedPrefill) return;
  stagedPrefill.settle({ error: reason });
  stagedPrefill = null;
}
export function isExportOptionsOpen(): boolean { return openDialog !== null; }
export function getExportOptionsState(): Record<string, unknown> | null { return openDialog?.state() ?? null; }
export function closeExportOptionsDialog(): void { openDialog?.close(); }

/** Keys of {@link ExportOptions} that map to a simple on/off checkbox. */
type BooleanOptionKey = Exclude<keyof ExportOptions, 'versionIndices'>;

interface OptionDef {
  key: BooleanOptionKey;
  label: string;
  description: string;
  defaultValue: boolean;
}

const OPTIONS: OptionDef[] = [
  {
    key: 'includeThumbnails',
    label: 'Thumbnail',
    description: 'Embeds the version preview image. Required for catalog entries; otherwise the importer regenerates it from code.',
    defaultValue: false,
  },
  {
    key: 'includeAnnotations',
    label: 'Annotations',
    description: 'Freehand strokes and pinned text labels drawn on the model.',
    defaultValue: true,
  },
  {
    key: 'includeNotes',
    label: 'Notes',
    description: 'Session-level design log entries (decisions, requirements, measurements).',
    defaultValue: true,
  },
  {
    key: 'includeColorRegions',
    label: 'Color regions',
    description: 'Per-face color metadata (used for multi-color 3MF / OBJ exports).',
    defaultValue: true,
  },
  {
    key: 'includeChat',
    label: 'Chat history',
    description: 'The AI conversation for this session — text, tool calls, and results. Restored on import.',
    defaultValue: true,
  },
];

/**
 * Show the export options modal. Resolves with the selected options when the
 * user confirms, or null if they cancel / dismiss.
 *
 * @param versions  The session's versions (index + label). When two or more are
 *   present, a checklist lets the user prune which versions go into the file —
 *   this only affects the export, nothing is deleted from storage.
 */
export function showExportOptionsDialog(
  versions: { index: number; label: string }[] = [],
): Promise<ExportOptions | null> {
  return new Promise((resolve) => {
    // A staged openTool prefill is validated against the real version list
    // first; a bad one never shows the dialog.
    const staged = stagedPrefill;
    stagedPrefill = null;
    const applied: Record<string, unknown> = {};
    const ignored: string[] = [];
    if (staged?.prefill.versions) {
      const known = new Set(versions.map(v => v.index));
      const bad = staged.prefill.versions.filter(i => !known.has(i));
      if (bad.length || staged.prefill.versions.length === 0) {
        staged.settle({ error: staged.prefill.versions.length === 0 ? 'versions must list at least one version' : `versions: no version ${bad.join(', ')} (versions: ${versions.map(v => v.index).join(', ') || 'none'})` });
        resolve(null);
        return;
      }
      if (versions.length > 1) applied.versions = [...staged.prefill.versions]; else ignored.push('versions');
    }
    let result: ExportOptions | null = null;
    let disarmConfirm: () => void = () => {};
    const shell = createModalShell({
      title: 'Export session',
      scrollable: true,
      onClose: () => {
        disarmConfirm();
        openDialog = null;
        resolve(result);
      },
    });
    if (staged?.prefill.note) shell.body.appendChild(createToolNote(staged.prefill.note, staged.prefill.source));

    const sub = document.createElement('p');
    sub.className = 'text-[11px] text-zinc-400 leading-relaxed';
    sub.textContent = 'Choose what to include in the .partwright.json file.';
    shell.body.appendChild(sub);

    const checkboxes = new Map<BooleanOptionKey, HTMLInputElement>();

    for (const opt of OPTIONS) {
      const row = document.createElement('label');
      row.className = 'flex items-start gap-2.5 py-1.5 cursor-pointer hover:bg-zinc-700/40 rounded px-2 -mx-2';

      const input = document.createElement('input');
      input.type = 'checkbox';
      const stagedFlag = staged?.prefill[opt.key as (typeof EXPORT_SESSION_FLAGS)[number]];
      input.checked = stagedFlag ?? opt.defaultValue;
      if (stagedFlag !== undefined) applied[opt.key] = stagedFlag;
      input.className = 'mt-0.5 w-4 h-4 accent-blue-500 cursor-pointer';
      checkboxes.set(opt.key, input);

      const text = document.createElement('div');
      text.className = 'flex-1 min-w-0';

      const labelEl = document.createElement('div');
      labelEl.className = 'text-xs text-zinc-200 font-medium';
      labelEl.textContent = opt.label;

      const descEl = document.createElement('div');
      descEl.className = 'text-[10px] text-zinc-500 leading-snug';
      descEl.textContent = opt.description;

      text.appendChild(labelEl);
      text.appendChild(descEl);

      row.appendChild(input);
      row.appendChild(text);
      shell.body.appendChild(row);
    }

    // Per-version checkboxes (populated below when 2+ versions exist).
    const versionChecks: HTMLInputElement[] = [];

    function confirm() {
      // At least one version must be included.
      if (versionChecks.length > 0 && !versionChecks.some(c => c.checked)) return;
      const opts: ExportOptions = {};
      for (const [key, input] of checkboxes) opts[key] = input.checked;
      if (versionChecks.length > 0) {
        opts.versionIndices = versionChecks.filter(c => c.checked).map(c => Number(c.dataset.index));
      }
      result = opts;
      shell.close();
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => { result = null; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const exportBtn = document.createElement('button');
    exportBtn.className = BUTTON_PRIMARY;
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', confirm);
    shell.footer.appendChild(exportBtn);

    // Version picker — lets the user prune history into the file without
    // deleting anything. Only shown when there's a choice to make (2+ versions).
    if (versions.length > 1) {
      const section = document.createElement('div');
      section.className = 'border-t border-zinc-700 mt-1 pt-3';

      const head = document.createElement('div');
      head.className = 'flex items-center justify-between';
      const heading = document.createElement('div');
      heading.className = 'text-xs text-zinc-200 font-medium';
      heading.textContent = `Versions (${versions.length})`;
      head.appendChild(heading);
      const toggleAll = document.createElement('button');
      toggleAll.type = 'button';
      toggleAll.className = 'text-[10px] text-blue-400 hover:text-blue-300';
      toggleAll.textContent = 'Select none';
      head.appendChild(toggleAll);
      section.appendChild(head);

      const desc = document.createElement('div');
      desc.className = 'text-[10px] text-zinc-500 leading-snug mb-2';
      desc.textContent = 'Uncheck versions to leave them out of the file. This does not delete them.';
      section.appendChild(desc);

      const list = document.createElement('div');
      list.className = 'max-h-40 overflow-auto flex flex-col gap-0.5';
      for (const v of versions) {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 py-1 cursor-pointer hover:bg-zinc-700/40 rounded px-2 -mx-2';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = applied.versions ? (applied.versions as number[]).includes(v.index) : true;
        cb.className = 'w-4 h-4 accent-blue-500 cursor-pointer';
        cb.dataset.index = String(v.index);
        versionChecks.push(cb);
        const lbl = document.createElement('span');
        lbl.className = 'text-xs text-zinc-300 font-mono truncate';
        lbl.textContent = v.label && v.label !== `v${v.index}` ? `v${v.index} — ${v.label}` : `v${v.index}`;
        row.appendChild(cb);
        row.appendChild(lbl);
        list.appendChild(row);
      }
      section.appendChild(list);
      shell.body.appendChild(section);

      const syncExportEnabled = () => {
        const any = versionChecks.some(c => c.checked);
        exportBtn.disabled = !any;
        exportBtn.classList.toggle('opacity-40', !any);
        exportBtn.classList.toggle('cursor-default', !any);
        toggleAll.textContent = versionChecks.every(c => c.checked) ? 'Select none' : 'Select all';
      };
      toggleAll.addEventListener('click', () => {
        const allChecked = versionChecks.every(c => c.checked);
        for (const c of versionChecks) c.checked = !allChecked;
        syncExportEnabled();
      });
      for (const c of versionChecks) c.addEventListener('change', syncExportEnabled);
      if (applied.versions) syncExportEnabled();
    }

    // Modal shell handles Escape; we add Enter-to-confirm so the keyboard
    // flow matches the previous standalone implementation. An AI-staged open
    // is guarded: no Export focus, Enter arms only after the user interacts.
    disarmConfirm = armDialogConfirm({ within: shell.body, primary: exportBtn, onConfirm: confirm, guarded: !!staged });
    openDialog = {
      state: () => {
        const out: Record<string, unknown> = {};
        for (const [key, input] of checkboxes) out[key] = input.checked;
        if (versionChecks.length > 0) out.versions = versionChecks.filter(c => c.checked).map(c => Number(c.dataset.index));
        return out;
      },
      close: () => { result = null; shell.close(); },
    };
    staged?.settle({ applied, ignored });
  });
}
