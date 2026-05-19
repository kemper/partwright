// Per-browser AI settings (provider, preset, model, toggles, caps).
// Persisted to localStorage as one JSON blob — sticky across sessions and
// separate from the per-session chat transcripts in IndexedDB.

import { MAX_ITERATIONS, MAX_SPEND, type AnthropicModelId, type ChatToggles, type ModelId, type Preset, type Provider } from './types';
import type { LocalModelId } from './localModels';
import { LOCAL_MODELS } from './localModels';

const STORAGE_KEY = 'partwright-ai-settings-v1';

export interface AiSettings {
  preset: Preset;
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
  /** User-added local models. Lets the user load any MLC-compiled model
   *  from Hugging Face (or anywhere) without us shipping it in the
   *  curated list. Persisted in localStorage so they don't have to
   *  re-add them every session. */
  customLocalModels: CustomLocalModel[];
  /** Power-user knobs for the local provider. Lets you trade KV-cache
   *  VRAM for longer conversations, or flip into sliding-window mode so
   *  old turns drop off silently instead of erroring. */
  localContext: LocalContextSettings;
  /** Saved width of the AI chat drawer in pixels. */
  aiPanelWidth: number;
}

export interface CustomLocalModel {
  /** Stable id — the WebLLM model_id. Must be unique across the user's
   *  custom list and not collide with built-in model_ids. */
  id: string;
  /** Optional human-readable label. Falls back to `id` when blank. */
  label: string;
  /** HF weights URL, e.g. https://huggingface.co/org/repo. */
  modelUrl: string;
  /** Compiled WASM URL. When blank we try to guess from the standard
   *  WebLLM model-lib path; the engine surfaces a clear error if the
   *  guess is wrong. */
  modelLibUrl: string;
  /** Saved by the user for their own reference; not enforced. */
  vramMB?: number;
  /** Optional override for this model's context window. Falls back to
   *  4096 when blank. */
  contextWindowSize?: number;
  addedAt: number;
}

export interface LocalContextSettings {
  /** Per-origin override of every model's default context window. `null`
   *  means use whatever the model declares in LocalModelInfo. Setting it
   *  higher than the model's compiled max throws at reload — we catch
   *  that and fall back automatically. */
  windowSizeOverride: number | null;
  /** When true, the engine is loaded with `sliding_window_size` instead
   *  of `context_window_size`. Old turns drop off as new ones arrive;
   *  the conversation never errors with "prompt tokens exceed window",
   *  but the model loses long-range coherence. */
  sliding: boolean;
  /** Seconds without a new token before the stall watchdog fires and
   *  auto-retries the request. Default 35. Increase for slow models on
   *  modest hardware (e.g. a large quant on CPU-assisted inference). */
  stallTimeoutSec: number;
}

const DEFAULT_TOGGLES_BY_PRESET: Record<Exclude<Preset, 'custom'>, Omit<ChatToggles, 'provider' | 'anthropicModel' | 'localModel'> & { anthropicModel: AnthropicModelId }> = {
  minimal: {
    vision: { views: false },
    scope: { runCode: true, saveVersions: true, paintFaces: false },
    autoRetry: 0,
    maxIterations: 'low',
    maxSpend: 'cheap',
    anthropicModel: 'claude-haiku-4-5',
  },
  standard: {
    vision: { views: true },
    // Paint off by default — color regions lock the editor and are easy
    // for the model to mis-target. Users who want AI-driven painting
    // can flip the Paint pill on, or pick the Full preset.
    scope: { runCode: true, saveVersions: true, paintFaces: false },
    autoRetry: 1,
    maxIterations: 'medium',
    maxSpend: 'medium',
    anthropicModel: 'claude-sonnet-4-6',
  },
  full: {
    vision: { views: true },
    scope: { runCode: true, saveVersions: true, paintFaces: true },
    autoRetry: 3,
    maxIterations: 'high',
    maxSpend: 'high',
    anthropicModel: 'claude-opus-4-7',
  },
};

const DEFAULT_TOGGLES: ChatToggles = {
  ...DEFAULT_TOGGLES_BY_PRESET.standard,
  provider: 'anthropic',
  localModel: null,
};

const DEFAULT_SETTINGS: AiSettings = {
  preset: 'standard',
  toggles: DEFAULT_TOGGLES,
  drawerOpen: false,
  autoCompactMode: 'off',
  systemPromptOverrides: { anthropic: null, local: null },
  customLocalModels: [],
  localContext: { windowSizeOverride: null, sliding: false, stallTimeoutSec: 35 },
  aiPanelWidth: 420,
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
    maxIterations: t.maxIterations,
    maxSpend: t.maxSpend,
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
  const p = DEFAULT_TOGGLES_BY_PRESET[preset];
  return {
    ...settings,
    preset,
    toggles: {
      vision: { ...p.vision },
      scope: { ...p.scope },
      autoRetry: p.autoRetry,
      maxIterations: p.maxIterations,
      maxSpend: p.maxSpend,
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
export function setLocalModel(settings: AiSettings, modelId: string | null): AiSettings {
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
    maxIterations: partial.maxIterations ?? settings.toggles.maxIterations,
    maxSpend: partial.maxSpend ?? settings.toggles.maxSpend,
    provider: partial.provider ?? settings.toggles.provider,
    anthropicModel: partial.anthropicModel ?? settings.toggles.anthropicModel,
    localModel: partial.localModel ?? settings.toggles.localModel,
  };
  return { ...settings, preset: 'custom', toggles: next };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/** Legacy shape — accepts the pre-provider single `model` field (v1 BYO-key
 *  release) so users with old localStorage records don't lose state. */
interface LegacyAiSettings {
  preset?: Preset;
  autoCompactMode?: AiSettings['autoCompactMode'];
  drawerOpen?: boolean;
  toggles?: Partial<ChatToggles> & { model?: ModelId };
  systemPromptOverrides?: Partial<AiSettings['systemPromptOverrides']>;
  customLocalModels?: CustomLocalModel[];
  localContext?: Partial<LocalContextSettings>;
  aiPanelWidth?: number;
}

/** Return `id` as a valid LocalModelId when it exists in the curated list
 *  or the user's custom model list; null otherwise.  Called at settings-load
 *  time so stale IDs (e.g. models removed from the curated list) are silently
 *  cleared rather than propagating to `resolveLocalModel` and throwing. */
function resolveValidLocalModel(
  id: string | null | undefined,
  customModels: Array<{ id: string }>,
): LocalModelId | null {
  if (!id) return null;
  if (LOCAL_MODELS.some(m => m.id === id)) return id as LocalModelId;
  if (customModels.some(m => m.id === id)) return id as LocalModelId;
  return null;
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

  const overrides = partial.systemPromptOverrides ?? {};
  const rawLocalModel = tgls.localModel ?? (legacyIsLocal ? (legacyModel as string) : null);
  const validLocalModel = resolveValidLocalModel(
    rawLocalModel,
    Array.isArray(partial.customLocalModels) ? partial.customLocalModels : [],
  );
  const requestedProvider = tgls.provider ?? (legacyIsLocal ? 'local' : DEFAULT_SETTINGS.toggles.provider);
  // If we had to drop a saved local-model id (curated list pruned it), also
  // revert the provider. Otherwise the AI panel sticks on "No local model
  // picked" instead of offering the dual "Connect Anthropic API or run a
  // local model" prompt that fresh users get.
  const localModelCleared = rawLocalModel !== null && validLocalModel === null;
  const provider = localModelCleared && requestedProvider === 'local'
    ? DEFAULT_SETTINGS.toggles.provider
    : requestedProvider;
  return {
    preset: partial.preset ?? DEFAULT_SETTINGS.preset,
    autoCompactMode: partial.autoCompactMode ?? DEFAULT_SETTINGS.autoCompactMode,
    drawerOpen: partial.drawerOpen ?? DEFAULT_SETTINGS.drawerOpen,
    toggles: {
      vision: { ...DEFAULT_SETTINGS.toggles.vision, ...(tgls.vision ?? {}) },
      scope: { ...DEFAULT_SETTINGS.toggles.scope, ...(tgls.scope ?? {}) },
      autoRetry: tgls.autoRetry ?? DEFAULT_SETTINGS.toggles.autoRetry,
      maxIterations: tgls.maxIterations ?? DEFAULT_SETTINGS.toggles.maxIterations,
      maxSpend: tgls.maxSpend ?? DEFAULT_SETTINGS.toggles.maxSpend,
      provider,
      anthropicModel: tgls.anthropicModel ?? legacyAnthropic ?? DEFAULT_SETTINGS.toggles.anthropicModel,
      localModel: validLocalModel,
    },
    systemPromptOverrides: {
      anthropic: overrides.anthropic ?? null,
      local: overrides.local ?? null,
    },
    customLocalModels: Array.isArray(partial.customLocalModels) ? partial.customLocalModels : [],
    localContext: normalizeLocalContext(partial.localContext),
    aiPanelWidth: typeof partial.aiPanelWidth === 'number' && partial.aiPanelWidth >= 280 ? partial.aiPanelWidth : DEFAULT_SETTINGS.aiPanelWidth,
  };
}

function normalizeLocalContext(raw: Partial<LocalContextSettings> | undefined): LocalContextSettings {
  const override = raw?.windowSizeOverride;
  const timeout = raw?.stallTimeoutSec;
  return {
    windowSizeOverride: typeof override === 'number' && override > 0 ? Math.floor(override) : null,
    sliding: raw?.sliding === true,
    stallTimeoutSec: typeof timeout === 'number' && timeout >= 5 ? Math.floor(timeout) : 35,
  };
}

export function setLocalContext(settings: AiSettings, partial: Partial<LocalContextSettings>): AiSettings {
  return {
    ...settings,
    localContext: {
      ...settings.localContext,
      ...partial,
    },
  };
}

export function setAutoCompactMode(settings: AiSettings, mode: AiSettings['autoCompactMode']): AiSettings {
  return { ...settings, autoCompactMode: mode };
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

/** Error thrown when a custom-model id would shadow a curated entry.
 *  Callers should catch this and show an inline error in the form rather
 *  than letting the throw escape. */
export class BuiltInModelIdCollision extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`The id "${id}" matches a built-in model. Customs must use a unique id.`);
    this.id = id;
    this.name = 'BuiltInModelIdCollision';
  }
}

export function addCustomLocalModel(settings: AiSettings, model: CustomLocalModel): AiSettings {
  // Reject ids that already belong to a curated model — otherwise the
  // user can silently override (and break) a built-in entry by pasting
  // its repo URL.
  if (LOCAL_MODELS.some(m => m.id === model.id)) {
    throw new BuiltInModelIdCollision(model.id);
  }
  // De-dupe by id — replace any existing entry with the same id.
  const filtered = settings.customLocalModels.filter(m => m.id !== model.id);
  return { ...settings, customLocalModels: [...filtered, model] };
}

export function removeCustomLocalModel(settings: AiSettings, id: string): AiSettings {
  // If the user is currently using this custom model, clear the active
  // selection too — otherwise the chat panel keeps a stale id and
  // `resolveLocalModel` throws on the next render.
  const clearedActive = settings.toggles.localModel === id
    ? { ...settings.toggles, localModel: null }
    : settings.toggles;
  return {
    ...settings,
    toggles: clearedActive,
    customLocalModels: settings.customLocalModels.filter(m => m.id !== id),
  };
}

export const MAX_ITERATIONS_OPTIONS: { id: ChatToggles['maxIterations']; label: string; hint: string }[] =
  (Object.entries(MAX_ITERATIONS) as [ChatToggles['maxIterations'], (typeof MAX_ITERATIONS)[keyof typeof MAX_ITERATIONS]][])
    .map(([id, v]) => ({ id, label: v.label, hint: v.hint }));

export const MAX_SPEND_OPTIONS: { id: ChatToggles['maxSpend']; label: string; hint: string }[] =
  (Object.entries(MAX_SPEND) as [ChatToggles['maxSpend'], (typeof MAX_SPEND)[keyof typeof MAX_SPEND]][])
    .map(([id, v]) => ({ id, label: v.label, hint: v.hint }));

export const ANTHROPIC_MODEL_OPTIONS: { id: AnthropicModelId; label: string }[] = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
];

export const PRESET_OPTIONS: { id: Preset; label: string; hint: string }[] = [
  { id: 'minimal', label: 'Minimal', hint: 'Haiku · code only · no images · no retries' },
  { id: 'standard', label: 'Standard', hint: 'Sonnet · run + save + views · paint off · 1 retry' },
  { id: 'full', label: 'Full', hint: 'Opus · every tool incl. paint · views · 3 retries' },
  { id: 'custom', label: 'Custom', hint: 'whatever you have set with the toggles below' },
];

export const AUTO_COMPACT_OPTIONS: { id: AiSettings['autoCompactMode']; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Only the Compact button condenses the chat.' },
  { id: 'conservative', label: 'Hint at 80%', hint: 'Nag you to compact when the context fills up; never runs without your click.' },
  { id: 'standard', label: 'Auto at 70%', hint: 'Silently compact when 70% full; keep the last 4 turns verbatim.' },
  { id: 'aggressive', label: 'After every turn', hint: 'Compact after every assistant turn; keep only the last exchange. Best when full history doesn\'t matter — like driving the modeler.' },
];
