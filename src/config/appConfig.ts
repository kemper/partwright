// Centralized app-wide configuration with user-overridable defaults.
// Persisted to localStorage as a full config snapshot. Any field not present
// in the stored blob falls back to the matching default — so adding a new
// setting never breaks existing saves.
//
// Worker context: localStorage is unavailable in Web Workers. Any module
// imported by a Worker (e.g. agentWorker.ts) falls back to the static
// defaults without side-effects — the Worker never sees user overrides, but
// those values (tool call timeout, thinking budgets) are passed through the
// run_turn message where they matter.

const STORAGE_KEY = 'partwright-app-config-v1';

export interface AppConfig {
  ai: {
    /** Max consecutive auto-resume nudges with no tool call before the loop
     *  falls through to a normal end_turn outcome. Resets on any tool call. */
    maxConsecutiveAutoResumes: number;
    /** Tool execution wall-clock time (ms) above which a console warning fires. */
    slowToolMs: number;
    /** In-memory ring buffer size for the AI diagnostics log. */
    diagnosticsRingSize: number;
    /** Max images kept in the "recent attachments" picker (IndexedDB rows). */
    maxAttachments: number;
    /** Timeout (ms) before a stalled tool-call round-trip in the agent Worker
     *  is rejected. Passed through the run_turn message so the Worker can use
     *  the user's value rather than falling back to defaults. */
    toolCallTimeoutMs: number;
    /** Extended-thinking token budgets for Anthropic (per thinking level). */
    thinkingBudgetAnthropicLow: number;
    thinkingBudgetAnthropicMedium: number;
    thinkingBudgetAnthropicHigh: number;
    /** Extended-thinking token budgets for Gemini (per thinking level). */
    thinkingBudgetGeminiLow: number;
    thinkingBudgetGeminiMedium: number;
    thinkingBudgetGeminiHigh: number;
    /** Output token headroom reserved for the answer above the Anthropic
     *  thinking budget. The API requires max_tokens > budget_tokens. */
    answerHeadroomTokens: number;
    /** Default max output tokens for Anthropic stream turns. */
    maxOutputTokensAnthropic: number;
    /** Default max output tokens for OpenAI stream turns (Responses + Chat). */
    maxOutputTokensOpenai: number;
    /** Default max output tokens for Gemini stream turns (combined thinking +
     *  answer ceiling). */
    maxOutputTokensGemini: number;
    /** Rough characters-per-token ratio for token count estimation. */
    charsPerToken: number;
    /** Estimated tokens per image block at standard resolution. */
    imageTokenEstimate: number;
  };
  renderer: {
    /** Three.js camera field-of-view in degrees. Takes effect on page reload. */
    fov: number;
    /** Maximum device pixel ratio cap. Higher = sharper on HiDPI, more GPU. */
    maxPixelRatio: number;
    /** Render scale during camera orbit/zoom (0–1, lower = faster interaction). */
    interactionRenderScale: number;
    /** Ground grid total size in world units. Takes effect on page reload. */
    gridSize: number;
    /** Number of grid divisions. Takes effect on page reload. */
    gridDivisions: number;
  };
  import: {
    /** Vertex-weld tolerance for STL imports (world units). */
    stlWeldTolerance: number;
    /** Default max voxel grid dimension for image → voxel imports. */
    voxelDefaultMaxSize: number;
    /** Voxel count above which the import UI shows a performance warning. */
    voxelHeavyThreshold: number;
    /** Max image resolution (pixels per side) when importing for relief. */
    reliefMaxResolution: number;
  };
  ui: {
    /** How long toast notifications stay on screen (ms). */
    toastDurationMs: number;
    /** Hover-tooltip show delay (ms). */
    tooltipDelayMs: number;
  };
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  ai: {
    maxConsecutiveAutoResumes: 8,
    slowToolMs: 250,
    diagnosticsRingSize: 50,
    maxAttachments: 20,
    toolCallTimeoutMs: 60_000,
    thinkingBudgetAnthropicLow: 2048,
    thinkingBudgetAnthropicMedium: 8192,
    thinkingBudgetAnthropicHigh: 16384,
    thinkingBudgetGeminiLow: 2048,
    thinkingBudgetGeminiMedium: 8192,
    thinkingBudgetGeminiHigh: 24576,
    answerHeadroomTokens: 8192,
    maxOutputTokensAnthropic: 8192,
    maxOutputTokensOpenai: 8192,
    maxOutputTokensGemini: 32768,
    charsPerToken: 4,
    imageTokenEstimate: 1500,
  },
  renderer: {
    fov: 50,
    maxPixelRatio: 2,
    interactionRenderScale: 0.6,
    gridSize: 40,
    gridDivisions: 40,
  },
  import: {
    stlWeldTolerance: 1e-5,
    voxelDefaultMaxSize: 64,
    voxelHeavyThreshold: 250_000,
    reliefMaxResolution: 512,
  },
  ui: {
    toastDurationMs: 2200,
    tooltipDelayMs: 150,
  },
};

let cachedConfig: AppConfig | null = null;
const listeners = new Set<(cfg: AppConfig) => void>();

function isWorkerContext(): boolean {
  return typeof window === 'undefined';
}

/** Merge a raw stored object into the defaults, filling any missing or
 *  invalid-typed fields with their default values. Only shallow-merges each
 *  top-level section, which is sufficient because sections are flat. */
function mergeWithDefaults(stored: Record<string, unknown>): AppConfig {
  const result = {} as Record<string, unknown>;
  for (const section of Object.keys(APP_CONFIG_DEFAULTS) as Array<keyof AppConfig>) {
    const defaults = APP_CONFIG_DEFAULTS[section] as Record<string, unknown>;
    const raw = stored[section];
    const storedSection = (raw !== null && typeof raw === 'object' && !Array.isArray(raw))
      ? raw as Record<string, unknown>
      : {};
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(defaults)) {
      const stored_val = storedSection[key];
      const default_val = defaults[key];
      // Accept stored value only when it's the same primitive type as the default.
      if (stored_val !== undefined && typeof stored_val === typeof default_val) {
        merged[key] = stored_val;
      } else {
        merged[key] = default_val;
      }
    }
    result[section] = merged;
  }
  return result as unknown as AppConfig;
}

/** Load (or return cached) app config. Always returns a fully-populated
 *  config — missing fields fill in from defaults. */
export function loadAppConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;
  if (isWorkerContext()) {
    // Workers have no localStorage. Return static defaults, cloned so callers
    // can't accidentally mutate the shared defaults object.
    cachedConfig = mergeWithDefaults({});
    return cachedConfig;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      cachedConfig = mergeWithDefaults(parsed);
      return cachedConfig;
    }
  } catch {
    // parse / storage error → fall through to defaults
  }
  cachedConfig = mergeWithDefaults({});
  return cachedConfig;
}

/** Return the current config (cached after first load). */
export function getConfig(): AppConfig {
  return loadAppConfig();
}

/** Persist the given config snapshot and notify listeners. */
export function saveAppConfig(cfg: AppConfig): void {
  if (!isWorkerContext()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // quota / private-mode — silently ignore
    }
  }
  cachedConfig = cfg;
  for (const fn of listeners) fn(cachedConfig);
}

/** Remove all overrides, restoring factory defaults, and notify listeners. */
export function resetAppConfig(): void {
  if (!isWorkerContext()) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
  cachedConfig = null;
  cachedConfig = mergeWithDefaults({});
  for (const fn of listeners) fn(cachedConfig);
}

/** Subscribe to config saves/resets. Returns an unsubscribe function. */
export function onAppConfigChange(fn: (cfg: AppConfig) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
