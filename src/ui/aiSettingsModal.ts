// AI Settings modal — accessible from the AI chip overflow. Shows key
// status (last 4 chars + lifetime usage), and exposes Replace key /
// Disconnect actions.

import { deleteKey, getKey } from '../ai/db';
import { resetClient } from '../ai/anthropic';
import { formatUsd } from '../ai/cost';
import { showAiKeyModal } from './aiKeyModal';
import { createModalShell } from './modalShell';

export interface AiSettingsCallbacks {
  onChange: () => void;
}

export async function showAiSettingsModal(cb: AiSettingsCallbacks): Promise<void> {
  const shell = createModalShell({ title: 'AI Settings' });
  // Settings rows want a slightly larger gap than the default.
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-4');

  const key = await getKey('anthropic');
  if (!key) {
    const empty = document.createElement('p');
    empty.className = 'text-zinc-400';
    empty.textContent = 'No Anthropic key connected.';
    shell.body.appendChild(empty);
    const connectBtn = document.createElement('button');
    connectBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
    connectBtn.textContent = 'Connect Anthropic API';
    connectBtn.addEventListener('click', () => {
      shell.close();
      void showAiKeyModal({ onConnected: cb.onChange });
    });
    shell.footer.appendChild(connectBtn);
    return;
  }

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
  shell.body.appendChild(row('Provider', 'Anthropic'));
  shell.body.appendChild(row('Key', `…${last4}`));
  shell.body.appendChild(row('Connected', new Date(key.createdAt).toLocaleString()));
  shell.body.appendChild(row('Last used', new Date(key.lastUsed).toLocaleString()));
  shell.body.appendChild(row('Input tokens', key.totalInputTokens.toLocaleString()));
  shell.body.appendChild(row('Output tokens', key.totalOutputTokens.toLocaleString()));
  shell.body.appendChild(row('Spent (estimated)', formatUsd(key.totalCostUsd)));

  const note = document.createElement('p');
  note.className = 'text-xs text-zinc-500 leading-snug';
  note.textContent = 'Estimated spend uses public list prices and may differ slightly from your Anthropic invoice.';
  shell.body.appendChild(note);

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-200 bg-zinc-700 hover:bg-zinc-600';
  replaceBtn.textContent = 'Replace key';
  replaceBtn.addEventListener('click', () => {
    shell.close();
    void showAiKeyModal({ onConnected: cb.onChange });
  });
  shell.footer.appendChild(replaceBtn);

  const disconnectBtn = document.createElement('button');
  disconnectBtn.className = 'px-3 py-1.5 rounded text-xs text-red-300 bg-red-900/40 hover:bg-red-800/60';
  disconnectBtn.textContent = 'Disconnect';
  disconnectBtn.addEventListener('click', async () => {
    if (!confirm('Disconnect Anthropic? Your chat history is kept; only the key is removed.')) return;
    await deleteKey('anthropic');
    resetClient();
    shell.close();
    cb.onChange();
  });
  shell.footer.appendChild(disconnectBtn);
}
