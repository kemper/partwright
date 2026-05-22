// "Uninstall / start fresh" — a modal that deletes Partwright's browser data by
// category. Every category is checked by default; the user unticks anything
// they want to keep. Doubles as a recovery valve for corruption or a
// non-backwards-compatible schema change.

import { createModalShell } from './modalShell';
import {
  getStoreCounts,
  listLocalStorageEntries,
  wipeData,
  FULL_WIPE,
  formatBytes,
  type WipeSelection,
} from '../storage/dataInventory';
import { getStorageUsage, getCachedModels } from '../ai/local';

interface CategoryRow {
  key: keyof WipeSelection;
  label: string;
  desc: string;
}

const ROWS: CategoryRow[] = [
  { key: 'modelingData', label: 'Sessions, versions & notes', desc: 'All your models and their full history.' },
  { key: 'chats', label: 'AI chat history', desc: 'Saved chat transcripts for every session.' },
  { key: 'apiKeys', label: 'AI API keys', desc: 'Your stored Anthropic / OpenAI / Gemini keys.' },
  { key: 'attachments', label: 'Image attachments', desc: 'Recently attached reference images.' },
  { key: 'preferences', label: 'Preferences & settings', desc: 'Theme, toggle presets, AI settings, tour state.' },
  { key: 'models', label: 'Downloaded AI models', desc: 'Local (WebGPU) model weights — can be several GB.' },
];

export function showUninstallModal(): void {
  const { body, footer, close } = createModalShell({
    title: 'Uninstall / start fresh',
    maxWidth: 'lg',
    scrollable: true,
  });

  const intro = document.createElement('p');
  intro.className = 'text-zinc-400';
  intro.textContent =
    'Delete Partwright data stored in this browser. Choose what to remove — everything is selected by default. This cannot be undone.';
  body.appendChild(intro);

  const selection: WipeSelection = { ...FULL_WIPE };
  const detailEls: Partial<Record<keyof WipeSelection, HTMLElement>> = {};
  const checkboxes: HTMLInputElement[] = [];

  const list = document.createElement('div');
  list.className = 'flex flex-col gap-2';
  for (const row of ROWS) {
    const wrapper = document.createElement('label');
    wrapper.className =
      'flex items-start gap-3 p-2 rounded border border-zinc-700 hover:border-zinc-600 cursor-pointer';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'mt-0.5 accent-red-500';
    cb.addEventListener('change', () => {
      selection[row.key] = cb.checked;
      updateConfirmState();
    });
    checkboxes.push(cb);

    const textCol = document.createElement('div');
    textCol.className = 'flex-1 min-w-0';
    const title = document.createElement('div');
    title.className = 'text-zinc-100';
    title.textContent = row.label;
    const desc = document.createElement('div');
    desc.className = 'text-[11px] text-zinc-500';
    desc.textContent = row.desc;
    const detail = document.createElement('div');
    detail.className = 'text-[11px] text-zinc-400 mt-0.5';
    detail.textContent = '…';
    detailEls[row.key] = detail;
    textCol.append(title, desc, detail);

    wrapper.append(cb, textCol);
    list.appendChild(wrapper);
  }
  body.appendChild(list);

  // Select-all / none convenience.
  const bulk = document.createElement('div');
  bulk.className = 'flex gap-3 text-[11px]';
  const selectAll = document.createElement('button');
  selectAll.type = 'button';
  selectAll.className = 'text-zinc-400 hover:text-zinc-200 underline';
  selectAll.textContent = 'Select all';
  selectAll.addEventListener('click', () => setAll(true));
  const selectNone = document.createElement('button');
  selectNone.type = 'button';
  selectNone.className = 'text-zinc-400 hover:text-zinc-200 underline';
  selectNone.textContent = 'Select none';
  selectNone.addEventListener('click', () => setAll(false));
  bulk.append(selectAll, selectNone);
  body.appendChild(bulk);

  function setAll(value: boolean): void {
    for (const key of Object.keys(selection) as (keyof WipeSelection)[]) selection[key] = value;
    for (const cb of checkboxes) cb.checked = value;
    updateConfirmState();
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'px-3 py-1.5 rounded text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', close);

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'px-3 py-1.5 rounded text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed';
  confirmBtn.textContent = 'Delete selected data';
  confirmBtn.addEventListener('click', () => { void runWipe(); });

  footer.append(cancelBtn, confirmBtn);

  function updateConfirmState(): void {
    const any = Object.values(selection).some(Boolean);
    confirmBtn.disabled = !any;
  }

  async function runWipe(): Promise<void> {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    try {
      await wipeData(selection);
    } catch (err) {
      console.error('Uninstall failed:', err);
    }
    // Reload so all in-memory state is rebuilt from the now-empty stores.
    window.location.assign('/');
  }

  // Annotate each category with how much it holds.
  void (async () => {
    try {
      const counts = await getStoreCounts();
      const by = (s: string) => counts.find((c) => c.store === s)?.count ?? 0;
      setDetail('modelingData', `${by('sessions')} session(s), ${by('versions')} version(s), ${by('notes')} note(s)`);
      setDetail('chats', `${by('aiChats')} message(s)`);
      setDetail('apiKeys', `${by('aiKeys')} key(s)`);
      setDetail('attachments', `${by('aiAttachments')} image(s)`);
    } catch {
      // leave placeholders
    }
    try {
      setDetail('preferences', `${listLocalStorageEntries().length} setting key(s)`);
    } catch { /* ignore */ }
    try {
      const [models, usage] = await Promise.all([getCachedModels(), getStorageUsage()]);
      const usageStr = usage.unavailable ? '' : ` · ${formatBytes(usage.usageBytes)} total browser storage`;
      setDetail('models', `${models.size} model(s) cached${usageStr}`);
    } catch { /* ignore */ }
  })();

  function setDetail(key: keyof WipeSelection, text: string): void {
    const el = detailEls[key];
    if (el) el.textContent = text;
  }
}
