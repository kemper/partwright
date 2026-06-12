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
    /** Max times a single provider API call is retried after a *transient*
     *  failure (HTTP 429/5xx, network/stream drop) before the turn surfaces a
     *  hard error. These retries don't consume the agent's per-turn iteration
     *  budget — they keep an auto-continue run alive through server blips. */
    maxTransientRetries: number;
    /** Base backoff (ms) between transient provider-error retries. The actual
     *  wait grows exponentially (base · 2^(attempt-1)) with jitter, capped at
     *  transientRetryMaxMs. */
    transientRetryBaseMs: number;
    /** Ceiling (ms) on a single transient-error backoff wait. */
    transientRetryMaxMs: number;
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
    /** How many of the most-recent render images (renderView / renderViews /
     *  runIsolated tool snapshots) to keep in the history sent to the provider.
     *  Older tool-result images are dropped from the request (their text stats
     *  stay) so a long modeling session's image tokens don't compound every
     *  turn — the same reason the CLI uses the model-sculpt subagent. The
     *  on-screen transcript still shows every image; only the provider request
     *  is trimmed. Set high to disable trimming. */
    keepRecentToolImages: number;
    /** Safety timeout (ms) for SCAD Worker operations with no cancel button —
     *  OpenSCAD validation and include-detection. (The render path has no
     *  timeout; it's bounded by the elapsed counter + Cancel button instead.)
     *  SCAD compiles BOSL2-style libraries from source per call, so this needs
     *  generous headroom. */
    geometryTimeoutScadMs: number;
    /** Safety timeout (ms) for replicad/BREP (OpenCASCADE) Worker operations
     *  with no cancel button — STEP export/import and BREP-shape cleanup. (The
     *  render path has no timeout; see the render counter + Cancel button.) */
    geometryTimeoutReplicadMs: number;
    /** Token budget for the system-prompt block in local (WebLLM) medium-tier models. */
    localPromptBudgetMedium: number;
    /** Token budget for the system-prompt block in local (WebLLM) slim-tier models. */
    localPromptBudgetSlim: number;
    /** Token budget for native tool-calling schemas in local models. */
    localToolsBudgetNative: number;
    /** Token budget for prompt-engineered tool schemas in local models. */
    localToolsBudgetPromptEngineered: number;
    /** Safety-margin tokens added to the attention-sink context window budget. */
    localAttentionSinkMargin: number;
    /** Hard cap on attention-sink tokens for local models. */
    localAttentionSinkMax: number;
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
    /** Orientation gizmo canvas size in CSS pixels. */
    gizmoSizePx: number;
    /** Orientation gizmo corner margin in CSS pixels. */
    gizmoMarginPx: number;
    /** Gizmo label hit-detection radius in orthographic units (0–2 range). */
    gizmoHitRadius: number;
    /** Gizmo snap-to-face animation duration in seconds. */
    gizmoSnapDurationSec: number;
    /** OrbitControls damping factor — lower is snappier, higher is smoother. */
    orbitDampingFactor: number;
    /** Frame rate (fps) that `orbitDampingFactor` is authored against. The orbit
     *  coast is re-derived from the real frame delta so its decay-per-second
     *  stays constant regardless of frame rate — otherwise a heavy mesh that
     *  drops the frame rate makes the same drag "coast" for far longer and the
     *  model lags behind the cursor (reads as sluggish, slow rotation). At this
     *  rate the correction is a no-op. */
    orbitDampingReferenceFps: number;
    /** Zoom-out limit as a multiple of the model's largest dimension. Caps how
     *  far the camera can dolly back (OrbitControls maxDistance) so the model
     *  can't shrink to a speck. Re-derived from the model size on each frame. */
    maxZoomOutFactor: number;
    /** Ambient light intensity in the 3D viewport (0–2 range). */
    ambientLightIntensity: number;
    /** Primary directional light intensity (0–2 range). */
    primaryLightIntensity: number;
    /** Secondary fill light intensity (0–2 range). */
    secondaryLightIntensity: number;
    /** Idle time (ms) before an unused offscreen multi-view renderer is disposed. */
    offscreenIdleDisposeMs: number;
    /** Pointer activity grace window (ms) that keeps on-demand rendering active. */
    pointerGraceMs: number;
    /** Max time (ms) to wait for thumbnail generation before giving up. */
    thumbnailTimeoutMs: number;
    /** Projected triangle count above which the Quality panel's Apply asks for
     *  a Proceed/Cancel confirmation before running an enhance (the result is
     *  heavy and slow to display). */
    enhanceWarnTriangles: number;
    /** Hard ceiling on an enhance result. The geometry Worker refuses to return
     *  a refined mesh larger than this, and Apply won't run a target above it —
     *  prevents a runaway refine from freezing the main thread when the giant
     *  result is committed to the viewport. */
    enhanceMaxTriangles: number;
    /** Triangle count above which a computed `api.surface.*` texture is NOT
     *  persisted with the saved version (the version still saves; reopening it
     *  just recomputes the texture on demand instead of restoring instantly).
     *  Caps how much IndexedDB space one save can take — a textured mesh costs
     *  roughly 18 bytes per triangle. */
    surfaceTexturePersistMaxTriangles: number;
  };
  import: {
    /** Vertex-weld tolerance for STL imports (world units). */
    stlWeldTolerance: number;
    /** Default max voxel grid dimension for image → voxel imports. */
    voxelDefaultMaxSize: number;
    /** Voxel count above which the import UI shows a performance warning. */
    voxelHeavyThreshold: number;
    /** Max number of lattice cells `v.sdf()` may sample in one call before it
     *  refuses (guards against a huge bounds × tiny `res` freezing the engine).
     *  Past this the call throws and asks for a coarser `res` or tighter bounds. */
    voxelSdfMaxSamples: number;
    /** Max image resolution (pixels per side) when importing for relief. */
    reliefMaxResolution: number;
    /** Timeout (ms) for fetching a remote file by URL in the import-from-URL flow. */
    remoteFetchTimeoutMs: number;
    /** Color-distance threshold for matching swapped filament colors (0–1, lower = stricter). */
    filamentMatchThreshold: number;
    /** Confidence score below which the filament swap guide shows a warning (0–1). */
    filamentConfidenceWarnThreshold: number;
  };
  ui: {
    /** How long toast notifications stay on screen (ms). */
    toastDurationMs: number;
    /** Hover-tooltip show delay (ms). */
    tooltipDelayMs: number;
    /** Idle delay (ms) after the last keystroke before error annotations appear in the code editor. */
    codeEditorErrorIdleMs: number;
    /** Input-grace window (ms) for the code editor's bottom-scroll stabilizer.
     *  When the editor is parked near the very bottom, a programmatic one-line
     *  re-measure snap (real Chrome reconciling fractional line heights on a
     *  focus change / layout reflow) is reverted so the code doesn't stutter —
     *  unless a real scroll happened within this window (wheel, scrollbar drag,
     *  touch, keyboard/typing), which is always honored. Set to 0 to disable. */
    codeEditorScrollPinMs: number;
    /** Debounce delay (ms) after the last companion-file keystroke before the
     *  draft is autosaved, so companion edits survive a reload without writing
     *  to IndexedDB on every keystroke. */
    companionDraftDebounceMs: number;
    /** Debounce delay (ms) after the user finishes an orbit/zoom before the
     *  interactive working-view camera is persisted to the session row, so a
     *  burst of small adjustments coalesces into one IndexedDB write. */
    workCameraSaveDebounceMs: number;
    /** Debounce delay (ms) for the surface-modifier live preview. */
    surfacePreviewDebounceMs: number;
    /** Debounce delay (ms) for the relief import 2D preview. */
    reliefPreviewDebounceMs: number;
    /** Debounce delay (ms) for the relief import 3D preview. */
    reliefPreview3dDebounceMs: number;
    /** Delay (ms) before the progress modal appears (hides fast operations). */
    progressModalShowDelayMs: number;
    /** Heartbeat interval (ms) for the cross-tab session leader lock. */
    sessionLockHeartbeatMs: number;
    /** Time (ms) after which a session lock heartbeat is considered stale. */
    sessionLockStaleMs: number;
    /** Default circular segment count for manifold-js / BREP geometry renders.
     *  Picks the nearest named preset; non-preset values use "custom" mode. */
    defaultQuality: number;
    /** Default circular segment count for OpenSCAD ($fn) geometry renders. */
    scadDefaultQuality: number;
    /** Default colour-palette slot capacity — how many filament slots the
     *  target printer has (e.g. 4 for one Bambu AMS). Drives the paint panel's
     *  over-budget warning; never blocks painting or export. */
    defaultPaletteCapacity: number;
    /** Max colours kept in the palette's recent-colour history ring. */
    paletteHistoryMax: number;
    /** In-memory ring buffer size for the worker run-history log (recent
     *  geometry runs shown in the worker health panel). */
    workerRunHistorySize: number;
    /** Live-refresh interval (ms) for the worker health panel — how often it
     *  re-polls in-flight counts and liveness while open. */
    workerPanelRefreshMs: number;
    /** Whether the "Did you know?" rolling hints strip shows at the top of the
     *  editor. Users can turn it off permanently here; the strip's ✕ only hides
     *  it for the current tab/session. */
    editorHintsEnabled: boolean;
    /** How long each "Did you know?" hint stays before the strip rotates to the
     *  next one (ms). */
    hintRotationMs: number;
    /** Slide duration (ms) for the docked AI panel opening/closing. The panel
     *  animates its layout footprint so the viewport grows/shrinks smoothly
     *  instead of snapping. Set to 0 for an instant toggle. */
    aiPanelSlideMs: number;
  };
  geometry: {
    /** Triangle count above which the live model warns it may be too heavy for
     *  the catalog budget / slow to slice. Mirrors the headless model:preview
     *  tri-budget warning so the in-app AI sees the same signal. */
    triCountWarnBudget: number;
    /** Shortest mesh edge (world units) below which a fine-detail warning fires
     *  — features this small are dropped by FDM slicers (sub-extrusion-width).
     *  Mirrors model:preview's sub-0.4 mm detail warning. */
    minEdgeLengthWarn: number;
    /** Bounding-box aspect ratio (longest dim ÷ shortest non-zero dim) above
     *  which a sliver/thin-model warning fires. Mirrors model:preview. */
    aspectRatioWarn: number;
  };
}

export const APP_CONFIG_DEFAULTS: AppConfig = {
  ai: {
    maxConsecutiveAutoResumes: 8,
    maxTransientRetries: 4,
    transientRetryBaseMs: 1000,
    transientRetryMaxMs: 16_000,
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
    keepRecentToolImages: 3,
    geometryTimeoutScadMs: 180_000,
    geometryTimeoutReplicadMs: 180_000,
    localPromptBudgetMedium: 1300,
    localPromptBudgetSlim: 600,
    localToolsBudgetNative: 100,
    localToolsBudgetPromptEngineered: 500,
    localAttentionSinkMargin: 200,
    localAttentionSinkMax: 2048,
  },
  renderer: {
    fov: 50,
    maxPixelRatio: 2,
    interactionRenderScale: 0.6,
    gridSize: 40,
    gridDivisions: 40,
    gizmoSizePx: 128,
    gizmoMarginPx: 8,
    gizmoHitRadius: 0.4,
    gizmoSnapDurationSec: 0.4,
    orbitDampingFactor: 0.1,
    orbitDampingReferenceFps: 60,
    maxZoomOutFactor: 12,
    ambientLightIntensity: 0.6,
    primaryLightIntensity: 0.8,
    secondaryLightIntensity: 0.3,
    offscreenIdleDisposeMs: 10_000,
    pointerGraceMs: 350,
    thumbnailTimeoutMs: 4000,
    enhanceWarnTriangles: 1_000_000,
    enhanceMaxTriangles: 5_000_000,
    surfaceTexturePersistMaxTriangles: 1_000_000,
  },
  import: {
    stlWeldTolerance: 1e-5,
    voxelDefaultMaxSize: 64,
    voxelHeavyThreshold: 250_000,
    voxelSdfMaxSamples: 8_000_000,
    reliefMaxResolution: 512,
    remoteFetchTimeoutMs: 15_000,
    filamentMatchThreshold: 0.18,
    filamentConfidenceWarnThreshold: 0.9,
  },
  ui: {
    toastDurationMs: 2200,
    tooltipDelayMs: 150,
    codeEditorErrorIdleMs: 800,
    codeEditorScrollPinMs: 250,
    companionDraftDebounceMs: 600,
    workCameraSaveDebounceMs: 500,
    surfacePreviewDebounceMs: 250,
    reliefPreviewDebounceMs: 120,
    reliefPreview3dDebounceMs: 250,
    progressModalShowDelayMs: 250,
    sessionLockHeartbeatMs: 3000,
    sessionLockStaleMs: 8000,
    defaultQuality: 128,
    scadDefaultQuality: 32,
    defaultPaletteCapacity: 4,
    paletteHistoryMax: 48,
    workerRunHistorySize: 50,
    workerPanelRefreshMs: 1000,
    editorHintsEnabled: true,
    hintRotationMs: 12_000,
    aiPanelSlideMs: 200,
  },
  geometry: {
    triCountWarnBudget: 200_000,
    minEdgeLengthWarn: 0.4,
    aspectRatioWarn: 12,
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

/** Seed the worker's config cache with the main thread's `ai` overrides.
 *  Workers have no localStorage, so without this `getConfig().ai.*` reads inside
 *  the agent Worker (every hosted-provider turn runs there) silently fall back
 *  to defaults — ignoring the user's saved thinking budgets, max-output tokens,
 *  transient-retry and auto-resume tuning. The main thread passes its `ai`
 *  section through the run_turn message and the Worker applies it here before
 *  the providers read config. No-op outside a Worker (the main thread already
 *  has the real values). */
export function applyWorkerAiConfig(ai: AppConfig['ai']): void {
  if (!isWorkerContext()) return;
  const base = loadAppConfig();
  cachedConfig = { ...base, ai: { ...base.ai, ...ai } };
}

/** Subscribe to config changes (saved overrides or a reset). Returns an
 *  unsubscribe function. Fires with the new config after every persist. */
export function onConfigChange(fn: (cfg: AppConfig) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
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

