// Validation bounds for the user-tunable AppConfig fields, mirrored from the
// Advanced Settings modal (src/ui/advancedSettingsModal.tsx) so the
// `partwright.getAppConfig` / `setAppConfig` API (and the AI `setAppConfig`
// tool) accept exactly what the UI accepts: the same keys, the same type as the
// default, the same min/max, the same integer constraint.
//
// The modal declares its bounds inline in JSX; tests/unit/appConfigApi.test.ts
// re-parses the modal source and fails when this table drifts from it (a new
// Field without a row here, or a changed min/max). Keys with no Advanced
// Settings field are deliberately NOT settable through the API -- parity with
// the UI, not a back door to every internal knob.
//
// Pure (only the defaults table), so it runs in the unit tier.

import { APP_CONFIG_DEFAULTS, type AppConfig } from './appConfig';

export type ConfigSection = keyof AppConfig;

export type ConfigFieldBounds =
  | { min: number; max: number; integer?: boolean }
  | { boolean: true };

const BOOL = { boolean: true } as const;

/** Every Advanced Settings field, keyed by section then config key. */
export const APP_CONFIG_FIELD_BOUNDS: { [S in ConfigSection]: Partial<Record<keyof AppConfig[S], ConfigFieldBounds>> } = {
  ai: {
    maxConsecutiveAutoResumes: { min: 1, max: 64, integer: true },
    maxTransientRetries: { min: 0, max: 10, integer: true },
    transientRetryBaseMs: { min: 100, max: 30_000, integer: true },
    transientRetryMaxMs: { min: 1_000, max: 120_000, integer: true },
    slowToolMs: { min: 50, max: 30_000, integer: true },
    toolCallTimeoutMs: { min: 5_000, max: 600_000, integer: true },
    diagnosticsRingSize: { min: 10, max: 500, integer: true },
    maxAttachments: { min: 1, max: 100, integer: true },
    keepRecentToolImages: { min: 0, max: 50, integer: true },
    cacheConversationHistory: BOOL,
    cachedImageLimit: { min: 1, max: 50, integer: true },
    cachedImageTrimTo: { min: 1, max: 50, integer: true },
    autoCompactMaxTokens: { min: 10_000, max: 1_000_000, integer: true },
    pruneStaleToolPayloads: BOOL,
    keepRecentCodeBodies: { min: 1, max: 50, integer: true },
    codeBodyTrimBatch: { min: 0, max: 50, integer: true },
    failedCallValueMinChars: { min: 20, max: 100_000, integer: true },
    customOverflowWarnFraction: { min: 0.1, max: 1 },
    failedCallInputTurns: { min: 1, max: 50, integer: true },
    failedCallInputMinChars: { min: 100, max: 100_000, integer: true },
    customSlimMaxContext: { min: 1024, max: 1_000_000, integer: true },
    customMediumMaxContext: { min: 1024, max: 10_000_000, integer: true },
    customToolDescriptionChars: { min: 40, max: 5000, integer: true },
    customParamDescriptionChars: { min: 0, max: 2000, integer: true },
    customContextProbeTimeoutMs: { min: 250, max: 30_000, integer: true },
    compactionKeepImages: { min: 0, max: 12, integer: true },
    reviewReferenceImages: { min: 0, max: 12, integer: true },
    reviewConversationMaxChars: { min: 0, max: 100000, integer: true },
    reviewNoteMaxChars: { min: 200, max: 8000, integer: true },
    geometryTimeoutScadMs: { min: 5_000, max: 600_000, integer: true },
    geometryTimeoutReplicadMs: { min: 5_000, max: 600_000, integer: true },
    localPromptBudgetMedium: { min: 200, max: 4096, integer: true },
    localPromptBudgetSlim: { min: 100, max: 2048, integer: true },
    localToolsBudgetNative: { min: 50, max: 1000, integer: true },
    localToolsBudgetPromptEngineered: { min: 100, max: 2000, integer: true },
    localAttentionSinkMargin: { min: 50, max: 500, integer: true },
    localAttentionSinkMax: { min: 512, max: 8192, integer: true },
    thinkingBudgetAnthropicLow: { min: 1024, max: 100_000, integer: true },
    thinkingBudgetAnthropicMedium: { min: 1024, max: 100_000, integer: true },
    thinkingBudgetAnthropicHigh: { min: 1024, max: 200_000, integer: true },
    thinkingBudgetGeminiLow: { min: 1024, max: 100_000, integer: true },
    thinkingBudgetGeminiMedium: { min: 1024, max: 100_000, integer: true },
    thinkingBudgetGeminiHigh: { min: 1024, max: 200_000, integer: true },
    answerHeadroomTokens: { min: 1024, max: 50_000, integer: true },
    maxOutputTokensAnthropic: { min: 1024, max: 200_000, integer: true },
    maxOutputTokensAnthropicThinking: { min: 4096, max: 64_000, integer: true },
    maxOutputTokensAnthropicThinkingDeep: { min: 4096, max: 128_000, integer: true },
    maxOutputTokensOpenai: { min: 1024, max: 200_000, integer: true },
    maxOutputTokensGemini: { min: 1024, max: 500_000, integer: true },
    charsPerToken: { min: 1, max: 20 },
    imageTokenEstimate: { min: 100, max: 10_000, integer: true },
  },
  renderer: {
    fov: { min: 10, max: 120, integer: true },
    maxPixelRatio: { min: 0.5, max: 4 },
    interactionRenderScale: { min: 0.1, max: 1 },
    gridRoomFactor: { min: 1, max: 40 },
    gridDivisions: { min: 2, max: 200, integer: true },
    isolateGhostOpacity: { min: 0, max: 0.9 },
    creaseEdgeMaxTriangles: { min: 0, max: 50_000_000, integer: true },
    lazyManifoldMinTriangles: { min: 0, max: 50_000_000, integer: true },
    thumbnailMaxTriangles: { min: 0, max: 50_000_000, integer: true },
    assemblyPoolSize: { min: 1, max: 16, integer: true },
    engineSandboxBootTimeoutMs: { min: 2_000, max: 120_000, integer: true },
    engineSandboxMaxFrameRestarts: { min: 0, max: 10, integer: true },
    engineSandboxHeartbeatMs: { min: 500, max: 30_000, integer: true },
    exportPoolSize: { min: 1, max: 16, integer: true },
    assemblyGridGutter: { min: 0, max: 2 },
    ambientLightIntensity: { min: 0, max: 3 },
    primaryLightIntensity: { min: 0, max: 3 },
    secondaryLightIntensity: { min: 0, max: 2 },
    orbitDampingFactor: { min: 0, max: 0.9 },
    orbitDampingReferenceFps: { min: 30, max: 240 },
    maxZoomOutFactor: { min: 3, max: 100 },
    defaultFrameFactor: { min: 1, max: 3 },
    gizmoSizePx: { min: 48, max: 256, integer: true },
    gizmoMarginPx: { min: 0, max: 32, integer: true },
    gizmoHitRadius: { min: 0.1, max: 1 },
    gizmoSnapDurationSec: { min: 0.05, max: 2 },
    offscreenIdleDisposeMs: { min: 1_000, max: 300_000, integer: true },
    pointerGraceMs: { min: 50, max: 2_000, integer: true },
    thumbnailTimeoutMs: { min: 500, max: 30_000, integer: true },
    enhanceWarnTriangles: { min: 10_000, max: 50_000_000, integer: true },
    enhanceMaxTriangles: { min: 100_000, max: 100_000_000, integer: true },
    surfaceTexturePersistMaxTriangles: { min: 0, max: 20_000_000, integer: true },
    paintRefinePersistMaxTriangles: { min: 0, max: 20_000_000, integer: true },
    paintRefineCacheMaxMB: { min: 0, max: 4096, integer: true },
    paintRefineCacheTouchMinutes: { min: 0, max: 10_080, integer: true },
    probePixelsMaxPixels: { min: 1, max: 100_000, integer: true },
    sdfPreviewScale: { min: 1, max: 6 },
  },
  import: {
    stlWeldTolerance: { min: 1e-8, max: 0.1 },
    voxelDefaultMaxSize: { min: 4, max: 256, integer: true },
    voxelHeavyThreshold: { min: 10_000, max: 5_000_000, integer: true },
    voxelSdfMaxSamples: { min: 100_000, max: 64_000_000, integer: true },
    reliefMaxResolution: { min: 32, max: 4096, integer: true },
    threeMfMaxTriangles: { min: 10_000, max: 200_000_000, integer: true },
    threeMfMaxEntryMB: { min: 16, max: 8192, integer: true },
    threeMfMaxColors: { min: 1, max: 4096, integer: true },
    maxSplitObjects: { min: 2, max: 1000, integer: true },
    remoteFetchTimeoutMs: { min: 1_000, max: 120_000, integer: true },
    prefillImageSrcMaxChars: { min: 10_000, max: 50_000_000, integer: true },
    prefillImageMaxPixels: { min: 10_000, max: 200_000_000, integer: true },
    filamentMatchThreshold: { min: 0.01, max: 1 },
    filamentConfidenceWarnThreshold: { min: 0.1, max: 1 },
    reconstructCellBudget: { min: 200_000, max: 100_000_000, integer: true },
    reconstructEvalSamples: { min: 500, max: 100_000, integer: true },
    photoMatchTargetHeight: { min: 48, max: 1024, integer: true },
    photoMatchBgToleranceMin: { min: 1, max: 120, integer: true },
    photoMatchBgTolerance: { min: 1, max: 200, integer: true },
    photoMatchKmeansIterations: { min: 0, max: 50, integer: true },
    photoMatchBands: { min: 2, max: 40, integer: true },
    photoMatchColorShiftWarn: { min: 5, max: 150, integer: true },
    photoMatchMaxRegionDistance: { min: 0.01, max: 1 },
    photoMatchRenderSize: { min: 128, max: 2048, integer: true },
    photoMatchMinSubjectPx: { min: 0, max: 4000, integer: true },
    photoMatchAmbiguousDeltaE: { min: 0, max: 60 },
    photoMatchOutlineMinPct: { min: 0.1, max: 20 },
    photoMatchOutlineMaxLines: { min: 1, max: 40, integer: true },
    photoMatchBusyBorderTolerance: { min: 10, max: 90, integer: true },
  },
  geometry: {
    triCountWarnBudget: { min: 10_000, max: 2_000_000, integer: true },
    minEdgeLengthWarn: { min: 0, max: 5 },
    aspectRatioWarn: { min: 2, max: 100 },
    engineHeapHighPct: { min: 10, max: 100, integer: true },
    sesUndeclaredCheckMaxChars: { min: 0, max: 10_000_000, integer: true },
  },
  segmentation: {
    autoDetectOnImport: BOOL,
    autoDetectMaxTriangles: { min: 10_000, max: 20_000_000, integer: true },
    autoDetectMaxParts: { min: 2, max: 1000, integer: true },
    absorbMinAreaFrac: { min: 0, max: 0.1 },
    smoothBoundaryIterations: { min: 1, max: 20, integer: true },
    maxListedParts: { min: 10, max: 1000, integer: true },
    undoDepth: { min: 1, max: 200, integer: true },
    labelGridResolution: { min: 40, max: 600, integer: true },
    seedMissEdgeLengths: { min: 0.5, max: 100 },
    focusPadding: { min: 0, max: 2 },
    liveDebounceMs: { min: 0, max: 5000, integer: true },
    edgeSmoothingDebounceMs: { min: 0, max: 5000, integer: true },
    presetThumbSize: { min: 64, max: 320, integer: true },
    defaultEdgeSmoothing: { min: 0, max: 20, integer: true },
    edgePinCreaseDeg: { min: 0, max: 90 },
    seedsFromPartsMinRegionFrac: { min: 0, max: 0.5 },
    seedDotFraction: { min: 0.001, max: 0.05 },
    seedTagScreenFraction: { min: 0.01, max: 0.08 },
    fixBrushRadiusFrac: { min: 0.002, max: 0.1 },
    chipMissAreaFrac: { min: 0, max: 0.05 },
    autoAbsorbSpeckFrac: { min: 0, max: 0.05 },
    fusedPieceMinTris: { min: 0, max: 1_000_000, integer: true },
    mobileSheetHeightFrac: { min: 0.25, max: 0.9 },
  },
  ui: {
    editorHintsEnabled: BOOL,
    hintRotationMs: { min: 3_000, max: 60_000, integer: true },
    toolDialogOpenWaitMs: { min: 500, max: 60_000, integer: true },
    paintAdjacencyWorkerMinTriangles: { min: 0, max: 50_000_000, integer: true },
    paintAdjacencyWorkerTimeoutMs: { min: 5_000, max: 600_000, integer: true },
    maxPendingAppliedNotes: { min: 1, max: 50, integer: true },
    maxAppliedNoteChars: { min: 80, max: 4_000, integer: true },
    toastDurationMs: { min: 500, max: 15_000, integer: true },
    exportColorMergeTolerance: { min: 0, max: 30, integer: true },
    undoToastDurationMs: { min: 2000, max: 60_000, integer: true },
    deletedObjectRetentionDays: { min: 1, max: 365, integer: true },
    paneSlideMs: { min: 0, max: 600, integer: true },
    codeMinimapWidthPx: { min: 80, max: 320, integer: true },
    defaultPaletteCapacity: { min: 1, max: 16, integer: true },
    paletteHistoryMax: { min: 8, max: 256, integer: true },
    paintStrokeResolution: { min: 2, max: 1024, integer: true },
    paintStrokePathSpacing: { min: 0.05, max: 1 },
    boundaryPaintMaxLoops: { min: 1, max: 200, integer: true },
    tooltipDelayMs: { min: 0, max: 2000, integer: true },
    editorFontSizeDefault: { min: 6, max: 48, integer: true },
    editorFontSizeMin: { min: 6, max: 24, integer: true },
    editorFontSizeMax: { min: 12, max: 64, integer: true },
    codeEditorErrorIdleMs: { min: 0, max: 5_000, integer: true },
    codeEditorScrollPinMs: { min: 0, max: 1_000, integer: true },
    companionDraftDebounceMs: { min: 0, max: 5_000, integer: true },
    workCameraSaveDebounceMs: { min: 0, max: 5_000, integer: true },
    surfacePreviewDebounceMs: { min: 0, max: 2_000, integer: true },
    characterPreviewDebounceMs: { min: 0, max: 3_000, integer: true },
    reliefPreviewDebounceMs: { min: 0, max: 2_000, integer: true },
    reliefPreview3dDebounceMs: { min: 0, max: 2_000, integer: true },
    progressModalShowDelayMs: { min: 0, max: 2_000, integer: true },
    sessionLockHeartbeatMs: { min: 500, max: 30_000, integer: true },
    sessionLockStaleMs: { min: 1_000, max: 60_000, integer: true },
    defaultQuality: { min: 3, max: 4096, integer: true },
    scadDefaultQuality: { min: 3, max: 4096, integer: true },
    workerRunHistorySize: { min: 10, max: 500, integer: true },
    workerPanelRefreshMs: { min: 200, max: 10_000, integer: true },
    diagnosticLogApiLimit: { min: 1, max: 200, integer: true },
  },
};

/** Config keys the in-app AI may WRITE via its `setAppConfig` tool: knobs that
 *  change a modeling/import RESULT (default curvature segments, enhance caps,
 *  SDF preview resolution, import resolution/limits, geometry-warning
 *  thresholds). Never anything in the `ai` section (the agent's own loop,
 *  budgets and timeouts) and nothing cosmetic or timing-related. The console
 *  API (`partwright.setAppConfig`) accepts every Advanced Settings field. */
export const AI_WRITABLE_CONFIG_KEYS: readonly string[] = [
  'ui.defaultQuality',
  'ui.scadDefaultQuality',
  'renderer.enhanceWarnTriangles',
  'renderer.enhanceMaxTriangles',
  'renderer.sdfPreviewScale',
  'import.stlWeldTolerance',
  'import.voxelDefaultMaxSize',
  'import.voxelSdfMaxSamples',
  'import.reliefMaxResolution',
  'import.reconstructCellBudget',
  'import.reconstructEvalSamples',
  'geometry.triCountWarnBudget',
  'geometry.minEdgeLengthWarn',
  'geometry.aspectRatioWarn',
];

export type ConfigValueCheck =
  | { ok: true; section: ConfigSection; key: string; value: number | boolean }
  | { ok: false; error: string };

/** Validate one `(section, key, value)` write against the Advanced Settings
 *  contract. No coercion: `"5"` is not a number. Returns the accepted value or
 *  a human-readable error. */
export function validateAppConfigValue(section: unknown, key: unknown, value: unknown, caller = 'setAppConfig'): ConfigValueCheck {
  const sections = Object.keys(APP_CONFIG_FIELD_BOUNDS) as ConfigSection[];
  if (typeof section !== 'string' || !sections.includes(section as ConfigSection)) {
    return { ok: false, error: `${caller}(section): must be one of ${sections.map(s => `"${s}"`).join(' | ')}, got ${JSON.stringify(section)}.` };
  }
  const s = section as ConfigSection;
  const table = APP_CONFIG_FIELD_BOUNDS[s] as Record<string, ConfigFieldBounds | undefined>;
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, error: `${caller}(key): must be a non-empty string naming a ${s} setting.` };
  }
  const bounds = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  if (!bounds) {
    const inDefaults = Object.prototype.hasOwnProperty.call(APP_CONFIG_DEFAULTS[s], key);
    return {
      ok: false,
      error: inDefaults
        ? `${caller}: ${s}.${key} is an internal setting with no Advanced Settings field, so it can't be changed here.`
        : `${caller}: unknown setting ${s}.${key}. Call getAppConfig() to list the settable keys.`,
    };
  }
  if ('boolean' in bounds) {
    if (typeof value !== 'boolean') return { ok: false, error: `${caller}: ${s}.${key} must be a boolean, got ${describe(value)}.` };
    return { ok: true, section: s, key, value };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { ok: false, error: `${caller}: ${s}.${key} must be a finite number, got ${describe(value)}.` };
  }
  if (bounds.integer && !Number.isInteger(value)) {
    return { ok: false, error: `${caller}: ${s}.${key} must be an integer, got ${value}.` };
  }
  if (value < bounds.min || value > bounds.max) {
    return { ok: false, error: `${caller}: ${s}.${key} must be between ${bounds.min} and ${bounds.max}, got ${value}.` };
  }
  return { ok: true, section: s, key, value };
}

/** A copy of `cfg` with one field replaced. Sections are flat, so a shallow
 *  clone per section is a full copy. */
export function withConfigValue(cfg: AppConfig, section: ConfigSection, key: string, value: number | boolean): AppConfig {
  const next = {} as Record<string, Record<string, unknown>>;
  for (const s of Object.keys(cfg) as ConfigSection[]) next[s] = { ...(cfg[s] as unknown as Record<string, unknown>) };
  next[section][key] = value;
  return next as unknown as AppConfig;
}

/** The settable fields of `cfg` as
 *  `{ section: { key: { value, default, min?, max?, integer?, modified? } } }`
 *  -- what `getAppConfig()` returns. Internal keys with no Advanced Settings
 *  field are omitted (they can't be set, so listing them only invites a failed
 *  write). */
export function describeAppConfig(cfg: AppConfig): Record<string, Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  for (const s of Object.keys(APP_CONFIG_FIELD_BOUNDS) as ConfigSection[]) {
    const table = APP_CONFIG_FIELD_BOUNDS[s] as Record<string, ConfigFieldBounds>;
    const values = cfg[s] as unknown as Record<string, number | boolean>;
    const defaults = APP_CONFIG_DEFAULTS[s] as unknown as Record<string, number | boolean>;
    const sec: Record<string, Record<string, unknown>> = {};
    for (const [key, b] of Object.entries(table)) {
      const value = values[key];
      sec[key] = {
        value,
        default: defaults[key],
        ...('boolean' in b ? {} : { min: b.min, max: b.max, ...(b.integer ? { integer: true } : {}) }),
        ...(value !== defaults[key] ? { modified: true } : {}),
      };
    }
    out[s] = sec;
  }
  return out;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'string') return `string ${JSON.stringify(v)}`;
  if (typeof v === 'object') return 'object';
  return `${typeof v} ${String(v)}`;
}
