// The Assembly view's shared-parameter panel — a viewport overlay listing the
// UNION of every part's parameters (one row per name). Each row reuses the
// Customizer's widget builder and adds an "affects N parts" badge (hover for the
// list of part names). Editing a widget live-previews across all parts that
// declare that key; the footer Save button commits the tweaked values to each of
// those parts.

import type { ParamValue } from '../geometry/params';
import { buildWidget } from '../ui/paramsPanel';
import type { SharedParam } from './sharedParams';

export interface AssemblyParamsPanelOptions {
  /** A widget changed — live-preview every part that declares this key. */
  onChange: (key: string, value: ParamValue) => void;
  /** Save clicked — persist current values to every affected part's version. */
  onSave: () => void | Promise<void>;
  /** Close (×) clicked — leave the parameter panel (Assembly view stays open). */
  onClose: () => void;
}

export interface AssemblyParamsPanelController {
  element: HTMLElement;
  /** Render (or re-render) the union of shared parameters. */
  update(params: SharedParam[]): void;
  /** Reflect unsaved edits on the Save button. */
  setDirty(dirty: boolean): void;
  /** Reflect an in-flight Save (disables the button, shows "Saving…"). */
  setSaving(saving: boolean): void;
}

const SAVE_BTN = 'px-3 py-1 rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-default transition-colors';

export function createAssemblyParamsPanel(opts: AssemblyParamsPanelOptions): AssemblyParamsPanelController {
  const root = document.createElement('div');
  root.id = 'assembly-params-panel';
  root.className = 'hidden fixed top-16 right-3 z-10 w-64 max-w-[calc(100%-1rem)] flex flex-col rounded-lg bg-zinc-900/90 backdrop-blur border border-zinc-700 shadow-lg text-zinc-200 pointer-events-auto';

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-2.5 py-2 border-b border-zinc-700/70 select-none';
  const title = document.createElement('span');
  title.className = 'text-xs font-medium text-zinc-300 flex-1 truncate';
  title.textContent = 'Assembly Parameters';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-400 hover:text-zinc-200 text-base leading-none w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-zinc-700/60 transition-colors';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close parameters';
  closeBtn.setAttribute('aria-label', 'Close assembly parameters');
  closeBtn.addEventListener('click', () => opts.onClose());
  header.appendChild(title);
  header.appendChild(closeBtn);
  root.appendChild(header);

  const body = document.createElement('div');
  body.className = 'flex flex-col gap-3 px-2.5 py-2 overflow-y-auto max-h-[min(60vh,26rem)]';
  root.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'flex items-center justify-between gap-2 px-2.5 py-2 border-t border-zinc-700/70';
  const hint = document.createElement('span');
  hint.className = 'text-[11px] text-zinc-500 truncate';
  hint.textContent = 'Live preview';
  const saveBtn = document.createElement('button');
  saveBtn.className = SAVE_BTN;
  saveBtn.textContent = 'Save';
  saveBtn.disabled = true;
  saveBtn.title = 'Save these values to every affected part';
  saveBtn.addEventListener('click', () => { void opts.onSave(); });
  footer.appendChild(hint);
  footer.appendChild(saveBtn);
  root.appendChild(footer);

  const valueSetters = new Map<string, (v: ParamValue) => void>();

  function update(params: SharedParam[]): void {
    body.replaceChildren();
    valueSetters.clear();
    if (params.length === 0) {
      root.classList.add('hidden');
      return;
    }
    root.classList.remove('hidden');
    for (const p of params) {
      const wrap = document.createElement('div');
      wrap.className = 'flex flex-col gap-1';
      const { row, setValue } = buildWidget(p.spec, opts.onChange);
      valueSetters.set(p.spec.key, setValue);
      wrap.appendChild(row);

      // "affects N parts" indicator; hover reveals the affected part names.
      const badge = document.createElement('div');
      badge.className = 'text-[10px] text-zinc-500 cursor-help';
      const n = p.partIds.length;
      badge.textContent = `affects ${n} part${n === 1 ? '' : 's'}${p.mixed ? ' · mixed values' : ''}`;
      badge.title = p.partNames.join(', ');
      wrap.appendChild(badge);

      body.appendChild(wrap);
      setValue(p.value);
    }
  }

  return {
    element: root,
    update,
    setDirty(dirty: boolean): void {
      saveBtn.disabled = !dirty;
      hint.textContent = dirty ? 'Unsaved changes' : 'Live preview';
    },
    setSaving(saving: boolean): void {
      saveBtn.disabled = saving;
      saveBtn.textContent = saving ? 'Saving…' : 'Save';
    },
  };
}
