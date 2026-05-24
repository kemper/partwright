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

import { loadSettings, saveSettings, setSystemPromptOverride, providerLabel } from '../ai/settings';
import { buildLocalSystemPrompt, buildMediumLocalSystemPrompt, buildSystemPrompt, loadAiMd } from '../ai/systemPrompt';
import { resolveLocalModel } from '../ai/local';
import type { Provider } from '../ai/types';

let modalEl: HTMLElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;

export interface SystemPromptModalCallbacks {
  onChange?: () => void;
}

type Tier = 'slim' | 'medium' | 'full' | 'custom';

interface BuiltInPrompts {
  slim: string;
  medium: string;
  full: string;
}

export async function showSystemPromptModal(provider: Provider, cb: SystemPromptModalCallbacks = {}): Promise<void> {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-2xl flex flex-col max-h-[90vh]';

  // Header
  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between shrink-0';
  const title = document.createElement('h2');
  title.className = 'text-sm font-semibold text-zinc-100';
  title.textContent = `System prompt — ${provider === 'local' ? 'Local (WebGPU)' : `${providerLabel(provider)} (cloud)`}`;
  header.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', closeModal);
  header.appendChild(closeBtn);
  modal.appendChild(header);

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

  // What the model in play would default to today, so we can show "(default
  // for this model)" next to the tier picker. Anthropic defaults to full;
  // local defaults to whichever tier the active model declares.
  let providerDefaultTier: Tier;
  if (provider !== 'local') {
    // Every hosted provider (Anthropic/OpenAI/Gemini) is sent the Full ai.md.
    providerDefaultTier = 'full';
  } else if (settings.toggles.localModel) {
    providerDefaultTier = resolveLocalModel(settings.toggles.localModel).promptTier;
  } else {
    providerDefaultTier = 'slim';
  }

  // Pick a starting tier: a saved override implies 'custom'; otherwise we
  // open on whatever the active provider defaults to.
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

  // Body
  const body = document.createElement('div');
  body.className = 'px-5 py-4 flex flex-col gap-3 text-sm text-zinc-200 overflow-y-auto';
  modal.appendChild(body);

  // Resolve the active local model's context ceiling so we can show a
  // realistic "will Full fit?" judgement instead of the old blanket 4K
  // assumption — most curated models now default to 32K.
  const activeLocalContext: number | null =
    provider === 'local' && settings.toggles.localModel
      ? resolveLocalModel(settings.toggles.localModel).contextWindowSize
      : null;
  const fullPromptTokens = Math.round(built.full.length / 4);
  const fullFitsLocal = activeLocalContext !== null && fullPromptTokens + 2000 < activeLocalContext;

  const intro = document.createElement('p');
  intro.className = 'text-zinc-300 leading-snug';
  if (provider === 'local') {
    const ctxLine = activeLocalContext === null
      ? 'No model is loaded yet — pick one in AI settings to see whether the Full tier fits its context window.'
      : `Active model context window: <strong>${activeLocalContext.toLocaleString()} tokens</strong>. ${fullFitsLocal
          ? 'The Full tier fits, but Slim or Medium leaves more room for tool docs, conversation, and the reply — and the model can pull subdoc detail on demand via <code>readDoc</code>.'
          : 'The Full tier (~' + Math.round(fullPromptTokens / 1000) + 'K tokens) is too large for this model — pick Slim or Medium, or enable sliding-window mode in AI settings.'}`;
    intro.innerHTML = `This is the wrapper prompt sent to every local-model turn. Pick a built-in tier or edit your own. ${ctxLine}`;
  } else {
    const cacheNote = provider === 'anthropic'
      ? ' (it\'s prompt-cached, so you pay for it once per cache window)'
      : '';
    intro.innerHTML = `This is the wrapper prompt sent to every ${providerLabel(provider)} turn. The Full tier is the default${cacheNote}. The Slim and Medium tiers are useful when you want to fit more conversation into context, paired with <code>readDoc</code> to pull subdoc detail on demand.`;
  }
  body.appendChild(intro);

  // Tier switcher row
  const tierWrap = document.createElement('div');
  tierWrap.className = 'flex flex-col gap-1';
  const tierLabel = document.createElement('div');
  tierLabel.className = 'text-xs text-zinc-400';
  tierLabel.textContent = 'Prompt tier';
  tierWrap.appendChild(tierLabel);

  const tierRow = document.createElement('div');
  tierRow.className = 'inline-flex rounded border border-zinc-700 overflow-hidden self-start';
  tierWrap.appendChild(tierRow);

  // Source pill + token estimate, updated reactively.
  const meta = document.createElement('div');
  meta.className = 'flex items-center gap-2 text-xs';
  const pill = document.createElement('span');
  meta.appendChild(pill);
  const tokenInfo = document.createElement('span');
  tokenInfo.className = 'text-zinc-500';
  meta.appendChild(tokenInfo);

  // Editor
  const ta = document.createElement('textarea');
  ta.className = 'w-full min-h-[260px] max-h-[50vh] px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs font-mono leading-snug focus:outline-none focus:border-blue-500 resize-y';
  ta.spellcheck = false;

  // The visible warning slot is only populated for the Full tier on local
  // when the active model's context can't hold it (the 4K-context 70B,
  // or custom models with a tight ceiling) — kept here so the layout
  // doesn't jump when switching tiers.
  const warn = document.createElement('div');
  warn.className = 'rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200 leading-snug hidden';
  warn.innerHTML = activeLocalContext !== null
    ? `The Full tier is <strong>~${Math.round(fullPromptTokens / 1000)}K tokens</strong>, which doesn't fit in this model's ${activeLocalContext.toLocaleString()}-token context window. Pick Slim or Medium, or enable sliding-window mode in AI settings.`
    : `The Full tier is <strong>~${Math.round(fullPromptTokens / 1000)}K tokens</strong>. Whether it fits depends on the active local model — most curated models default to 32K and have room, but the 4K-context Llama 70B will reject it.`;

  body.appendChild(tierWrap);
  body.appendChild(meta);
  body.appendChild(ta);
  body.appendChild(warn);

  let currentTier: Tier = initial;

  function paint(tier: Tier, opts: { resetText?: boolean } = {}): void {
    currentTier = tier;
    if (opts.resetText && tier !== 'custom') {
      ta.value = built[tier];
    }
    rebuildTierButtons();
    updateMeta();
    // Show the warning only when picking Full on local AND the Full tier
    // genuinely won't fit the active model's context. When it fits (most
    // 32K models), skip the warning — Full is a reasonable choice there.
    warn.classList.toggle('hidden', !(provider === 'local' && tier === 'full' && !fullFitsLocal));
  }

  function rebuildTierButtons(): void {
    tierRow.replaceChildren();
    const tiers: { id: Tier; label: string; size: string }[] = [
      { id: 'slim', label: 'Slim', size: `~${Math.round(built.slim.length / 4 / 100) * 100} tokens` },
      { id: 'medium', label: 'Medium', size: `~${(built.medium.length / 4 / 1000).toFixed(1)}K tokens` },
      { id: 'full', label: 'Full', size: `~${Math.round(built.full.length / 4 / 1000)}K tokens` },
      { id: 'custom', label: 'Custom', size: 'your edits' },
    ];
    for (const t of tiers) {
      const b = document.createElement('button');
      const active = currentTier === t.id;
      const isCustomEmpty = t.id === 'custom' && currentTier !== 'custom';
      b.className = active
        ? 'px-3 py-1 text-xs bg-zinc-700 text-zinc-100 border-r border-zinc-600 last:border-r-0'
        : 'px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-700/60 border-r border-zinc-700 last:border-r-0';
      const isDefault = t.id === providerDefaultTier;
      b.textContent = isDefault ? `${t.label} (default)` : t.label;
      b.title = `${t.size}${isDefault ? ' — this provider\'s default tier.' : ''}`;
      // Custom isn't directly selectable — it's an outcome of editing.
      // Clicking it just keeps the current text.
      if (isCustomEmpty) {
        b.disabled = true;
        b.classList.add('opacity-50', 'cursor-not-allowed');
      } else {
        b.addEventListener('click', () => paint(t.id, { resetText: t.id !== 'custom' }));
      }
      tierRow.appendChild(b);
    }
  }

  function updateMeta(): void {
    const chars = ta.value.length;
    const approx = Math.round(chars / 4);
    if (currentTier === 'custom') {
      pill.className = 'px-2 py-0.5 rounded bg-amber-900/40 text-amber-200 border border-amber-800/60';
      pill.textContent = 'Custom (override)';
    } else if (currentTier === 'full') {
      pill.className = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
      pill.textContent = 'Built-in · Full (public/ai.md)';
    } else if (currentTier === 'medium') {
      pill.className = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
      pill.textContent = 'Built-in · Medium';
    } else {
      pill.className = 'px-2 py-0.5 rounded bg-blue-900/40 text-blue-200 border border-blue-800/60';
      pill.textContent = 'Built-in · Slim';
    }
    tokenInfo.textContent = `· ${chars.toLocaleString()} chars · ~${approx.toLocaleString()} tokens`;
  }

  ta.value = initial === 'custom' ? (override ?? built[providerDefaultTier]) : built[initial];
  ta.addEventListener('input', () => {
    // The moment the textarea diverges from any built-in, flip to Custom.
    const matched = detectTierFromText(ta.value, built);
    paint(matched ?? 'custom');
  });
  paint(initial);

  modal.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'px-5 py-3 border-t border-zinc-700 flex items-center justify-between gap-2 shrink-0';

  const left = document.createElement('div');
  left.className = 'flex items-center gap-2';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700 border border-zinc-600';
  resetBtn.textContent = 'Reset to provider default';
  resetBtn.title = `Replace the editor with the ${providerDefaultTier} tier (this provider's default). Saves nothing until you press Save.`;
  resetBtn.addEventListener('click', () => {
    paint(providerDefaultTier, { resetText: true });
  });
  left.appendChild(resetBtn);
  footer.appendChild(left);

  const right = document.createElement('div');
  right.className = 'flex items-center gap-2';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);
  right.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const value = ta.value;
    const matched = detectTierFromText(value, built);
    // Saving a verbatim built-in tier clears the override IF it matches
    // the provider's default tier (so future default-prompt improvements
    // ship through). Otherwise we persist the override — that lets the
    // user pin Medium on Anthropic, or Full on local with sliding window.
    let next: string | null;
    if (matched === providerDefaultTier) {
      next = null;
    } else {
      next = value;
    }
    saveSettings(setSystemPromptOverride(loadSettings(), provider, next));
    cb.onChange?.();
    closeModal();
  });
  right.appendChild(saveBtn);
  footer.appendChild(right);

  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  modalEl = overlay;

  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', escHandler);
}

/** Returns 'slim' | 'medium' | 'full' when the editor contents match one of
 *  the built-in prompts verbatim (modulo trailing whitespace), or null
 *  when the user has made edits. */
function detectTierFromText(text: string, built: BuiltInPrompts): 'slim' | 'medium' | 'full' | null {
  const t = text.trim();
  if (t === built.slim.trim()) return 'slim';
  if (t === built.medium.trim()) return 'medium';
  if (t === built.full.trim()) return 'full';
  return null;
}

function closeModal(): void {
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  modalEl?.remove();
  modalEl = null;
}
