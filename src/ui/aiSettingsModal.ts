// AI Settings modal — accessible from the AI chip overflow. Shows key
// status (last 4 chars + lifetime usage), and exposes Replace key /
// Disconnect actions for the hosted provider, plus a Local-model section
// for picking and downloading WebLLM weights.

import { deleteKey, getKey } from '../ai/db';
import { resetClient } from '../ai/anthropic';
import { formatUsd } from '../ai/cost';
import { showAiKeyModal } from './aiKeyModal';
import { showAiLocalModal } from './aiLocalModal';
import { loadSettings, saveSettings, setProvider } from '../ai/settings';
import { findLocalModel } from '../ai/localModels';
import { isModelLoaded } from '../ai/local';

let modalEl: HTMLElement | null = null;

export interface AiSettingsCallbacks {
  onChange: () => void;
}

export async function showAiSettingsModal(cb: AiSettingsCallbacks): Promise<void> {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-md flex flex-col';

  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between';
  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = 'AI Settings';
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.className = 'px-5 py-4 flex flex-col gap-4 text-sm text-zinc-200';

  body.appendChild(buildProviderRow(cb));
  body.appendChild(document.createElement('hr')).className = 'border-zinc-700';
  const localSection = buildLocalSection(cb);
  body.appendChild(localSection);
  body.appendChild(document.createElement('hr')).className = 'border-zinc-700';

  const key = await getKey('anthropic');
  if (!key) {
    const empty = document.createElement('p');
    empty.className = 'text-zinc-400';
    empty.textContent = 'No Anthropic key connected.';
    body.appendChild(empty);
    const connectBtn = document.createElement('button');
    connectBtn.className = 'self-start px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
    connectBtn.textContent = 'Connect Anthropic API';
    connectBtn.addEventListener('click', () => {
      closeModal();
      void showAiKeyModal({ onConnected: cb.onChange });
    });
    body.appendChild(connectBtn);
  } else {
    const last4 = key.apiKey.slice(-4);
    const row = (label: string, value: string) => {
      const r = document.createElement('div');
      r.className = 'flex justify-between gap-3';
      const l = document.createElement('span');
      l.className = 'text-zinc-400';
      l.textContent = label;
      const v = document.createElement('span');
      v.className = 'text-zinc-100 font-mono text-xs';
      v.textContent = value;
      r.appendChild(l);
      r.appendChild(v);
      return r;
    };
    body.appendChild(row('Provider', 'Anthropic'));
    body.appendChild(row('Key', `…${last4}`));
    body.appendChild(row('Connected', new Date(key.createdAt).toLocaleString()));
    body.appendChild(row('Last used', new Date(key.lastUsed).toLocaleString()));
    body.appendChild(row('Input tokens', key.totalInputTokens.toLocaleString()));
    body.appendChild(row('Output tokens', key.totalOutputTokens.toLocaleString()));
    body.appendChild(row('Spent (estimated)', formatUsd(key.totalCostUsd)));

    const note = document.createElement('p');
    note.className = 'text-xs text-zinc-500 leading-snug';
    note.textContent = 'Estimated spend uses public list prices and may differ slightly from your Anthropic invoice.';
    body.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'flex justify-end gap-2 pt-2';

    const replaceBtn = document.createElement('button');
    replaceBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
    replaceBtn.textContent = 'Replace key';
    replaceBtn.addEventListener('click', () => {
      closeModal();
      void showAiKeyModal({ onConnected: cb.onChange });
    });
    actions.appendChild(replaceBtn);

    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'px-3 py-1.5 rounded text-xs text-red-300 bg-red-900/40 hover:bg-red-800/60';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.addEventListener('click', async () => {
      if (!confirm('Disconnect Anthropic? Your chat history is kept; only the key is removed.')) return;
      await deleteKey('anthropic');
      resetClient();
      closeModal();
      cb.onChange();
    });
    actions.appendChild(disconnectBtn);

    body.appendChild(actions);
  }

  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalEl = overlay;

  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function buildProviderRow(cb: AiSettingsCallbacks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const label = document.createElement('div');
  label.className = 'text-xs text-zinc-400';
  label.textContent = 'Provider';
  wrap.appendChild(label);

  const settings = loadSettings();
  const seg = document.createElement('div');
  seg.className = 'inline-flex rounded border border-zinc-700 overflow-hidden';
  const mkBtn = (id: 'anthropic' | 'local', text: string, hint: string) => {
    const b = document.createElement('button');
    const active = settings.toggles.provider === id;
    b.className = active
      ? 'px-3 py-1 text-xs bg-zinc-700 text-zinc-100'
      : 'px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700/60';
    b.textContent = text;
    b.title = hint;
    b.addEventListener('click', () => {
      saveSettings(setProvider(loadSettings(), id));
      cb.onChange();
      closeModal();
      // Reopen so the modal reflects the new provider's section state.
      void showAiSettingsModal(cb);
    });
    seg.appendChild(b);
  };
  mkBtn('anthropic', 'Anthropic (cloud)', 'Use a hosted Claude model with your API key.');
  mkBtn('local', 'Local (WebGPU)', 'Run a small/medium/large model in this browser.');
  wrap.appendChild(seg);
  return wrap;
}

function buildLocalSection(cb: AiSettingsCallbacks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-2';
  const head = document.createElement('div');
  head.className = 'flex items-center justify-between';
  const h = document.createElement('div');
  h.className = 'text-xs text-zinc-400';
  h.textContent = 'Local model';
  head.appendChild(h);
  const pick = document.createElement('button');
  pick.className = 'px-3 py-1 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  pick.textContent = 'Choose model…';
  pick.addEventListener('click', () => {
    closeModal();
    void showAiLocalModal({ onChange: cb.onChange });
  });
  head.appendChild(pick);
  wrap.appendChild(head);

  const settings = loadSettings();
  const status = document.createElement('div');
  status.className = 'text-[11px] text-zinc-400 leading-snug';
  if (settings.toggles.localModel) {
    const info = findLocalModel(settings.toggles.localModel);
    const resident = isModelLoaded(info.id);
    status.textContent = `${info.label} · ${(info.vramMB / 1024).toFixed(1)} GB VRAM · ${resident ? 'in GPU memory' : 'not yet loaded'}`;
  } else {
    status.textContent = 'No local model picked yet. Click “Choose model…” to download one.';
  }
  wrap.appendChild(status);
  return wrap;
}

function closeModal(): void {
  modalEl?.remove();
  modalEl = null;
}
