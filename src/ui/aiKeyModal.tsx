// API-key entry modal for a hosted provider. Validates the key,
// persists it to IndexedDB, and closes on success; reopens on error
// with the reason inline. Parameterized by provider (Anthropic /
// OpenAI / Gemini) via a PROVIDER_UI map — Anthropic keeps its exact
// original copy and title so the smoke test stays valid.
//
// The modal itself is Preact (mounted into modalShell); the utility
// exports below (validateAndStoreKey, providerKeyMeta, HostedProvider
// type) are non-JSX helpers that other modules (the inline key form
// in AI Settings, the review modal) import directly.

import { signal, type Signal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { putKey, getKey } from '../ai/db';
import { resetClient, validateKey } from '../ai/anthropic';
import { validateKey as validateOpenaiKey, resetClient as resetOpenaiClient } from '../ai/openai';
import { validateKey as validateGeminiKey, resetClient as resetGeminiClient } from '../ai/gemini';
import { recordEvent } from '../ai/diagnostics';
import { loadSettings, saveSettings, setProvider } from '../ai/settings';
import { mountPreactModal } from './preact/mount';
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
  /** Optional extra note rendered under the intro. Used for Gemini, whose
   *  wire protocol puts the key in the request URL (unlike the header-based
   *  Anthropic/OpenAI), which is worth calling out. */
  note?: string;
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
    note: 'Gemini’s API sends the key as a URL query parameter (not an auth header), so it can appear in browser history and proxy logs. Use a key scoped to this project and rotate it if you have concerns.',
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

interface FormSignals {
  value: Signal<string>;
  error: Signal<string | null>;
  validating: Signal<boolean>;
}

function KeyFormBody(props: {
  ui: ProviderUi;
  state: FormSignals;
  onSubmit: () => void;
  onSwitchToLocal: () => void;
}) {
  const { ui, state, onSubmit, onSwitchToLocal } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <p class="text-zinc-300 leading-snug">{ui.intro}</p>
      {ui.note && (
        <p class="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug">{ui.note}</p>
      )}
      <a
        href={ui.consoleUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="text-blue-400 hover:text-blue-300 underline text-xs"
      >{ui.consoleLabel}</a>
      <div class="text-xs text-zinc-400 leading-snug">
        Don’t want an API key?{' '}
        <button
          type="button"
          class="underline text-emerald-300 hover:text-emerald-200"
          onClick={onSwitchToLocal}
        >Run a local model in your browser</button>
        {' '}— free, runs on your GPU.
      </div>
      <div
        class="rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug"
        dangerouslySetInnerHTML={{ __html: '<strong>Recommended:</strong> use a workspace-scoped key with a monthly spend cap. Anyone who can run code in this page (extensions, devtools) can read the key.' }}
      />
      <label class="flex flex-col gap-1">
        <span class="text-xs text-zinc-400">API key</span>
        <input
          ref={inputRef}
          type="password"
          placeholder={ui.placeholder}
          class="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
          spellcheck={false}
          autocomplete="off"
          value={state.value.value}
          onInput={e => { state.value.value = (e.currentTarget as HTMLInputElement).value; }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } }}
        />
      </label>
      {state.error.value && <div class="text-xs text-red-400">{state.error.value}</div>}
      {state.validating.value && <div class="text-xs text-zinc-500">Sending a 1-token test request to verify the key...</div>}
    </>
  );
}

function KeyFormFooter(props: {
  state: FormSignals;
  onCancel: () => void;
  onConnect: () => void;
}) {
  return (
    <>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700"
        onClick={props.onCancel}
      >Cancel</button>
      <button
        type="button"
        class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        disabled={props.state.validating.value}
        onClick={props.onConnect}
      >{props.state.validating.value ? 'Validating...' : 'Connect'}</button>
    </>
  );
}

export async function showAiKeyModal(cb: AiKeyModalCallbacks): Promise<void> {
  const requested: Provider = cb.provider ?? 'anthropic';
  if (requested === 'local') return; // local uses no key
  const providerId: HostedProvider = requested;
  const ui = PROVIDER_UI[providerId];

  // State lives at this level so body and footer share it. Plain
  // `signal()` (not `useSignal`) because this code path is outside a
  // component — hooks aren't valid here.
  const state: FormSignals = {
    value: signal(''),
    error: signal<string | null>(null),
    validating: signal(false),
  };

  mountPreactModal(
    { title: ui.title },
    close => {
      async function attempt() {
        if (state.value.value.trim().length < 10) {
          state.error.value = 'That key looks too short.';
          return;
        }
        state.error.value = null;
        state.validating.value = true;
        const err = await validateAndStoreKey(providerId, state.value.value);
        if (err) {
          state.error.value = err;
          state.validating.value = false;
          return;
        }
        close();
        cb.onConnected();
      }

      return {
        body: <KeyFormBody
          ui={ui}
          state={state}
          onSubmit={() => { void attempt(); }}
          onSwitchToLocal={() => {
            close();
            void showAiLocalModal({ onChange: cb.onConnected });
          }}
        />,
        footer: <KeyFormFooter
          state={state}
          onCancel={close}
          onConnect={() => { void attempt(); }}
        />,
      };
    },
  );
}
