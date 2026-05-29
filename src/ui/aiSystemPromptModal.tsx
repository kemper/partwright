// System prompt editor with a tier switcher.
//
// Three built-in tiers are available regardless of provider:
//   * Slim   — ~700 tokens, designed for small local models. Relies on
//              readDoc to fetch /ai/<topic>.md subdocs when needed.
//   * Medium — ~1.1K tokens, more API examples + workflow. Default for
//              larger local models (Hermes 2 Pro 8B, Qwen3 8B+, etc).
//   * Full   — the slimmed public/ai.md (~12.5K tokens). The default on
//              Anthropic. Fits comfortably in the 32K context most local
//              models default to; only the 4K-context Llama 70B needs a
//              tier swap or sliding-window mode to fit it.
//
// A fourth "Custom" state appears the moment the user edits the textarea
// away from one of the three built-ins. Saving in that state writes the
// override to localStorage so it sticks across reloads. Picking a built-in
// tier replaces the textarea contents and clears the override on save.

import { signal, type Signal } from '@preact/signals';
import { loadSettings, setSystemPromptOverride, providerLabel } from '../ai/settings';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt, buildSystemPrompt, loadAiMd } from '../ai/systemPrompt';
import { resolveLocalModel } from '../ai/local';
import { mountPreactModal } from './preact/mount';
import { setSettings } from './preact/settingsStore';
import type { Provider } from '../ai/types';

export interface SystemPromptModalCallbacks {
  onChange?: () => void;
}

type Tier = 'slim' | 'medium' | 'full' | 'custom';

interface BuiltInPrompts {
  slim: string;
  medium: string;
  full: string;
}

/** Returns 'slim' | 'medium' | 'full' when the editor contents match one
 *  of the built-in prompts verbatim (modulo trailing whitespace), or null
 *  when the user has made edits. */
function detectTierFromText(text: string, built: BuiltInPrompts): 'slim' | 'medium' | 'full' | null {
  const t = text.trim();
  if (t === built.slim.trim()) return 'slim';
  if (t === built.medium.trim()) return 'medium';
  if (t === built.full.trim()) return 'full';
  return null;
}

function PromptBody(props: {
  provider: Provider;
  built: BuiltInPrompts;
  providerDefaultTier: Tier;
  activeLocalContext: number | null;
  fullFitsLocal: boolean;
  text: Signal<string>;
  tier: Signal<Tier>;
}) {
  const { provider, built, providerDefaultTier, activeLocalContext, fullFitsLocal, text, tier } = props;
  const fullPromptTokens = Math.round(built.full.length / 4);

  function pickTier(id: Tier): void {
    if (id !== 'custom') {
      text.value = built[id as 'slim' | 'medium' | 'full'];
    }
    tier.value = id;
  }

  // Intro copy mirrors the original verbatim — the wording matters and
  // some of it is provider-conditioned with HTML formatting.
  let introHtml: string;
  if (provider === 'local') {
    const ctxLine = activeLocalContext === null
      ? 'No model is loaded yet — pick one in AI settings to see whether the Full tier fits its context window.'
      : `Active model context window: <strong>${activeLocalContext.toLocaleString()} tokens</strong>. ${fullFitsLocal
          ? 'The Full tier fits, but Slim or Medium leaves more room for tool docs, conversation, and the reply — and the model can pull subdoc detail on demand via <code>readDoc</code>.'
          : 'The Full tier (~' + Math.round(fullPromptTokens / 1000) + 'K tokens) is too large for this model — pick Slim or Medium, or enable sliding-window mode in AI settings.'}`;
    introHtml = `This is the wrapper prompt sent to every local-model turn. Pick a built-in tier or edit your own. ${ctxLine}`;
  } else {
    const cacheNote = provider === 'anthropic'
      ? ' (it\'s prompt-cached, so you pay for it once per cache window)'
      : '';
    introHtml = `This is the wrapper prompt sent to every ${providerLabel(provider)} turn. The Full tier is the default${cacheNote}. The Slim and Medium tiers are useful when you want to fit more conversation into context, paired with <code>readDoc</code> to pull subdoc detail on demand.`;
  }

  const tierSpecs: { id: Tier; label: string; size: string }[] = [
    { id: 'slim', label: 'Slim', size: `~${Math.round(built.slim.length / 4 / 100) * 100} tokens` },
    { id: 'medium', label: 'Medium', size: `~${(built.medium.length / 4 / 1000).toFixed(1)}K tokens` },
    { id: 'full', label: 'Full', size: `~${Math.round(built.full.length / 4 / 1000)}K tokens` },
    { id: 'custom', label: 'Custom', size: 'your edits' },
  ];

  const chars = text.value.length;
  const approxTokens = Math.round(chars / 4);
  let pillCls: string;
  let pillText: string;
  if (tier.value === 'custom') {
    pillCls = 'px-2 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60';
    pillText = 'Custom (override)';
  } else if (tier.value === 'full') {
    pillCls = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
    pillText = 'Built-in · Full (public/ai.md)';
  } else if (tier.value === 'medium') {
    pillCls = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
    pillText = 'Built-in · Medium';
  } else {
    pillCls = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
    pillText = 'Built-in · Slim';
  }

  const showWarn = provider === 'local' && tier.value === 'full' && !fullFitsLocal;
  const warnHtml = activeLocalContext !== null
    ? `The Full tier is <strong>~${Math.round(fullPromptTokens / 1000)}K tokens</strong>, which doesn't fit in this model's ${activeLocalContext.toLocaleString()}-token context window. Pick Slim or Medium, or enable sliding-window mode in AI settings.`
    : `The Full tier is <strong>~${Math.round(fullPromptTokens / 1000)}K tokens</strong>. Whether it fits depends on the active local model — most curated models default to 32K and have room, but the 4K-context Llama 70B will reject it.`;

  return (
    <>
      <p class="text-zinc-300 leading-snug" dangerouslySetInnerHTML={{ __html: introHtml }} />
      <div class="flex flex-col gap-1">
        <div class="text-xs text-zinc-400">Prompt tier</div>
        <div class="inline-flex rounded border border-zinc-700 overflow-hidden self-start">
          {tierSpecs.map(t => {
            const active = tier.value === t.id;
            const isCustomEmpty = t.id === 'custom' && tier.value !== 'custom';
            const cls = active
              ? 'px-3 py-1 text-xs bg-zinc-700 text-zinc-100 border-r border-zinc-600 last:border-r-0'
              : 'px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700/60 border-r border-zinc-700 last:border-r-0';
            const isDefault = t.id === providerDefaultTier;
            return (
              <button
                key={t.id}
                type="button"
                class={isCustomEmpty ? `${cls} opacity-50 cursor-not-allowed` : cls}
                title={`${t.size}${isDefault ? ' — this provider\'s default tier.' : ''}`}
                disabled={isCustomEmpty}
                onClick={() => { if (!isCustomEmpty) pickTier(t.id); }}
              >{isDefault ? `${t.label} (default)` : t.label}</button>
            );
          })}
        </div>
      </div>
      <div class="flex items-center gap-2 text-xs">
        <span class={pillCls}>{pillText}</span>
        <span class="text-zinc-500">· {chars.toLocaleString()} chars · ~{approxTokens.toLocaleString()} tokens</span>
      </div>
      <textarea
        class="w-full min-h-[260px] max-h-[50vh] px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono leading-snug focus:outline-none focus:border-blue-500 resize-y"
        spellcheck={false}
        value={text.value}
        onInput={e => {
          const v = (e.currentTarget as HTMLTextAreaElement).value;
          text.value = v;
          // The moment the textarea diverges from any built-in, flip to Custom.
          const matched = detectTierFromText(v, built);
          tier.value = matched ?? 'custom';
        }}
      />
      {showWarn && (
        <div
          class="rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200 leading-snug"
          dangerouslySetInnerHTML={{ __html: warnHtml }}
        />
      )}
    </>
  );
}

export async function showSystemPromptModal(provider: Provider, cb: SystemPromptModalCallbacks = {}): Promise<void> {
  // Resolve the three built-ins. `full` is the public/ai.md body for both
  // providers; we share the same source so users can compare what local
  // is missing relative to hosted Claude.
  const built: BuiltInPrompts = {
    slim: buildLocalSystemPrompt(),
    medium: buildMediumLocalSystemPrompt(),
    full: buildSystemPrompt(await loadAiMd()),
  };

  const settings = loadSettings();
  const override = settings.systemPromptOverrides?.[provider] ?? null;

  let providerDefaultTier: Tier;
  if (provider !== 'local') {
    providerDefaultTier = 'full';
  } else if (settings.toggles.localModel) {
    providerDefaultTier = resolveLocalModel(settings.toggles.localModel).promptTier;
  } else {
    providerDefaultTier = 'slim';
  }

  let initial: Tier;
  if (override === null) {
    initial = providerDefaultTier;
  } else if (override === built.slim) {
    initial = 'slim';
  } else if (override === built.medium) {
    initial = 'medium';
  } else if (override === built.full) {
    initial = 'full';
  } else {
    initial = 'custom';
  }

  const activeLocalContext: number | null =
    provider === 'local' && settings.toggles.localModel
      ? resolveLocalModel(settings.toggles.localModel).contextWindowSize
      : null;
  const fullPromptTokens = Math.round(built.full.length / 4);
  const fullFitsLocal = activeLocalContext !== null && fullPromptTokens + 2000 < activeLocalContext;

  const text = signal(initial === 'custom' ? (override ?? built[providerDefaultTier]) : built[initial]);
  const tier = signal<Tier>(initial);

  const titleStr = `System prompt — ${provider === 'local' ? 'Local (WebGPU)' : `${providerLabel(provider)} (cloud)`}`;

  mountPreactModal(
    { title: titleStr, maxWidth: '2xl', scrollable: true },
    close => ({
      body: <PromptBody
        provider={provider}
        built={built}
        providerDefaultTier={providerDefaultTier}
        activeLocalContext={activeLocalContext}
        fullFitsLocal={fullFitsLocal}
        text={text}
        tier={tier}
      />,
      footer: (
        // Reset on the left, Cancel + Save on the right. The shell's
        // footer is justify-end gap-2, so `mr-auto` on the left group
        // pushes it leftward without touching modalShell.
        <>
          <button
            type="button"
            class="mr-auto px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700 border border-zinc-600"
            title={`Replace the editor with the ${providerDefaultTier} tier (this provider's default). Saves nothing until you press Save.`}
            onClick={() => {
              text.value = built[providerDefaultTier as 'slim' | 'medium' | 'full'];
              tier.value = providerDefaultTier;
            }}
          >Reset to provider default</button>
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={close}
          >Cancel</button>
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
            onClick={() => {
              const value = text.value;
              const matched = detectTierFromText(value, built);
              // Saving a verbatim built-in tier clears the override IF
              // it matches the provider's default. Otherwise persist.
              const next: string | null = matched === providerDefaultTier ? null : value;
              // Route through the signal-backed store so the AI Settings
              // modal (if open) re-reads the new override on its next paint.
              setSettings(setSystemPromptOverride(loadSettings(), provider, next));
              cb.onChange?.();
              close();
            }}
          >Save</button>
        </>
      ),
    }),
  );
}
