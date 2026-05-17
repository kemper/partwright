// First-run modal: collect the user's Anthropic API key, validate it,
// persist it to IndexedDB. Closes on success; reopens on error with the
// reason inline.

import { putKey, getKey } from '../ai/db';
import { resetClient, validateKey } from '../ai/anthropic';
import { createModalShell } from './modalShell';

export interface AiKeyModalCallbacks {
  onConnected: () => void;
}

export async function showAiKeyModal(cb: AiKeyModalCallbacks): Promise<void> {
  const shell = createModalShell({ title: 'Connect Anthropic API' });

  const intro = document.createElement('p');
  intro.className = 'text-zinc-300 leading-snug';
  intro.textContent = 'Partwright AI uses your Anthropic API key. The key is stored only in this browser — not on any Partwright server.';
  shell.body.appendChild(intro);

  const link = document.createElement('a');
  link.href = 'https://console.anthropic.com/settings/keys';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'text-blue-400 hover:text-blue-300 underline text-xs';
  link.textContent = 'Get a key at console.anthropic.com →';
  shell.body.appendChild(link);

  const tipBox = document.createElement('div');
  tipBox.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
  tipBox.innerHTML = '<strong>Recommended:</strong> use a workspace-scoped key with a monthly spend cap. Anyone who can run code in this page (extensions, devtools) can read the key.';
  shell.body.appendChild(tipBox);

  const label = document.createElement('label');
  label.className = 'flex flex-col gap-1';
  const labelText = document.createElement('span');
  labelText.className = 'text-xs text-zinc-400';
  labelText.textContent = 'API key';
  label.appendChild(labelText);

  const input = document.createElement('input');
  input.type = 'password';
  input.placeholder = 'sk-ant-...';
  input.className = 'w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500';
  input.spellcheck = false;
  input.autocomplete = 'off';
  label.appendChild(input);
  shell.body.appendChild(label);

  const errorBox = document.createElement('div');
  errorBox.className = 'text-xs text-red-400 hidden';
  shell.body.appendChild(errorBox);

  const status = document.createElement('div');
  status.className = 'text-xs text-zinc-500 hidden';
  shell.body.appendChild(status);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', shell.close);
  shell.footer.appendChild(cancelBtn);

  const connectBtn = document.createElement('button');
  connectBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed';
  connectBtn.textContent = 'Connect';
  shell.footer.appendChild(connectBtn);

  setTimeout(() => input.focus(), 0);

  async function attemptConnect() {
    const key = input.value.trim();
    if (key.length < 10) {
      showError('That key looks too short.');
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Validating...';
    status.classList.remove('hidden');
    status.textContent = 'Sending a 1-token test request to verify the key...';
    errorBox.classList.add('hidden');

    const error = await validateKey(key);
    if (error) {
      showError(error);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
      status.classList.add('hidden');
      return;
    }

    const existing = await getKey('anthropic');
    await putKey({
      provider: 'anthropic',
      apiKey: key,
      createdAt: existing?.createdAt ?? Date.now(),
      lastUsed: Date.now(),
      totalInputTokens: existing?.totalInputTokens ?? 0,
      totalOutputTokens: existing?.totalOutputTokens ?? 0,
      totalCostUsd: existing?.totalCostUsd ?? 0,
    });
    resetClient();
    shell.close();
    cb.onConnected();
  }

  function showError(msg: string) {
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  connectBtn.addEventListener('click', () => { void attemptConnect(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); void attemptConnect(); }
  });
}
