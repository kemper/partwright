// Per-browser AI settings (provider, model, toggles). Persisted to
// localStorage as one JSON blob — they're sticky across sessions and
// separate from the per-session chat transcripts in IndexedDB.

import type { AnthropicModelId, ChatToggles, ModelId, Provider } from './types';
import type { LocalModelId } from './localModels';

const STORAGE_KEY = 'partwright-ai-settings-v1';

export interface AiSettings {
  toggles: ChatToggles;
  /** When `false`, the chat drawer starts collapsed on page load. */
  drawerOpen: boolean;
  /** Default for new sessions before the user has touched the toggle bar. */
  autoCompactMode: 'off' | 'conservative' | 'standard' | 'aggressive';
  /** User-overridden system prompts. `null` means "use the built-in default
   *  for this provider". We keep them per-provider so the slim local
   *  prompt and the full Anthropic prompt can be edited independently. */
  systemPromptOverrides: {
    anthropic: string | null;
    local: string | null;
  };
}

const DEFAULT_TOGGLES: ChatToggles = {
  vision: { views: true },
  scope: { runCode: true, saveVersions: true, paintFaces: true },
  autoRetry: 1,
  provider: 'anthropic',
  anthropicModel: 'claude-sonnet-4-6',
  localModel: null,
};

const DEFAULT_SETTINGS: AiSettings = {
  toggles: DEFAULT_TOGGLES,
  drawerOpen: false,
  autoCompactMode: 'off',
  systemPromptOverrides: { anthropic: null, local: null },
};

let cached: AiSettings | null = null;
const listeners = new Set<(settings: AiSettings) => void>();

export function loadSettings(): AiSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LegacyAiSettings>;
      cached = mergeWithDefaults(parsed);
      return cached;
    }
  } catch {
    // Fall through to defaults on parse / storage error.
  }
  cached = cloneDefaults();
  return cached;
}

function cloneDefaults(): AiSettings {
  return {
    ...DEFAULT_SETTINGS,
    toggles: cloneToggles(DEFAULT_SETTINGS.toggles),
  };
}

function cloneToggles(t: ChatToggles): ChatToggles {
  return {
    vision: { ...t.vision },
    scope: { ...t.scope },
    autoRetry: t.autoRetry,
    provider: t.provider,
    anthropicModel: t.anthropicModel,
    localModel: t.localModel,
  };
}

export function saveSettings(next: AiSettings): void {
  cached = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be full or disabled (private browsing). Settings
    // remain applied for this session; we don't surface the failure.
  }
  for (const fn of listeners) fn(next);
}

export function onSettingsChange(fn: (settings: AiSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Set the Anthropic-side model. Used when the user picks Haiku/Sonnet/Opus
 *  from the header dropdown while on the Anthropic provider. */
export function setAnthropicModel(settings: AiSettings, model: AnthropicModelId): AiSettings {
  return {
    ...settings,
    toggles: { ...settings.toggles, anthropicModel: model },
  };
}

/** Switch provider. Called from the AI settings modal. The previously-picked
 *  per-provider model is preserved so toggling back and forth doesn't lose
 *  the selection. */
export function setProvider(settings: AiSettings, provider: Provider): AiSettings {
  return {
    ...settings,
    toggles: { ...settings.toggles, provider },
  };
}

/** Set the WebLLM model id for the local provider. Called when the user
 *  downloads / activates a model in the local-model modal. */
export function setLocalModel(settings: AiSettings, modelId: LocalModelId | null): AiSettings {
  return {
    ...settings,
    toggles: { ...settings.toggles, localModel: modelId },
  };
}

export function setToggles(settings: AiSettings, partial: DeepPartial<ChatToggles>): AiSettings {
  const next: ChatToggles = {
    vision: { ...settings.toggles.vision, ...(partial.vision ?? {}) },
    scope: { ...settings.toggles.scope, ...(partial.scope ?? {}) },
    autoRetry: partial.autoRetry ?? settings.toggles.autoRetry,
    provider: partial.provider ?? settings.toggles.provider,
    anthropicModel: partial.anthropicModel ?? settings.toggles.anthropicModel,
    localModel: partial.localModel ?? settings.toggles.localModel,
  };
  return { ...settings, toggles: next };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Legacy shape — accepts the pre-provider single `model` field (v1 BYO-key
 *  release) and the v1.1 `preset` field, both of which are now unused but
 *  may still be sitting in users' localStorage. */
interface LegacyAiSettings {
  preset?: unknown;
  autoCompactMode?: AiSettings['autoCompactMode'];
  drawerOpen?: boolean;
  toggles?: Partial<ChatToggles> & { model?: ModelId };
}

function mergeWithDefaults(partial: LegacyAiSettings): AiSettings {
  const tgls = partial.toggles ?? {};
  // Pre-provider builds stored a single `model` field on toggles. Detect
  // its shape: Anthropic ids start with "claude-", local WebLLM ids end with
  // "-MLC".
  const legacyModel = tgls.model;
  const legacyIsLocal = typeof legacyModel === 'string' && legacyModel.endsWith('-MLC');
  const legacyAnthropic: AnthropicModelId | undefined = legacyModel === 'claude-haiku-4-5' || legacyModel === 'claude-sonnet-4-6' || legacyModel === 'claude-opus-4-7'
    ? legacyModel
    : undefined;

  const overrides = (partial as { systemPromptOverrides?: Partial<AiSettings['systemPromptOverrides']> }).systemPromptOverrides ?? {};
  return {
    autoCompactMode: partial.autoCompactMode ?? DEFAULT_SETTINGS.autoCompactMode,
    drawerOpen: partial.drawerOpen ?? DEFAULT_SETTINGS.drawerOpen,
    toggles: {
      vision: { ...DEFAULT_SETTINGS.toggles.vision, ...(tgls.vision ?? {}) },
      scope: { ...DEFAULT_SETTINGS.toggles.scope, ...(tgls.scope ?? {}) },
      autoRetry: tgls.autoRetry ?? DEFAULT_SETTINGS.toggles.autoRetry,
      provider: tgls.provider ?? (legacyIsLocal ? 'local' : DEFAULT_SETTINGS.toggles.provider),
      anthropicModel: tgls.anthropicModel ?? legacyAnthropic ?? DEFAULT_SETTINGS.toggles.anthropicModel,
      localModel: tgls.localModel ?? (legacyIsLocal ? (legacyModel as LocalModelId) : DEFAULT_SETTINGS.toggles.localModel),
    },
    systemPromptOverrides: {
      anthropic: overrides.anthropic ?? null,
      local: overrides.local ?? null,
    },
  };
}

/** Replace or clear the custom system prompt for one provider. Passing
 *  `null` reverts to the built-in default. */
export function setSystemPromptOverride(settings: AiSettings, provider: Provider, prompt: string | null): AiSettings {
  return {
    ...settings,
    systemPromptOverrides: {
      ...settings.systemPromptOverrides,
      [provider]: prompt && prompt.trim().length > 0 ? prompt : null,
    },
  };
}

export const ANTHROPIC_MODEL_OPTIONS: { id: AnthropicModelId; label: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
];

