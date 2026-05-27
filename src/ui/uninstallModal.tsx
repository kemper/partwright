// "Uninstall / start fresh" — modal that deletes Partwright's browser data
// by category. Every category is checked by default; the user unticks
// anything they want to keep. Doubles as a recovery valve for corruption
// or a non-backwards-compatible schema change.

import { signal, type Signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
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

type Details = Partial<Record<keyof WipeSelection, string>>;

function UninstallBody(props: {
  selection: Signal<WipeSelection>;
  details: Signal<Details>;
}) {
  const { selection, details } = props;

  // Pull live counts after first paint so the modal opens instantly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Details = {};
      try {
        const counts = await getStoreCounts();
        const by = (s: string) => counts.find(c => c.store === s)?.count ?? 0;
        next.modelingData = `${by('sessions')} session(s), ${by('versions')} version(s), ${by('notes')} note(s)`;
        next.chats = `${by('aiChats')} message(s)`;
        next.apiKeys = `${by('aiKeys')} key(s)`;
        next.attachments = `${by('aiAttachments')} image(s)`;
      } catch { /* leave placeholders */ }
      try { next.preferences = `${listLocalStorageEntries().length} setting key(s)`; } catch { /* ignore */ }
      try {
        const [models, usage] = await Promise.all([getCachedModels(), getStorageUsage()]);
        const usageStr = usage.unavailable ? '' : ` · ${formatBytes(usage.usageBytes)} total browser storage`;
        next.models = `${models.size} model(s) cached${usageStr}`;
      } catch { /* ignore */ }
      if (!cancelled) details.value = { ...details.value, ...next };
    })();
    return () => { cancelled = true; };
  }, []);

  function setAll(value: boolean): void {
    const next = { ...selection.value };
    for (const key of Object.keys(next) as (keyof WipeSelection)[]) next[key] = value;
    selection.value = next;
  }

  return (
    <>
      <p class="text-zinc-400">
        Delete Partwright data stored in this browser. Choose what to remove — everything is selected by default. This cannot be undone.
      </p>
      <div class="flex flex-col gap-2">
        {ROWS.map(row => (
          <label key={row.key} class="flex items-start gap-3 p-2 rounded border border-zinc-700 hover:border-zinc-600 cursor-pointer">
            <input
              type="checkbox"
              class="mt-0.5 accent-red-500"
              checked={selection.value[row.key]}
              onChange={e => {
                selection.value = { ...selection.value, [row.key]: (e.currentTarget as HTMLInputElement).checked };
              }}
            />
            <div class="flex-1 min-w-0">
              <div class="text-zinc-100">{row.label}</div>
              <div class="text-[11px] text-zinc-500">{row.desc}</div>
              <div class="text-[11px] text-zinc-400 mt-0.5">{details.value[row.key] ?? '…'}</div>
            </div>
          </label>
        ))}
      </div>
      <div class="flex gap-3 text-[11px]">
        <button type="button" class="text-zinc-400 hover:text-zinc-200 underline" onClick={() => setAll(true)}>Select all</button>
        <button type="button" class="text-zinc-400 hover:text-zinc-200 underline" onClick={() => setAll(false)}>Select none</button>
      </div>
    </>
  );
}

function UninstallFooter(props: {
  selection: Signal<WipeSelection>;
  running: Signal<boolean>;
  close: () => void;
}) {
  const { selection, running, close } = props;
  const anySelected = Object.values(selection.value).some(Boolean);

  async function runWipe() {
    running.value = true;
    try { await wipeData(selection.value); }
    catch (err) { console.error('Uninstall failed:', err); }
    // Reload so all in-memory state is rebuilt from the now-empty stores.
    window.location.assign('/');
  }

  return (
    <>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100 disabled:opacity-50"
        disabled={running.value}
        onClick={close}
      >Cancel</button>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-sm bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={!anySelected || running.value}
        onClick={() => { void runWipe(); }}
      >{running.value ? 'Deleting…' : 'Delete selected data'}</button>
    </>
  );
}

export function showUninstallModal(): void {
  const selection = signal<WipeSelection>({ ...FULL_WIPE });
  const details = signal<Details>({});
  const running = signal(false);

  mountPreactModal(
    { title: 'Uninstall / start fresh', maxWidth: 'lg', scrollable: true },
    close => ({
      body: <UninstallBody selection={selection} details={details} />,
      footer: <UninstallFooter selection={selection} running={running} close={close} />,
    }),
  );
}
