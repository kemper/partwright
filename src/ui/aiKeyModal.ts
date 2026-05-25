// API-key entry modal for a hosted provider. Validates the key, persists
// it to IndexedDB, and closes on success; reopens on error with the
// reason inline. Parameterized by provider (Anthropic / OpenAI / Gemini)
// via a PROVIDER_UI map — Anthropic keeps its exact original copy and
// title so the smoke test stays valid.

import { putKey, getKey } from '../ai/db';
import { resetClient, validateKey } from '../ai/anthropic';
import { validateKey as validateOpenaiKey, resetClient as resetOpenaiClient } from '../ai/openai';
import { validateKey as validateGeminiKey, resetClient as resetGeminiClient } from '../ai/gemini';
import { recordEvent } from '../ai/diagnostics';
import { loadSettings, saveSettings, setProvider } from '../ai/settings';
import { createModalShell } from './modalShell';
import { showAiLocalModal } from './aiLocalModal';
import type { Provider } from '../ai/types';

export interface AiKeyModalCallbacks {
  onConnected: () => void;
  /** Which hosted provider this modal connects. Defaults to 'anthropic'
   *  so existing one-arg call sites keep working. */
  provider?: Provider;
}

interface ProviderUi {
  title: string;
  intro: string;
  consoleUrl: string;
  consoleLabel: string;
  placeholder: string;
  validate: (key: string) => Promise<string | null>;
  reset: () => void;
}

export type HostedProvider = Exclude<Provider, 'local'>;

const PROVIDER_UI: Record<HostedProvider, ProviderUi> = {
  anthropic: {
    title: 'Connect Anthropic API',
    intro: 'Partwright AI uses your Anthropic API key. The key is stored only in this browser — not on any Partwright server.',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'Get a key at console.anthropic.com →',
    placeholder: 'sk-ant-...',
    validate: validateKey,
    reset: resetClient,
  },
  openai: {
    title: 'Connect OpenAI',
    intro: 'Partwright AI uses your OpenAI API key. The key is stored only in this browser — not on any Partwright server.',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'Get a key at platform.openai.com →',
    placeholder: 'sk-proj-...',
    validate: validateOpenaiKey,
    reset: resetOpenaiClient,
  },
  gemini: {
    title: 'Connect Google Gemini',
    intro: 'Partwright AI uses your Google Gemini API key. The key is stored only in this browser — not on any Partwright server.',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    consoleLabel: 'Get a key at aistudio.google.com →',
    placeholder: 'AIza...',
    validate: validateGeminiKey,
    reset: resetGeminiClient,
  },
};

/** Display-only metadata for a hosted provider's key entry (title, console
 *  link, input placeholder). Exposed so the inline key form in the AI
 *  Settings modal can render the same copy without launching this modal. */
export function providerKeyMeta(provider: HostedProvider): {
  title: string;
  intro: string;
  consoleUrl: string;
  consoleLabel: string;
  placeholder: string;
} {
  const ui = PROVIDER_UI[provider];
  return {
    title: ui.title,
    intro: ui.intro,
    consoleUrl: ui.consoleUrl,
    consoleLabel: ui.consoleLabel,
    placeholder: ui.placeholder,
  };
}

/** Validate a pasted key, then persist it and promote its provider to
 *  active. Returns an error message on failure, or `null` on success.
 *  Shared by the standalone key modal and the inline key form in AI
 *  Settings so the validate → store → set-active sequence lives in one
 *  place. */
export async function validateAndStoreKey(provider: HostedProvider, rawKey: string): Promise<string | null> {
  const ui = PROVIDER_UI[provider];
  const key = rawKey.trim();
  if (key.length < 10) return 'That key looks too short.';

  const t0 = performance.now();
  const error = await ui.validate(key);
  recordEvent({
    provider,
    model: '(validate)',
    kind: 'validateKey',
    durationMs: Math.round(performance.now() - t0),
    status: error ? 'error' : 'ok',
    errorMessage: error ?? undefined,
    requestSummary: '1-token ping',
  });
  if (error) return error;

  const existing = await getKey(provider);
  await putKey({
    provider,
    apiKey: key,
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsed: Date.now(),
    totalInputTokens: existing?.totalInputTokens ?? 0,
    totalOutputTokens: existing?.totalOutputTokens ?? 0,
    totalCostUsd: existing?.totalCostUsd ?? 0,
  });
  ui.reset();
  // Promote the just-connected provider to active so the key "just works"
  // without an extra dropdown trip. Per-provider model selections are
  // preserved by setProvider.
  const cur = loadSettings();
  if (cur.toggles.provider !== provider) {
    saveSettings(setProvider(cur, provider));
  }
  return null;
}

export async function showAiKeyModal(cb: AiKeyModalCallbacks): Promise<void> {
  const requested: Provider = cb.provider ?? 'anthropic';
  if (requested === 'local') return; // local uses no key
  const providerId: HostedProvider = requested;
  const ui = PROVIDER_UI[providerId];
  const shell = createModalShell({ title: ui.title });

  const intro = document.createElement('p');
  intro.className = 'text-zinc-300 leading-snug';
  intro.textContent = ui.intro;
  shell.body.appendChild(intro);

  const link = document.createElement('a');
  link.href = ui.consoleUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'text-blue-400 hover:text-blue-300 underline text-xs';
  link.textContent = ui.consoleLabel;
  shell.body.appendChild(link);

  const altRow = document.createElement('div');
  altRow.className = 'text-xs text-zinc-400 leading-snug';
  altRow.appendChild(document.createTextNode('Don’t want an API key? '));
  const localLink = document.createElement('button');
  localLink.className = 'underline text-emerald-300 hover:text-emerald-200';
  localLink.textContent = 'Run a local model in your browser';
  localLink.addEventListener('click', () => {
    shell.close();
    // Reuse the key-modal's onConnected callback: once a local model is
    // picked the chat is ready to send the next turn, same as a key paste.
    void showAiLocalModal({ onChange: cb.onConnected });
  });
  altRow.appendChild(localLink);
  altRow.appendChild(document.createTextNode(' — free, runs on your GPU.'));
  shell.body.appendChild(altRow);

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
  input.placeholder = ui.placeholder;
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
    if (input.value.trim().length < 10) {
      showError('That key looks too short.');
      return;
    }
    connectBtn.disabled = true;
    connectBtn.textContent = 'Validating...';
    status.classList.remove('hidden');
    status.textContent = 'Sending a 1-token test request to verify the key...';
    errorBox.classList.add('hidden');

    const error = await validateAndStoreKey(providerId, input.value);
    if (error) {
      showError(error);
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
      status.classList.add('hidden');
      return;
    }
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
