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
    /** Extended-thinking token budgets for Anthropic (per thinking level).
     *  Only used by older Claude models (Haiku 4.5, Sonnet/Opus 4.5 and
     *  earlier) — Claude 4.6+ use adaptive thinking + effort instead, and
     *  4.7+ reject `budget_tokens` outright. XHigh/Max use the High budget. */
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
    /** Default max output tokens for Anthropic stream turns. A per-response
     *  runaway guard, not a budget — only generated tokens are billed — so
     *  it's sized to fit a large model-code tool call. */
    maxOutputTokensAnthropic: number;
    /** Max output tokens for Anthropic turns that run adaptive thinking
     *  (Claude 4.6+ with a Thinking level, or models that always think).
     *  Thinking tokens count against max_tokens and adaptive thinking has no
     *  separate budget, so this needs to be much larger than the plain cap or
     *  high-effort turns stop mid-thought with max_tokens. */
    maxOutputTokensAnthropicThinking: number;
    /** Max output tokens for adaptive-thinking turns at XHigh / Max effort,
     *  which think longest. Every Claude 4.6+ model allows at least 64k. */
    maxOutputTokensAnthropicThinkingDeep: number;
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
     *  is trimmed. Set high to disable trimming. Applies to providers whose
     *  history isn't cached (Custom, Local, or Anthropic with history caching
     *  off); cached providers use the stepped limits below. */
    keepRecentToolImages: number;
    /** Cache the conversation history on Anthropic (a prompt-cache breakpoint
     *  on the latest message). Every agent step re-sends the whole
     *  conversation; with this on, the repeated part bills at the cache-read
     *  rate (~10% of input) instead of full price. OpenAI and Gemini cache a
     *  repeated prefix automatically. */
    cacheConversationHistory: boolean;
    /** Render images allowed to accumulate in the request before a trim, for
     *  providers that cache the history (Anthropic with history caching on,
     *  OpenAI, Gemini). Cached images are cheap to re-send, and trimming edits
     *  earlier messages (breaking the cache), so trims happen in steps. */
    cachedImageLimit: number;
    /** When `cachedImageLimit` is exceeded, trim back down to this many
     *  images. The gap between the two is how many renders pass between
     *  cache-breaking trims. */
    cachedImageTrimTo: number;
    /** Auto-compact ("Auto" mode) also fires once the conversation passes
     *  this many tokens, even if that is under 70% of the model's context
     *  window. On 1M-context models 70% would be ~700k tokens — far past the
     *  point where each cache miss (e.g. after a pause) gets expensive. */
    autoCompactMaxTokens: number;
    /** Images the user attached that compaction carries forward (newest
     *  first) instead of dropping with the summarized turns. 0 = drop them
     *  like before. */
    compactionKeepImages: number;
    /** Custom provider, prompt size "Auto": a known context window smaller
     *  than this many tokens gets the Slim prompt + core tool set. */
    customSlimMaxContext: number;
    /** …and smaller than this, the Medium prompt + everyday tool set. At or
     *  above it — or when the window is unknown — the Full payload. */
    customMediumMaxContext: number;
    /** Medium / Slim: each tool description is cut to its first sentence,
     *  at most this many characters. */
    customToolDescriptionChars: number;
    /** Medium: each parameter description is cut to its first sentence, at
     *  most this many characters. Slim drops parameter descriptions. */
    customParamDescriptionChars: number;
    /** How long each context-window probe on Connect may take (llama.cpp
     *  /props, Ollama /api/ps, LM Studio /api/v0/models, /v1/models). */
    customContextProbeTimeoutMs: number;
    /** Trim dead tool payloads from the history sent to the provider:
     *  superseded code bodies, stale getCode results, repeated readDoc
     *  results, and large inputs of failed calls. Stored history and the
     *  transcript are untouched. */
    pruneStaleToolPayloads: boolean;
    /** How many of the newest code bodies (runAndSave / setCode / runCode …
     *  `code` arguments, and getCode results) stay verbatim in the request;
     *  older ones become a one-line stub. */
    keepRecentCodeBodies: number;
    /** Extra code bodies allowed to pile up before older ones are trimmed
     *  back to `keepRecentCodeBodies` in one edit. Trimming edits an earlier
     *  message and breaks the cached prefix (prompt caching, llama.cpp KV
     *  reuse), so batching keeps the cache valid between trims. 0 = trim
     *  every step. */
    codeBodyTrimBatch: number;
    /** A failed tool call's large inputs are stubbed once this many newer
     *  assistant turns have passed (its error message stays). */
    failedCallInputTurns: number;
    /** …but only inputs at least this many characters long (as JSON). */
    failedCallInputMinChars: number;
    /** Within such a failed call, only top-level values at least this many
     *  characters long (as JSON) are replaced; small ones stay readable. */
    failedCallValueMinChars: number;
    /** Custom endpoint settings warn when the chosen prompt size's fixed
     *  payload uses more than this fraction of the context window. */
    customOverflowWarnFraction: number;
    /** Images the user attached in this conversation (newest first) that the
     *  automatic end-of-task review sees alongside the renders, so it can
     *  compare the result against the user's reference. 0 = renders only. */
    reviewReferenceImages: number;
    /** Max characters of the user's own chat messages sent to a review
     *  (automatic or 👁), newest kept first. The agent's replies are never
     *  sent. 0 = none (the automatic review still gets the latest request). */
    reviewConversationMaxChars: number;
    /** Max characters of a manual (👁) review copied into the
     *  `[REVIEW from …]` session note the agent reads via getSessionContext.
     *  The review itself is always kept in full in the chat transcript. */
    reviewNoteMaxChars: number;
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
    /** Opacity (0–1) of the rest of the object while one part is isolated
     *  from the Objects list (◐ Isolate). Lower = fainter ghost. */
    isolateGhostOpacity: number;
    /** Triangle count above which offscreen renders (version thumbnails,
     *  renderViews) skip the crease-edge overlay. Building it is a full
     *  edge-adjacency pass on the main thread — ~2.5 s at 500k triangles —
     *  and on a mesh that dense the creases are noise at thumbnail size. */
    creaseEdgeMaxTriangles: number;
    /** Triangle count from which a manifold-js run's volume / genus /
     *  component stats are computed in the engine Worker, and the main
     *  thread's own Manifold (for slicing, booleans, decompose) is rebuilt
     *  only when first needed instead of after every run. That rebuild is a
     *  synchronous `Manifold.ofMesh` — ~6 s of frozen UI at 2M triangles. */
    lazyManifoldMinTriangles: number;
    /** Largest mesh (triangles) drawn as-is in a version thumbnail. Bigger
     *  meshes are drawn from a vertex-clustered proxy of about this many
     *  triangles: the full mesh costs seconds of GPU upload + raster for
     *  detail a thumbnail can't show. Above the ~500k catalog budget so
     *  catalog thumbnails stay exact. renderViews etc. are never proxied. */
    thumbnailMaxTriangles: number;
    /** Points per enclosed-piece test in the engine Worker's stats for big
     *  models: a piece counts as enclosed (no floater warning) when all of
     *  these sample points lie inside the larger piece. More = fewer misses
     *  on oddly shaped pieces, slower. */
    containmentSamples: number;
    /** Most `console.log` lines kept from one run of model code (returned as
     *  `logs` by run / runAndSave); later lines are counted, not kept. */
    modelLogMaxLines: number;
    /** Most characters of model-code console output kept per run. */
    modelLogMaxChars: number;
    /** Most triangles `thicknessMap` measures — it casts one ray per triangle
     *  on the main thread (≈1.5 s per 250k), so a bigger mesh is refused with
     *  a pointer to simplifyModel instead of freezing the tab. */
    thicknessMapMaxTriangles: number;
    /** Ground grid footprint as a multiple of the model's largest dimension, so
     *  the grid scales with the model (spans the studio "room") instead of being
     *  a fixed-size patch. Re-derived from the model size on each auto-frame. */
    gridRoomFactor: number;
    /** Number of grid divisions (cell count across the grid). Takes effect on
     *  page reload. */
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
    /** Default framing tightness: when auto-framing (every fresh render and
     *  "Reset view"), the camera sits at this multiple of the model's largest
     *  dimension along each of X/Y/Z, i.e. a view distance of factor·√3·maxDim.
     *  Higher = more zoomed out / more margin around the model. */
    defaultFrameFactor: number;
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
    /** Max time (ms) to wait for the browser's background thumbnail encode
     *  before encoding it synchronously instead. */
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
    /** Typed arrays (mesh vertices, triangles, part ids…) at least this many
     *  KB in a saved version are stored in IndexedDB as Blobs. Saving or
     *  reading a plain array copies it on the main thread (~0.5 s for a
     *  3.7M-triangle import); a Blob is written and read out of line.
     *  0 = every array. */
    storedArrayBlobMinKB: number;
    /** Triangle count above which the smooth-paint REFINED mesh (the mesh
     *  subdivided under brush strokes / smooth slabs, boxes, cylinders and
     *  patterns) is NOT kept in the local smooth-paint mesh cache. A cached
     *  mesh lets reopening a painted version skip rebuilding every smooth
     *  edge; above the cap reopening rebuilds the edges as before. Costs
     *  roughly 20 bytes per triangle. 0 = never cache. */
    paintRefinePersistMaxTriangles: number;
    /** Total size (MB) of the local smooth-paint mesh cache (IndexedDB
     *  `paintRefineCache`). Least-recently-used entries are evicted past it. */
    paintRefineCacheMaxMB: number;
    /** A cache hit older than this many minutes is re-stamped as recently
     *  used (each re-stamp rewrites the entry, so reads only touch it now and
     *  then). */
    paintRefineCacheTouchMinutes: number;
    /** Most pixels one `probePixels` call may cast (one ray each). */
    probePixelsMaxPixels: number;
    /** Fast-preview coarsening factor for SDF models (figures). Before the
     *  full-quality render, the Worker meshes a throwaway coarse pass at this
     *  multiple of the model's march `edgeLength` (and skips detail regions) so
     *  the viewport shows a rough shape in ~1-2s instead of waiting 10-50s.
     *  Higher = faster/rougher preview; 1 (or below) disables the preview pass. */
    sdfPreviewScale: number;
    /** Compile SDF distance functions to flat JS before marching (`sdfCompile.ts`).
     *  ~6–11× faster per eval, verified byte-identical against the closure tree
     *  (a mismatch silently falls back to the closure). Kill-switch only — leave
     *  on. NOTE: read in the geometry Worker, where overrides aren't visible, so
     *  toggling this off only affects main-thread eval paths. */
    sdfCompile: boolean;
    /** Max nodes emitted into one generated SDF function before splitting into a
     *  sub-function. Bounds body size so V8 keeps each function optimized (a
     *  single huge function deopts and runs slower). */
    sdfCompileChunkNodes: number;
    /** Max concurrent geometry Workers the Assembly view spawns to build parts
     *  in parallel. Each worker boots its own manifold-3d WASM, so this trades
     *  memory for fill speed; clamped to (hardwareConcurrency − 1) at runtime.
     *  1 ⇒ builds are serialized (still progressive). */
    assemblyPoolSize: number;
    /** Max concurrent geometry Workers a multi-part export spawns to bake parts
     *  in parallel. Each worker boots its own manifold-3d WASM, so this trades
     *  memory for export speed; clamped at runtime to both (hardwareConcurrency −
     *  1) and the number of parts being exported. 1 ⇒ parts bake one at a time. */
    exportPoolSize: number;
    /** Most items one object may split into in the export picker (Split →
     *  Pieces / Parts). An object with more loose shells than this offers
     *  only "Whole" — thousands of items aren't worth spreading over plates. */
    exportMaxSplitItems: number;
    /** How long (ms) the engine sandbox (Advanced Settings → Security) may take
     *  to load its frame (or start a Worker in a loaded frame) before it gives
     *  up. Never falls back to an unsandboxed Worker: the first frame failing
     *  marks the sandbox unavailable (model code blocked, status pill); a stuck
     *  spawn or a replacement frame counts against engineSandboxMaxFrameRestarts. */
    engineSandboxBootTimeoutMs: number;
    /** How many times in a row the engine sandbox may restart its iframe after
     *  a frame crash or a stuck Worker spawn before it gives up and blocks
     *  model code in the tab (fail closed). Reset by every Worker that connects. */
    engineSandboxMaxFrameRestarts: number;
    /** Engine-sandbox liveness ping interval (ms). The app pings the hidden
     *  sandbox frame this often; a frame that misses ~3 pings in a row (its
     *  renderer crashed or was OOM-killed) is replaced. */
    engineSandboxHeartbeatMs: number;
    /** Spacing between Assembly-grid cells as a fraction of the largest part's
     *  footprint (0.25 ⇒ a quarter-cell gutter). */
    assemblyGridGutter: number;
  };
  import: {
    /** Vertex-weld tolerance for STL imports (world units). */
    stlWeldTolerance: number;
    /** Max triangles a 3MF import may expand to (after component instancing) —
     *  guards against tiny files whose nested component references fan out to
     *  billions of triangles. */
    threeMfMaxTriangles: number;
    /** Max decompressed size (MB) of any single part inside a 3MF package —
     *  zip-bomb guard. */
    threeMfMaxEntryMB: number;
    /** Max distinct colours a 3MF import is painted with. Files with more
     *  (per-triangle-coloured scans) import as mesh only, with a notice. */
    threeMfMaxColors: number;
    /** Max objects one import may be split into (a multi-object 3MF imported
     *  one object per 3MF object / plate, or an STL split into one object per
     *  piece). Each becomes its own object with a version, so this bounds the
     *  run time of a split import. */
    maxSplitObjects: number;
    /** Max mesh files (STL / 3MF) one import may take at once. Every file is
     *  read before the import dialog opens, so this bounds that wait and the
     *  memory it holds. */
    maxImportFiles: number;
    /** Gap between models when a multi-file import arranges them in a grid,
     *  as a fraction of the models' average footprint size. */
    multiImportGridGap: number;
    /** Most triangles all the files of a multi-file import may hold together.
     *  They are merged into one mesh (plus a laid-out copy) before the
     *  objects are cut out, so this bounds that memory. */
    maxImportTotalTriangles: number;
    /** Multi-file layout default: two models count as "piled up" (so the grid
     *  is suggested) when their footprints overlap by more than this fraction
     *  of the smaller one… */
    multiImportOverlapRatio: number;
    /** …and the smaller footprint is at least this fraction of the bigger (a
     *  small part nested in a big one reads as an assembly: keep positions). */
    multiImportSimilarSizeRatio: number;
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
    /** Longest image `src` string (chars) an AI openTool prefill accepts — a
     *  data URL of a few MB. */
    prefillImageSrcMaxChars: number;
    /** Largest image (width × height pixels) an openTool prefill will decode. */
    prefillImageMaxPixels: number;
    /** Color-distance threshold for matching swapped filament colors (0–1, lower = stricter). */
    filamentMatchThreshold: number;
    /** Confidence score below which the filament swap guide shows a warning (0–1). */
    filamentConfidenceWarnThreshold: number;
    /** levelSet cell budget for convertToCode at 'standard' quality — the
     *  mesh→code speed/smoothness knob ('draft' = ×0.25, 'fine' = ×4). */
    reconstructCellBudget: number;
    /** Surface samples per mesh for convertToCode / evalAgainstImport
     *  chamfer+hausdorff reports (more = tighter noise floor, slower). */
    reconstructEvalSamples: number;
    /** Photo match (`photoMatch` / `model:preview --match-photo`): the common
     *  height (px) the photo and model silhouettes are resampled to before
     *  comparing. Higher = finer detail, slower. */
    photoMatchTargetHeight: number;
    /** Photo match: floor of the auto-estimated background tolerance (RGB
     *  distance). The estimate adapts above it to the backdrop's noise; keep it
     *  low so dark hair on a black backdrop stays foreground. */
    photoMatchBgToleranceMin: number;
    /** Photo match: tolerance (RGB distance) around an explicit `bg` colour
     *  when the caller passes no `bgTolerance`. */
    photoMatchBgTolerance: number;
    /** Photo match: k-means refinement iterations over the photo's colours
     *  (seeded with the model's region colours). */
    photoMatchKmeansIterations: number;
    /** Photo match: number of horizontal bands in the width profile. */
    photoMatchBands: number;
    /** Photo match: colour difference (ΔE) above which a region is reported as
     *  a colour mismatch. */
    photoMatchColorShiftWarn: number;
    /** Photo match: a photo pixel is credited to a model region of its colour
     *  only within this distance (fraction of the figure height); further
     *  away it's a photo detail with no model counterpart. */
    photoMatchMaxRegionDistance: number;
    /** Photo match: size (px) of the flat model render compared against the
     *  photo. */
    photoMatchRenderSize: number;
    /** Photo match: warn when the photo's subject is shorter than this
     *  (original photo pixels) — too small to judge fine outline detail. */
    photoMatchMinSubjectPx: number;
    /** Photo match: regions whose photo colours converge closer than this ΔE
     *  (or that share a model colour and touch) are flagged low-confidence and
     *  their shape findings suppressed. 0 disables the auto-detection. */
    photoMatchAmbiguousDeltaE: number;
    /** Photo match: outline-diff offsets below this (% of figure height) are
     *  not reported. */
    photoMatchOutlineMinPct: number;
    /** Photo match: maximum number of outline-diff lines. */
    photoMatchOutlineMaxLines: number;
    /** Photo match: in auto background mode, a border whose estimated
     *  tolerance reaches this RGB distance counts as busy and switches to the
     *  colour-model (GrabCut-lite) segmentation. */
    photoMatchBusyBorderTolerance: number;
  };
  ui: {
    /** openTool on an export / publish dialog: how long to wait for the dialog
     *  to appear (a pre-export "unsaved objects" confirm can come first) before
     *  reporting the prefill as staged-for-when-it-opens (ms). */
    toolDialogOpenWaitMs: number;
    /** Triangle count from which the paint tools' adjacency graph is built in
     *  a background Worker when Paint opens, instead of on the main thread (in
     *  an idle callback after each run). An idle callback is still one
     *  synchronous task, and the build takes ~1 s at a few million triangles. */
    paintAdjacencyWorkerMinTriangles: number;
    /** How long (ms) to wait for that Worker before building the graph on the
     *  main thread instead (a Worker killed for memory may never answer). */
    paintAdjacencyWorkerTimeoutMs: number;
    /** "[UI · app note] user applied …" notes kept for the AI's next turn (latest per
     *  tool; the oldest drop past this). */
    maxPendingAppliedNotes: number;
    /** Longest "[UI · app note] user applied …" note line (chars; truncated past it). */
    maxAppliedNoteChars: number;
    /** How long toast notifications stay on screen (ms). */
    toastDurationMs: number;
    /** How long a toast carrying an action button (e.g. a delete's "Undo")
     *  stays on screen (ms) — longer than a plain toast so the button can be
     *  reached. After it fades, "Recover deleted" in the Objects list still
     *  restores the item. */
    undoToastDurationMs: number;
    /** Days a deleted object stays in the "Recover deleted" bin before it is
     *  permanently purged (checked whenever the bin is read). */
    deletedObjectRetentionDays: number;
    /** Hover-tooltip show delay (ms). */
    tooltipDelayMs: number;
    /** 3MF export "Filament colors" step: the merge tolerance (CIE76 ΔE) it opens
     *  with — painted colours closer than this to a more-used colour are merged
     *  into one filament. 0 = keep every distinct shade. */
    exportColorMergeTolerance: number;
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
    /** Debounce delay (ms) for the Character Creator's live figure preview.
     *  An SDF figure rebuild is heavy, so this is longer than the surface one to
     *  coalesce rapid slider edits into a single rebuild on settle. */
    characterPreviewDebounceMs: number;
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
    /** Default `paintStroke` smoothness: target boundary edge = radius /
     *  this. The painted edge is clipped exactly, so this only sets how finely
     *  a curve is approximated; higher values add triangles every saved
     *  session must rebuild on open. */
    paintStrokeResolution: number;
    /** Gap filled between consecutive `paintStroke` / `paintAirbrush` path
     *  points, as a fraction of the radius. Smaller = smoother band edge,
     *  more samples. */
    paintStrokePathSpacing: number;
    /** `paintAlongBoundary` paints at most this many seam loops (the longest
     *  ones); the rest are reported as `skippedLoops`. Each loop is one smooth
     *  stroke on the main thread, so a noisy seam with hundreds of specks
     *  would otherwise stall the tab. */
    boundaryPaintMaxLoops: number;
    /** In-memory ring buffer size for the worker run-history log (recent
     *  geometry runs shown in the worker health panel). */
    workerRunHistorySize: number;
    /** Live-refresh interval (ms) for the worker health panel — how often it
     *  re-polls in-flight counts and liveness while open. */
    workerPanelRefreshMs: number;
    /** Default number of entries `partwright.getDiagnosticLog()` (and the AI
     *  `getDiagnosticLog` tool) returns when the caller passes no `limit`.
     *  Newest first; the log itself keeps up to 200 entries. */
    diagnosticLogApiLimit: number;
    /** Whether the "Did you know?" rolling hints strip shows at the top of the
     *  editor. Users can turn it off permanently here; the strip's ✕ only hides
     *  it for the current tab/session. */
    editorHintsEnabled: boolean;
    /** How long each "Did you know?" hint stays before the strip rotates to the
     *  next one (ms). */
    hintRotationMs: number;
    /** Slide duration (ms) for the docked side panes (the AI panel and the code
     *  editor pane) opening/closing. Each pane animates its layout footprint so
     *  the viewport grows/shrinks smoothly instead of snapping. Set to 0 for an
     *  instant toggle. */
    paneSlideMs: number;
    /** Width (px) of the code pane in its compact "mini" mode — the
     *  syntax-colored code map shown by default instead of the full editor. */
    codeMinimapWidthPx: number;
    /** Default code-editor font size (px). The live size is a per-tab pref
     *  (editor-font-size); this seeds a fresh tab and the Reset-to-default. */
    editorFontSizeDefault: number;
    /** Smallest code-editor font size (px) the −/+ stepper allows. */
    editorFontSizeMin: number;
    /** Largest code-editor font size (px) the −/+ stepper allows. */
    editorFontSizeMax: number;
  };
  geometry: {
    /** Triangle count above which the live model warns it may be too heavy for
     *  the catalog budget / slow to slice. Mirrors the headless model:preview
     *  tri-budget warning so the in-app AI sees the same signal. Advisory only —
     *  nothing blocks a denser model; raised to 500k because catalog figure
     *  entries store re-runnable code (not a baked mesh), so a high triangle
     *  count costs per-open render + slice time, not catalog file size. */
    triCountWarnBudget: number;
    /** Shortest mesh edge (world units) below which a fine-detail warning fires
     *  — features this small are dropped by FDM slicers (sub-extrusion-width).
     *  Mirrors model:preview's sub-0.4 mm detail warning. */
    minEdgeLengthWarn: number;
    /** Bounding-box aspect ratio (longest dim ÷ shortest non-zero dim) above
     *  which a sliver/thin-model warning fires. Mirrors model:preview. */
    aspectRatioWarn: number;
    /** Share of the ~4 GB WebAssembly heap ceiling (percent) at which a
     *  manifold-js run counts as memory-heavy. Past it the geometry warnings
     *  flag the model before it reaches "memory access out of bounds", and the
     *  geometry Worker is reset once idle so the next run starts on a fresh,
     *  unfragmented heap (WASM memory never shrinks on its own). 100 disables
     *  both the warning and the reset. */
    engineHeapHighPct: number;
    /** Model code longer than this (characters) skips the SES sandbox's
     *  undeclared-name analysis (#1127): an undeclared name then reads as
     *  `undefined` instead of throwing `ReferenceError`. The analysis parses
     *  the whole source on every run (~0.5 ms per KB — 176 ms for the 363 KB
     *  benchy-reconstruction entry), which matters on live-typing re-runs of
     *  huge generated sources. Passed to the engine Workers when they start. */
    sesUndeclaredCheckMaxChars: number;
  };
  segmentation: {
    /** Part detection: after an interactive STL import, try the automatic
     *  detectors (`autoDetectParts`). When they split the mesh (e.g. a
     *  multi-body figure, one body per colour) the Part Detection panel opens
     *  on the proposal; otherwise the usual convert-to-code ask appears, with
     *  a "Detect parts…" button. Off = always the convert ask. */
    autoDetectOnImport: boolean;
    /** Part detection: imports above this many triangles skip the automatic
     *  import-time pass (it would delay the next-step prompt on huge scans);
     *  the convert ask's "Detect parts…" button still works. */
    autoDetectMaxTriangles: number;
    /** Part detection: an automatic proposal with more parts than this is
     *  dropped (an assembly or a scan with loose debris, not colour bodies).
     *  Explicit `detectParts` calls are not limited. */
    autoDetectMaxParts: number;
    /** Part detection: islands below this fraction of the total surface area
     *  are folded into their neighbours by the panel's "Absorb specks" action
     *  (the absorbSmall edit op default). */
    absorbMinAreaFrac: number;
    /** Part detection: majority-filter passes the panel's "Smooth edges"
     *  action runs over part boundaries (smoothBoundaries default). */
    smoothBoundaryIterations: number;
    /** Part detection: parts listed in console/AI summaries before the list
     *  is truncated (keeps tool results small on over-segmented meshes). */
    maxListedParts: number;
    /** Part detection: edit batches kept for Undo in a draft. */
    undoDepth: number;
    /** Part detection: cells per side of the coarse depth buffer that decides
     *  where renderParts draws each part's number (higher = finds smaller
     *  visible slivers, slightly slower). */
    labelGridResolution: number;
    /** Live mode: wait this long (ms) after the last seed/setting change
     *  before re-running detection. */
    liveDebounceMs: number;
    /** Wait this long (ms) after the last Edge-smoothness change before
     *  recomputing the smooth part edges. */
    edgeSmoothingDebounceMs: number;
    /** Preset filmstrip tile size (px). */
    presetThumbSize: number;
    /** Edge-smoothing passes a new part draft starts with (0 = triangle
     *  edges; acceptParts then keeps the original mesh). */
    defaultEdgeSmoothing: number;
    /** Smooth edges leave a part boundary alone where it runs along a fold
     *  at least this sharp (°, groove or ridge) — a hard edge such as a CAD
     *  box edge already IS the seam. Sculpted grooves (often 30–60° per edge
     *  on scans) still smooth at the default. */
    edgePinCreaseDeg: number;
    /** "Convert to seeds": regions smaller than this fraction of their part
     *  get no seed of their own. */
    seedsFromPartsMinRegionFrac: number;
    /** Seed-marker dot radius as a fraction of the model's diagonal. */
    seedDotFraction: number;
    /** Seed-marker name-tag height as a fraction of the viewport height. */
    seedTagScreenFraction: number;
    /** Part panel "Fix" brush radius as a fraction of the model's diagonal. */
    fixBrushRadiusFrac: number;
    /** Part panel label chips: a chip's pin counts as "missed" (its part
     *  came out empty or a speck) below this fraction of the surface area. */
    chipMissAreaFrac: number;
    /** previewSeeds: a seed farther than this many median edge lengths from
     *  the surface counts as a miss (it is still snapped to the nearest
     *  triangle when detection runs, which is usually not what was meant). */
    seedMissEdgeLengths: number;
    /** renderParts `focus`: padding around the focused part's bounding box,
     *  as a fraction of its largest dimension. */
    focusPadding: number;
    /** Detection folds "specks" — regions under this fraction of the surface
     *  with no pin of any kind, no hand fix, and whose part nobody named,
     *  coloured or locked — into the neighbour they border most. 0 = off. */
    autoAbsorbSpeckFrac: number;
    /** A Separate-pieces proposal of 1–2 pieces counts as a fused figure
     *  (the panel opens with the first label chip armed) when its largest
     *  piece has at least this many triangles. */
    fusedPieceMinTris: number;
    /** Phone layout (below 768 px): the part panel is a bottom sheet this
     *  fraction of the window height, so the model stays visible above it. */
    mobileSheetHeightFrac: number;
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
    toolCallTimeoutMs: 300_000,
    thinkingBudgetAnthropicLow: 2048,
    thinkingBudgetAnthropicMedium: 8192,
    thinkingBudgetAnthropicHigh: 16384,
    thinkingBudgetGeminiLow: 2048,
    thinkingBudgetGeminiMedium: 8192,
    thinkingBudgetGeminiHigh: 24576,
    answerHeadroomTokens: 8192,
    maxOutputTokensAnthropic: 32768,
    maxOutputTokensAnthropicThinking: 32768,
    maxOutputTokensAnthropicThinkingDeep: 64000,
    maxOutputTokensOpenai: 8192,
    maxOutputTokensGemini: 32768,
    charsPerToken: 4,
    imageTokenEstimate: 1500,
    keepRecentToolImages: 3,
    cacheConversationHistory: true,
    cachedImageLimit: 15,
    cachedImageTrimTo: 8,
    autoCompactMaxTokens: 150_000,
    compactionKeepImages: 4,
    customSlimMaxContext: 32_768,
    customMediumMaxContext: 160_000,
    customToolDescriptionChars: 200,
    customParamDescriptionChars: 80,
    customContextProbeTimeoutMs: 3000,
    pruneStaleToolPayloads: true,
    keepRecentCodeBodies: 1,
    codeBodyTrimBatch: 3,
    failedCallInputTurns: 3,
    failedCallInputMinChars: 1500,
    failedCallValueMinChars: 200,
    customOverflowWarnFraction: 0.8,
    reviewReferenceImages: 4,
    reviewConversationMaxChars: 12_000,
    reviewNoteMaxChars: 2000,
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
    isolateGhostOpacity: 0.1,
    creaseEdgeMaxTriangles: 200_000,
    lazyManifoldMinTriangles: 250_000,
    thumbnailMaxTriangles: 600_000,
    containmentSamples: 12,
    modelLogMaxLines: 200,
    modelLogMaxChars: 20_000,
    thicknessMapMaxTriangles: 1_000_000,
    gridRoomFactor: 8,
    gridDivisions: 40,
    gizmoSizePx: 128,
    gizmoMarginPx: 8,
    gizmoHitRadius: 0.4,
    gizmoSnapDurationSec: 0.4,
    orbitDampingFactor: 0.1,
    orbitDampingReferenceFps: 60,
    maxZoomOutFactor: 12,
    defaultFrameFactor: 1.5,
    ambientLightIntensity: 0.6,
    primaryLightIntensity: 0.8,
    secondaryLightIntensity: 0.3,
    offscreenIdleDisposeMs: 10_000,
    pointerGraceMs: 350,
    thumbnailTimeoutMs: 4000,
    enhanceWarnTriangles: 1_000_000,
    enhanceMaxTriangles: 5_000_000,
    surfaceTexturePersistMaxTriangles: 1_000_000,
    storedArrayBlobMinKB: 64,
    paintRefinePersistMaxTriangles: 1_000_000,
    paintRefineCacheMaxMB: 256,
    paintRefineCacheTouchMinutes: 60,
    probePixelsMaxPixels: 4096,
    sdfPreviewScale: 2.5,
    sdfCompile: true,
    sdfCompileChunkNodes: 120,
    assemblyPoolSize: 3,
    exportPoolSize: 8,
    exportMaxSplitItems: 200,
    engineSandboxBootTimeoutMs: 20_000,
    engineSandboxMaxFrameRestarts: 2,
    engineSandboxHeartbeatMs: 2_000,
    assemblyGridGutter: 0.18,
  },
  import: {
    stlWeldTolerance: 1e-5,
    threeMfMaxTriangles: 20_000_000,
    threeMfMaxEntryMB: 1024,
    threeMfMaxColors: 256,
    maxSplitObjects: 100,
    maxImportFiles: 50,
    multiImportGridGap: 0.2,
    maxImportTotalTriangles: 20_000_000,
    multiImportOverlapRatio: 0.5,
    multiImportSimilarSizeRatio: 0.25,
    voxelDefaultMaxSize: 64,
    voxelHeavyThreshold: 250_000,
    voxelSdfMaxSamples: 8_000_000,
    reliefMaxResolution: 512,
    remoteFetchTimeoutMs: 15_000,
    prefillImageSrcMaxChars: 15_000_000,
    prefillImageMaxPixels: 40_000_000,
    filamentMatchThreshold: 0.18,
    filamentConfidenceWarnThreshold: 0.9,
    reconstructCellBudget: 6_000_000,
    reconstructEvalSamples: 4000,
    photoMatchTargetHeight: 160,
    photoMatchBgToleranceMin: 10,
    photoMatchBgTolerance: 40,
    photoMatchKmeansIterations: 8,
    photoMatchBands: 10,
    photoMatchColorShiftWarn: 30,
    photoMatchMaxRegionDistance: 0.12,
    photoMatchRenderSize: 512,
    photoMatchMinSubjectPx: 300,
    photoMatchAmbiguousDeltaE: 12,
    photoMatchOutlineMinPct: 1.5,
    photoMatchOutlineMaxLines: 8,
    photoMatchBusyBorderTolerance: 75,
  },
  ui: {
    toolDialogOpenWaitMs: 4000,
    paintAdjacencyWorkerMinTriangles: 300_000,
    paintAdjacencyWorkerTimeoutMs: 60_000,
    maxPendingAppliedNotes: 6,
    maxAppliedNoteChars: 400,
    toastDurationMs: 2200,
    undoToastDurationMs: 8000,
    deletedObjectRetentionDays: 30,
    tooltipDelayMs: 150,
    exportColorMergeTolerance: 10,
    codeEditorErrorIdleMs: 800,
    codeEditorScrollPinMs: 250,
    companionDraftDebounceMs: 600,
    workCameraSaveDebounceMs: 500,
    surfacePreviewDebounceMs: 250,
    characterPreviewDebounceMs: 450,
    reliefPreviewDebounceMs: 120,
    reliefPreview3dDebounceMs: 250,
    progressModalShowDelayMs: 250,
    sessionLockHeartbeatMs: 3000,
    sessionLockStaleMs: 8000,
    defaultQuality: 128,
    scadDefaultQuality: 32,
    defaultPaletteCapacity: 4,
    paletteHistoryMax: 48,
    paintStrokeResolution: 16,
    paintStrokePathSpacing: 0.25,
    boundaryPaintMaxLoops: 8,
    workerRunHistorySize: 50,
    workerPanelRefreshMs: 1000,
    diagnosticLogApiLimit: 30,
    editorHintsEnabled: true,
    hintRotationMs: 12_000,
    paneSlideMs: 280,
    codeMinimapWidthPx: 132,
    editorFontSizeDefault: 13,
    editorFontSizeMin: 9,
    editorFontSizeMax: 28,
  },
  geometry: {
    triCountWarnBudget: 500_000,
    minEdgeLengthWarn: 0.4,
    aspectRatioWarn: 12,
    engineHeapHighPct: 50,
    sesUndeclaredCheckMaxChars: 150_000,
  },
  segmentation: {
    autoDetectOnImport: true,
    autoDetectMaxTriangles: 2_000_000,
    autoDetectMaxParts: 40,
    absorbMinAreaFrac: 0.002,
    smoothBoundaryIterations: 2,
    maxListedParts: 80,
    undoDepth: 20,
    labelGridResolution: 160,
    liveDebounceMs: 450,
    edgeSmoothingDebounceMs: 250,
    presetThumbSize: 112,
    defaultEdgeSmoothing: 3,
    edgePinCreaseDeg: 60,
    seedsFromPartsMinRegionFrac: 0.01,
    seedDotFraction: 0.008,
    seedTagScreenFraction: 0.026,
    fixBrushRadiusFrac: 0.012,
    chipMissAreaFrac: 0.0005,
    seedMissEdgeLengths: 3,
    focusPadding: 0.15,
    autoAbsorbSpeckFrac: 0.002,
    fusedPieceMinTris: 2000,
    mobileSheetHeightFrac: 0.45,
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

