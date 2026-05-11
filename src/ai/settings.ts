// Per-browser AI settings (provider, preset, model, toggles). Persisted to
// localStorage as one JSON blob — they're sticky across sessions and
// separate from the per-session chat transcripts in IndexedDB.

import type { AnthropicModelId, ChatToggles, ModelId, Preset, Provider } from './types';
import type { LocalModelId } from './localModels';
import { DEFAULT_LOCAL_MODEL } from './localModels';

const STORAGE_KEY = 'partwright-ai-settings-v1';

export interface AiSettings {
  preset: Preset;
  toggles: ChatToggles;
  /** When `false`, the chat drawer starts collapsed on page load. */
  drawerOpen: boolean;
  /** Default for new sessions before the user has touched the toggle bar. */
  autoCompactMode: 'off' | 'conservative' | 'standard' | 'aggressive';
}

const PRESET_TOGGLES: Record<Exclude<Preset, 'custom'>, ChatToggles> = {
  minimal: {
    vision: { views: false },
    scope: { runCode: true, saveVersions: true, paintFaces: false },
    autoRetry: 0,
    provider: 'anthropic',
    anthropicModel: 'claude-haiku-4-5',
    localModel: null,
  },
  standard: {
    vision: { views: true },
    scope: { runCode: true, saveVersions: true, paintFaces: true },
    autoRetry: 1,
    provider: 'anthropic',
    anthropicModel: 'claude-sonnet-4-6',
    localModel: null,
  },
  full: {
    vision: { views: true },
    scope: { runCode: true, saveVersions: true, paintFaces: true },
    autoRetry: 3,
    provider: 'anthropic',
    anthropicModel: 'claude-opus-4-7',
    localModel: null,
  },
};

const DEFAULT_SETTINGS: AiSettings = {
  preset: 'standard',
  toggles: PRESET_TOGGLES.standard,
  drawerOpen: false,
  autoCompactMode: 'off',
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

export function applyPreset(settings: AiSettings, preset: Preset): AiSettings {
  if (preset === 'custom') return { ...settings, preset };
  const p = PRESET_TOGGLES[preset];
  return {
    ...settings,
    preset,
    toggles: {
      vision: { ...p.vision },
      scope: { ...p.scope },
      autoRetry: p.autoRetry,
      // Presets target Anthropic, but if the user is currently on local,
      // keep them on local — the preset only adjusts cost/scope/views.
      provider: settings.toggles.provider,
      anthropicModel: p.anthropicModel,
      localModel: settings.toggles.localModel,
    },
  };
}

/** Set the Anthropic-side model. Used when the user picks Haiku/Sonnet/Opus
 *  from the header dropdown while on the Anthropic provider. */
export function setAnthropicModel(settings: AiSettings, model: AnthropicModelId): AiSettings {
  return {
    ...settings,
    preset: 'custom',
    toggles: { ...settings.toggles, anthropicModel: model },
  };
}

/** Switch provider. Called from the AI settings modal. The previously-picked
 *  per-provider model is preserved so toggling back and forth doesn't lose
 *  the selection. */
export function setProvider(settings: AiSettings, provider: Provider): AiSettings {
  return {
    ...settings,
    preset: 'custom',
    toggles: { ...settings.toggles, provider },
  };
}

/** Set the WebLLM model id for the local provider. Called when the user
 *  downloads / activates a model in the local-model modal. */
export function setLocalModel(settings: AiSettings, modelId: LocalModelId | null): AiSettings {
  return {
    ...settings,
    preset: 'custom',
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
  return { ...settings, preset: 'custom', toggles: next };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Legacy shape (v1 release) — pre-provider, single `model` field. We accept
 *  it on load and split it into anthropicModel + the new provider field so
 *  users upgrading from the BYO-Anthropic-only build don't lose state. */
interface LegacyAiSettings {
  preset?: Preset;
  autoCompactMode?: AiSettings['autoCompactMode'];
  drawerOpen?: boolean;
  toggles?: Partial<ChatToggles> & { model?: ModelId };
}

function mergeWithDefaults(partial: LegacyAiSettings): AiSettings {
  const tgls = partial.toggles ?? {};
  // Pre-provider builds stored a single `model` field on toggles. Detect
  // its shape: Anthropic ids start with "claude-", local WebLLM ids contain
  // "-MLC".
  const legacyModel = tgls.model;
  const legacyIsLocal = typeof legacyModel === 'string' && legacyModel.endsWith('-MLC');
  const legacyAnthropic: AnthropicModelId | undefined = legacyModel === 'claude-haiku-4-5' || legacyModel === 'claude-sonnet-4-6' || legacyModel === 'claude-opus-4-7'
    ? legacyModel
    : undefined;

  return {
    preset: partial.preset ?? DEFAULT_SETTINGS.preset,
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
  };
}

export const ANTHROPIC_MODEL_OPTIONS: { id: AnthropicModelId; label: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
];

export const PRESET_OPTIONS: { id: Preset; label: string; hint: string }[] = [
  { id: 'minimal', label: 'Minimal', hint: 'code-only, Haiku, no retries' },
  { id: 'standard', label: 'Standard', hint: 'code + iso views, Sonnet, 1 retry' },
  { id: 'full', label: 'Full', hint: 'all tools + views, Opus, 3 retries' },
  { id: 'custom', label: 'Custom', hint: 'your toggles' },
];

/** Helper: a fresh first-time settings object with the local provider
 *  pre-armed to the recommended default. Used by the local-model modal so
 *  the very first download flips the user onto local in one motion. */
export function defaultLocalSettings(): AiSettings {
  return {
    ...cloneDefaults(),
    toggles: {
      ...cloneDefaults().toggles,
      provider: 'local',
      localModel: DEFAULT_LOCAL_MODEL,
    },
  };
}
