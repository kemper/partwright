// Per-browser AI settings (preset, model, toggles). Persisted to
// localStorage as one JSON blob — they're sticky across sessions and
// separate from the per-session chat transcripts in IndexedDB.

import { MAX_ITERATIONS, MAX_SPEND, type ChatToggles, type ModelId, type Preset } from './types';

const STORAGE_KEY = 'partwright-ai-settings-v1';

export interface AiSettings {
  preset: Preset;
  toggles: ChatToggles;
  /** When `false`, the chat drawer starts collapsed on page load. */
  drawerOpen: boolean;
}

const PRESET_TOGGLES: Record<Exclude<Preset, 'custom'>, ChatToggles> = {
  minimal: {
    vision: { views: false },
    scope: { runCode: true, saveVersions: true, paintFaces: false },
    autoRetry: 0,
    maxIterations: 'low',
    maxSpend: 'cheap',
    model: 'claude-haiku-4-5',
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
    model: 'claude-sonnet-4-6',
  },
  full: {
    vision: { views: true },
    scope: { runCode: true, saveVersions: true, paintFaces: true },
    autoRetry: 3,
    maxIterations: 'high',
    maxSpend: 'high',
    model: 'claude-opus-4-7',
  },
};

const DEFAULT_SETTINGS: AiSettings = {
  preset: 'standard',
  toggles: PRESET_TOGGLES.standard,
  drawerOpen: false,
};

let cached: AiSettings | null = null;
const listeners = new Set<(settings: AiSettings) => void>();

export function loadSettings(): AiSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>;
      cached = mergeWithDefaults(parsed);
      return cached;
    }
  } catch {
    // Fall through to defaults on parse / storage error.
  }
  cached = { ...DEFAULT_SETTINGS, toggles: { ...DEFAULT_SETTINGS.toggles, vision: { ...DEFAULT_SETTINGS.toggles.vision }, scope: { ...DEFAULT_SETTINGS.toggles.scope } } };
  return cached;
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
      maxIterations: p.maxIterations,
      maxSpend: p.maxSpend,
      model: p.model,
    },
  };
}

export function setModel(settings: AiSettings, model: ModelId): AiSettings {
  return {
    ...settings,
    preset: 'custom',
    toggles: { ...settings.toggles, model },
  };
}

export function setToggles(settings: AiSettings, partial: DeepPartial<ChatToggles>): AiSettings {
  const next: ChatToggles = {
    vision: { ...settings.toggles.vision, ...(partial.vision ?? {}) },
    scope: { ...settings.toggles.scope, ...(partial.scope ?? {}) },
    autoRetry: partial.autoRetry ?? settings.toggles.autoRetry,
    maxIterations: partial.maxIterations ?? settings.toggles.maxIterations,
    maxSpend: partial.maxSpend ?? settings.toggles.maxSpend,
    model: partial.model ?? settings.toggles.model,
  };
  return { ...settings, preset: 'custom', toggles: next };
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function mergeWithDefaults(partial: Partial<AiSettings>): AiSettings {
  const tgls: Partial<ChatToggles> = partial.toggles ?? {};
  return {
    preset: partial.preset ?? DEFAULT_SETTINGS.preset,
    drawerOpen: partial.drawerOpen ?? DEFAULT_SETTINGS.drawerOpen,
    toggles: {
      vision: { ...DEFAULT_SETTINGS.toggles.vision, ...(tgls.vision ?? {}) },
      scope: { ...DEFAULT_SETTINGS.toggles.scope, ...(tgls.scope ?? {}) },
      autoRetry: tgls.autoRetry ?? DEFAULT_SETTINGS.toggles.autoRetry,
      maxIterations: tgls.maxIterations ?? DEFAULT_SETTINGS.toggles.maxIterations,
      maxSpend: tgls.maxSpend ?? DEFAULT_SETTINGS.toggles.maxSpend,
      model: tgls.model ?? DEFAULT_SETTINGS.toggles.model,
    },
  };
}

export const MAX_ITERATIONS_OPTIONS: { id: ChatToggles['maxIterations']; label: string; hint: string }[] =
  (Object.entries(MAX_ITERATIONS) as [ChatToggles['maxIterations'], (typeof MAX_ITERATIONS)[keyof typeof MAX_ITERATIONS]][])
    .map(([id, v]) => ({ id, label: v.label, hint: v.hint }));

export const MAX_SPEND_OPTIONS: { id: ChatToggles['maxSpend']; label: string; hint: string }[] =
  (Object.entries(MAX_SPEND) as [ChatToggles['maxSpend'], (typeof MAX_SPEND)[keyof typeof MAX_SPEND]][])
    .map(([id, v]) => ({ id, label: v.label, hint: v.hint }));

export const MODEL_OPTIONS: { id: ModelId; label: string }[] = [
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
