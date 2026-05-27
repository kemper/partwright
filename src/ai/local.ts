// WebLLM-backed provider. Mirrors the surface of anthropic.ts so chatLoop
// can dispatch by provider without rewriting the loop body.
//
// Architecture notes:
//   * @mlc-ai/web-llm is imported dynamically so it ships in its own Vite
//     chunk — users who never open the local-model modal don't download the
//     ~14 MB engine.
//   * WebLLM's chat surface is OpenAI-shape, so we translate Anthropic-shape
//     ChatMessage[] both directions inside this module.
//   * Tool calls come back as `{ id, function: { name, arguments } }` with
//     arguments as a JSON-encoded string. We parse it here so chatLoop only
//     ever deals with parsed objects (matching what Anthropic returns).
//   * Every curated model uses the prompt-engineered `<tool_call>` path.
//     WebLLM's native path is unreliable across the board — see
//     `supportsNativeToolCalls` for why it stays off for all curated models.

import type {
  ChatBlock,
  ChatMessage,
  ImageSource,
  PersistedToolCall,
  ThinkingBlockData,
  TurnUsage,
} from './types';
import type { ToolDefinition } from './tools';
import type { LocalModelId, LocalModelInfo } from './localModels';
import { isWebGpuAvailable, LOCAL_MODELS } from './localModels';
import { loadSettings, type CustomLocalModel } from './settings';
import { buildFallbackLadder, getCachedCeiling, getModelCeiling } from './modelMetadata';

// We can't statically type-import from @mlc-ai/web-llm without forcing it
// into the main bundle, so we keep the engine handle untyped here and rely
// on duck-typing the methods we use.
interface LoadedEngine {
  modelId: string;
  // The MLCEngine instance (typed loosely so this module doesn't drag the
  // 14 MB SDK into every chunk that imports our `types`).
  engine: any;
  info: LocalModelInfo;
}

/** Translate the user's custom-model records into WebLLM ModelRecord
 *  entries that engine.reload() can resolve. When the user didn't paste a
 *  model_lib URL we make a best-guess from the standard MLC binaries
 *  repo, using the model_id as the WASM filename stem with the canonical
 *  `_cs1k-webgpu.wasm` chunk-size suffix. The engine surfaces a clear
 *  network error if the guess is wrong; the user can then go edit the
 *  custom entry. */
/** Look up the HF weights URL for a model id from the combined appConfig
 *  (curated + custom). Returns null when the id doesn't match anything —
 *  the caller falls back to per-model defaults rather than trying to
 *  fetch ceiling metadata. */
function resolveModelUrl(modelId: string, modelList: Array<{ model_id: string; model: string }>): string | null {
  const entry = modelList.find(m => m.model_id === modelId);
  return entry ? entry.model : null;
}

/** Public lookup for UI components — returns whatever we've cached for
 *  this model id, or the curated default when no fetch has succeeded
 *  yet. Synchronous so renderers don't have to wait. */
export function effectiveContextCeiling(modelId: string, fallback: number): number {
  return getCachedCeiling(modelId) ?? fallback;
}

/** Find a user-supplied context window override for the named custom model. */
function resolveCustomContextWindow(modelId: string): number | null {
  const c = loadSettings().customLocalModels.find(m => m.id === modelId);
  if (!c || !c.contextWindowSize || c.contextWindowSize <= 0) return null;
  return Math.floor(c.contextWindowSize);
}

/** How many tokens to anchor at the front of the context when sliding-window
 *  mode is active. We size it generously to cover the entire system prompt
 *  plus the tool-call instructions appended for prompt-engineered models —
 *  if those scroll off, the model forgets it has tools and the agent loop
 *  collapses. Numbers are conservative estimates (~chars/4) measured against
 *  the actual prompt text; bump the constants in `buildLocalSystemPrompt` /
 *  `appendPromptToolDocs` if you change those. */
function computeAttentionSink(info: LocalModelInfo): number {
  const promptBudget = info.promptTier === 'medium' ? 1300 : 600;
  // Native callers use the `tools` API field, not a system-prompt block,
  // so need minimal sink budget. Other models append a ~400-token compact
  // tool-docs block.
  const toolsBudget = info.officialToolCalling ? 100 : 500;
  const safetyMargin = 200;
  return Math.min(2048, promptBudget + toolsBudget + safetyMargin);
}

function buildCustomModelEntries(webllm: typeof import('@mlc-ai/web-llm')): import('@mlc-ai/web-llm').ModelRecord[] {
  const customs = loadSettings().customLocalModels;
  return customs.map(c => {
    const libUrl = c.modelLibUrl.trim().length > 0
      ? c.modelLibUrl
      : `${webllm.modelLibURLPrefix}${webllm.modelVersion}/${c.id.replace(/-MLC$/, '')}_cs1k-webgpu.wasm`;
    return {
      model: c.modelUrl,
      model_id: c.id,
      model_lib: libUrl,
      vram_required_MB: c.vramMB ?? 0,
      low_resource_required: false,
      overrides: {
        // The actual reload() pass overrides this at load time, so the
        // value here is only a placeholder. Keep it at 4096 — WebLLM
        // requires the field be set to something positive in the
        // appConfig record.
        context_window_size: 4096,
      },
    };
  });
}

/** Pull either a built-in curated model entry or a user-added custom one
 *  by id. Custom models are wrapped in a synthesized LocalModelInfo so the
 *  rest of the app (prompt-tier selection, vision-check, cards) can treat
 *  them uniformly. */
export function resolveLocalModel(id: string): LocalModelInfo {
  const curated = LOCAL_MODELS.find(m => m.id === id);
  if (curated) return curated;
  const custom = loadSettings().customLocalModels.find(m => m.id === id);
  if (!custom) throw new Error(`Unknown local model id: ${id}`);
  return customModelToInfo(custom);
}

/** Synthesize a LocalModelInfo for a user-added custom model so the rest
 *  of the code can stop caring whether a model is curated or pasted in. */
function customModelToInfo(custom: CustomLocalModel): LocalModelInfo {
  // `id` is typed as a union of curated model_ids; for custom models we
  // accept that we're stretching the type — runtime semantics are fine
  // because every consumer treats it as an opaque string.
  return {
    id: custom.id as LocalModelId,
    group: 'custom',
    label: custom.label || custom.id,
    blurb: `Custom model from ${custom.modelUrl}`,
    downloadGB: 0,
    vramMB: custom.vramMB ?? 0,
    // Unknown architecture — use a conservative 128 MB/1K estimate (typical 8B Llama).
    kvCacheMBPer1kTokens: 128,
    recommendedSystem: 'Depends on the model — set by whoever published it.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 2,
    promptTier: 'slim',
    contextWindowSize: custom.contextWindowSize ?? 4096,
  };
}

let loaded: LoadedEngine | null = null;
let loadInFlight: Promise<LoadedEngine> | null = null;

// The actual MLCEngine lives in a dedicated Web Worker (localEngineWorker.ts);
// `engineProxy` is the main-thread `WebWorkerMLCEngine` handle that forwards
// reload / chat.completions / interrupt / unload to it and exposes the exact
// same interface as a same-thread MLCEngine. We keep both as singletons for
// the session: the worker holds the WASM runtime + GPU device, so reusing it
// across model switches (reload swaps the weights in place) is far cheaper
// than spawning a fresh worker each time. `loaded` still tracks which model is
// currently resident; `engineProxy` outlives an unload so the next load is
// fast.
let engineWorker: Worker | null = null;
// Typed loosely (like LoadedEngine.engine) so this module doesn't drag the
// ~6 MB WebLLM SDK types into every chunk that imports our `types`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engineProxy: any = null;

/** Lazily create the model worker + its main-thread proxy, then refresh the
 *  per-load bits (app config for custom models, progress callback) so the
 *  current caller sees download progress. Reused across loads. */
function getEngineProxy(
  webllm: typeof import('@mlc-ai/web-llm'),
  appConfig: import('@mlc-ai/web-llm').AppConfig,
  onProgress: (report: { progress: number; text: string }) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (!engineWorker) {
    engineWorker = new Worker(new URL('./localEngineWorker.ts', import.meta.url), { type: 'module' });
  }
  if (!engineProxy) {
    engineProxy = new webllm.WebWorkerMLCEngine(engineWorker, { appConfig, initProgressCallback: onProgress });
  } else {
    // setAppConfig posts to the worker; postMessage ordering guarantees it
    // lands before the reload below. setInitProgressCallback only updates the
    // proxy-side closure, so progress for this load reaches the right caller.
    engineProxy.setAppConfig(appConfig);
    engineProxy.setInitProgressCallback(onProgress);
  }
  return engineProxy;
}

export interface ProgressUpdate {
  /** 0..1, or NaN if WebLLM doesn't know yet. */
  progress: number;
  /** Human-readable progress, e.g. "Fetching param_shard_0.bin (12.4 MB)". */
  text: string;
}

export interface LoadOptions {
  onProgress?: (update: ProgressUpdate) => void;
}

export interface StorageUsage {
  /** Bytes the browser estimates we (this origin) are currently using
   *  across all storage backends — Cache API, IndexedDB, OPFS, etc. */
  usageBytes: number;
  /** Bytes the browser estimates we're allowed to use before it starts
   *  evicting. Chrome's "best-effort" quota is roughly 60% of free disk. */
  quotaBytes: number;
  /** True when the user has granted persistent storage so the browser
   *  promises not to evict the data even under storage pressure. */
  persistent: boolean;
  /** True when the browser doesn't expose `navigator.storage.estimate` —
   *  the UI shows a "storage info unavailable" line instead of numbers. */
  unavailable: boolean;
}

/** Best-effort snapshot of how much browser storage Partwright is using.
 *  Used by the local-model modal so the user can see how close to the quota
 *  they are before downloading a 5 GB model. */
export async function getStorageUsage(): Promise<StorageUsage> {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav?.storage?.estimate) {
    return { usageBytes: 0, quotaBytes: 0, persistent: false, unavailable: true };
  }
  try {
    const est = await nav.storage.estimate();
    const persistent = nav.storage.persisted ? await nav.storage.persisted() : false;
    return {
      usageBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
      persistent,
      unavailable: false,
    };
  } catch {
    return { usageBytes: 0, quotaBytes: 0, persistent: false, unavailable: true };
  }
}

/** Estimate total device GPU memory in MB using the WebGPU adapter.
 *  Chrome reports maxBufferSize as ~25% of total GPU/unified memory, so
 *  multiplying by 4 approximates the total pool available to GPU workloads.
 *  On Apple Silicon this equals device RAM; on discrete-GPU systems it equals
 *  VRAM. Returns null when WebGPU is unavailable or the probe fails. */
export async function probeGpuBudgetMB(): Promise<number | null> {
  if (!isWebGpuAvailable()) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const maxBuf = adapter.limits.maxBufferSize;
    if (!maxBuf || maxBuf <= 0) return null;
    return (maxBuf / (1024 * 1024)) * 4;
  } catch {
    return null;
  }
}

/** Returns true when WebGPU + a discrete-enough adapter are available.
 *  Soft-fails (no exception) so the UI can render a "not supported" state
 *  rather than crashing on import. */
export async function probeWebGpu(): Promise<{ supported: boolean; adapter: GPUAdapter | null; reason?: string }> {
  if (!isWebGpuAvailable()) {
    return { supported: false, adapter: null, reason: 'navigator.gpu is not present in this browser.' };
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, adapter: null, reason: 'WebGPU is exposed but no compatible adapter is available.' };
    }
    return { supported: true, adapter };
  } catch (err) {
    return { supported: false, adapter: null, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Returns the model ids that already have weights cached locally, so the
 *  UI can show a "Loaded" pill instead of asking the user to re-download. */
export async function getCachedModels(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const webllm = await import('@mlc-ai/web-llm');
    const list = (webllm.prebuiltAppConfig.model_list ?? []) as { model_id: string; model: string }[];
    for (const entry of list) {
      // `hasModelInCache` is async and per-model; the public API takes the
      // model_id and looks up the URL behind the scenes.
      const cached = await webllm.hasModelInCache(entry.model_id, webllm.prebuiltAppConfig);
      if (cached) ids.add(entry.model_id);
    }
  } catch {
    // Cache check failures are non-fatal — we just under-report.
  }
  return ids;
}

/** Delete a model's cached weights. Used by the "Remove" button in the
 *  local-model modal. Waits for any in-flight load to settle first so we
 *  don't race the SDK populating `loaded` with a freshly-loaded engine
 *  whose cache we're about to wipe. */
/** Unload whatever model is currently resident in the GPU, without
 *  touching the on-disk cache. Used when the user changes settings that
 *  bake into engine.reload() — context window override, sliding window
 *  toggle — so the next sendMessage rebuilds the engine with the new
 *  config. The on-cache weights survive so the rebuild is fast. */
export async function unloadActiveLocalModel(): Promise<void> {
  if (loadInFlight) {
    try { await loadInFlight; } catch { /* noop */ }
  }
  if (loaded) {
    try { await loaded.engine.unload?.(); } catch { /* noop */ }
    loaded = null;
  }
}

export async function deleteCachedModel(modelId: string): Promise<void> {
  if (loadInFlight) {
    try { await loadInFlight; } catch { /* noop — failed loads still finalize */ }
  }
  const webllm = await import('@mlc-ai/web-llm');
  await webllm.deleteModelAllInfoInCache(modelId, webllm.prebuiltAppConfig);
  if (loaded?.modelId === modelId) {
    try { await loaded.engine.unload?.(); } catch { /* noop */ }
    loaded = null;
  }
}

/** Whether a specific model is currently resident in GPU memory. The UI
 *  surfaces this so a second user message doesn't waste seconds re-loading
 *  weights into VRAM. */
export function isModelLoaded(modelId: string): boolean {
  return loaded?.modelId === modelId;
}

/** Get the currently loaded model id, or null. */
export function loadedModelId(): string | null {
  return loaded?.modelId ?? null;
}

/** Load (download if needed + activate) a model. Idempotent — calling again
 *  with the same id is a no-op; calling with a different id swaps. Single-
 *  flighted so two concurrent UI clicks don't race. Accepts both curated
 *  model ids and the ids of user-added custom models. */
export async function ensureModelLoaded(modelId: string, opts: LoadOptions = {}): Promise<void> {
  if (loaded?.modelId === modelId) return;
  if (loadInFlight) {
    const current = await loadInFlight;
    if (current.modelId === modelId) return;
  }
  loadInFlight = (async () => {
    const info = resolveLocalModel(modelId);
    const webllm = await import('@mlc-ai/web-llm');

    // Unload a different model first to free VRAM before the next set of
    // weights arrives. Otherwise we'd briefly hold ~10 GB on a swap.
    if (loaded && loaded.modelId !== modelId) {
      try { await loaded.engine.unload?.(); } catch { /* noop */ }
      loaded = null;
    }

    // Inject user-added custom models into a clone of the prebuilt
    // appConfig so engine.reload() can resolve them by id. We pre-fill
    // model_lib from the user's input, falling back to the standard
    // WebLLM model-lib URL prefix if blank.
    const appConfig = { ...webllm.prebuiltAppConfig };
    appConfig.model_list = [
      ...webllm.prebuiltAppConfig.model_list,
      ...buildCustomModelEntries(webllm),
    ];

    // The engine runs in localEngineWorker.ts; this proxy forwards to it.
    // Default cache backend is "cache" (Cache API). Safari caps that at ~1 GB;
    // OPFS is uncapped after the storage permission prompt, so WebLLM prefers
    // it when available and falls back if the browser lacks OPFS. The cache is
    // origin-wide, so weights downloaded by the worker are still visible to
    // the main-thread cache helpers (getCachedModels / deleteCachedModel).
    const engine = getEngineProxy(webllm, appConfig, (report: { progress: number; text: string }) => {
      opts.onProgress?.({ progress: report.progress, text: report.text });
    });

    // Compute the context override. Priority: user-set global override,
    // then the model's declared default, then a safe 4096 fallback. If
    // sliding window is enabled we pass `sliding_window_size` instead —
    // WebLLM rejects requests that set both at once. Sliding-window mode
    // also needs an `attention_sink_size` (StreamingLLM-style anchored
    // tokens) so the system prompt stays in view as old turns roll off.
    //
    // Before requesting, fetch the WASM's actual compile-time ceiling
    // from the model's mlc-chat-config.json — that lets us clamp the
    // desired window to a value we know will be accepted, instead of
    // optimistically requesting more and falling back blindly when the
    // engine rejects.
    const { localContext } = loadSettings();
    const customWindow = resolveCustomContextWindow(modelId);
    const requested = localContext.windowSizeOverride
      ?? customWindow
      ?? info.contextWindowSize
      ?? 4096;
    const modelUrl = resolveModelUrl(modelId, appConfig.model_list as Array<{ model_id: string; model: string }>);
    let ceiling: number | null = null;
    if (modelUrl) {
      try {
        opts.onProgress?.({ progress: 0, text: 'Checking model context ceiling…' });
        ceiling = await getModelCeiling(modelId, modelUrl);
      } catch {
        // Fall through — we'll request `requested` and rely on the
        // fallback ladder if the WASM rejects.
      }
    }
    let desired = ceiling !== null ? Math.min(requested, ceiling) : requested;

    // Probe available GPU memory and auto-reduce the context window if the
    // model + KV-cache pre-allocation would exceed ~50% of device memory.
    // The KV cache is allocated in full at reload() time — exceeding device
    // memory causes a hard OOM that can kill the browser or, on macOS, log
    // the user out entirely. We prefer a smaller context over a system crash.
    const budgetMB = await probeGpuBudgetMB();
    if (budgetMB !== null && budgetMB > 0) {
      const safeModelMB = budgetMB * 0.5; // 50% leaves headroom for OS + browser
      const kvAtDesired = info.kvCacheMBPer1kTokens * desired / 1000;
      if (info.vramMB + kvAtDesired > safeModelMB) {
        for (const c of [16384, 8192, 4096]) {
          if (c >= desired) continue;
          if (info.vramMB + info.kvCacheMBPer1kTokens * c / 1000 <= safeModelMB) {
            opts.onProgress?.({
              progress: 0,
              text: `Context auto-reduced from ${desired} to ${c} tokens — model + KV cache would exceed ~${Math.round(budgetMB / 1024)} GB GPU memory budget`,
            });
            desired = c;
            break;
          }
        }
      }
    }

    const sinkSize = computeAttentionSink(info);
    const ladder = buildFallbackLadder(desired);

    let succeededAt: number | null = null;
    let lastErr: unknown = null;
    for (const candidate of ladder) {
      const reloadConfig = localContext.sliding
        ? { sliding_window_size: candidate, attention_sink_size: sinkSize }
        : { context_window_size: candidate };
      try {
        if (candidate < desired) {
          opts.onProgress?.({ progress: 0, text: `Context ${desired} rejected, retrying at ${candidate}…` });
        }
        await engine.reload(modelId, reloadConfig);
        succeededAt = candidate;
        break;
      } catch (err) {
        lastErr = err;
        // Keep ladder-walking unless this is the last rung.
      }
    }
    if (succeededAt === null) {
      throw lastErr instanceof Error ? lastErr : new Error('Failed to load model at any context window size');
    }

    const next: LoadedEngine = { modelId, engine, info };
    loaded = next;
    return next;
  })();

  try {
    await loadInFlight;
  } finally {
    loadInFlight = null;
  }
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onToolStart?: (toolUseId: string, toolName: string) => void;
}

export interface StreamResult {
  text: string;
  toolCalls: PersistedToolCall[];
  stopReason: string;
  usage: TurnUsage;
  /** True when the model didn't finish cleanly — hit max_tokens, or
   *  emitted an unclosed `<tool_call>` block (a crash, likely). chatLoop
   *  surfaces a "response was cut off" message and skips re-prompting. */
  truncated?: boolean;
  /** Reasoning text if surfaced. Local `<think>` blocks are stripped and
   *  hidden today, so this stays undefined; present so chatLoop reads
   *  `result.thinking` uniformly across providers. */
  thinking?: string;
  /** Anthropic-only thinking-block replay payload — always undefined here.
   *  Declared for a uniform `StreamResult` across the provider union. */
  thinkingBlocks?: ThinkingBlockData[];
}

export interface LocalRequestSpec {
  modelId: string;
  systemPrompt: string;
  systemSuffix: string;
  /** Full prior conversation, oldest first, with the new user turn already
   *  appended at the end. We translate to OpenAI shape inside. */
  history: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
}

/** Single agent-loop iteration against a local model. Mirrors the shape
 *  returned by anthropic.streamTurn so chatLoop can swap providers cleanly.
 *
 *  Two tool-calling strategies, chosen per model:
 *    * Native — models we've verified work with WebLLM's OpenAI `tools`
 *      path (see `supportsNativeToolCalls`). Currently unused: no curated
 *      model has `officialToolCalling: true` because WebLLM's native path
 *      is unreliable across the board for Partwright's use case.
 *    * Prompt-engineered — every curated model uses this path: the `tools`
 *      with an UnsupportedModelIdError. We inject tool descriptions into
 *      the system prompt and ask the model to emit `<tool_call>{...}</tool_call>`
 *      blocks, then parse them out post-stream. */
export async function streamLocalTurn(spec: LocalRequestSpec, callbacks: StreamCallbacks = {}, signal?: AbortSignal): Promise<StreamResult> {
  if (!loaded || loaded.modelId !== spec.modelId) {
    throw new Error(`Local model ${spec.modelId} is not loaded. Open AI settings → Local model to download it first.`);
  }
  const { engine, info } = loaded;
  // Already aborted before we even start — don't kick off a generation we'd
  // immediately throw away.
  if (signal?.aborted) {
    return {
      text: '', toolCalls: [], stopReason: 'aborted',
      usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
      truncated: false,
    };
  }
  // Default is intentionally modest — local models share their context
  // with the whole conversation, and the 70B is capped at 4K. Reserving
  // 768 for output leaves room for the system prompt + tool docs +
  // scrollback even on the tightest model.
  const maxTokens = spec.maxTokens ?? 768;
  const native = await supportsNativeToolCalls(spec.modelId);

  const systemSuffix = native
    ? spec.systemSuffix
    : appendPromptToolDocs(spec.systemSuffix, spec.tools);
  const messages = buildLocalApiMessages(spec.systemPrompt, systemSuffix, spec.history, info, native);

  const baseReq: Record<string, unknown> = {
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxTokens,
    temperature: 0.6,
  };
  if (native && spec.tools.length > 0) {
    baseReq.tools = buildOpenAiTools(spec.tools);
    baseReq.tool_choice = 'auto';
  }

  const stream = await engine.chat.completions.create(baseReq);

  // Stop WebLLM generation promptly on a Stop click, even if no further chunk
  // arrives to trip the per-chunk signal check inside the loop below.
  const onAbort = () => { try { engine.interruptGenerate(); } catch { /* noop */ } };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  let rawText = '';
  let stopReason = 'unknown';
  const toolBuf = new Map<number, { id: string; name: string; argsRaw: string; announced: boolean }>();
  const usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };

  // Track what we've emitted to the UI so we can suppress structured-output
  // markup mid-stream. Two kinds of markup get scanned out of the visible
  // bubble: `<tool_call>...</tool_call>` (the prompt-engineered tool path)
  // and `<think>...</think>` (Qwen 3 / Qwen 3.5 / DeepSeek-R1 reasoning
  // models — they emit chain-of-thought tags on every turn whether they
  // have anything to think about or not, and the user shouldn't see them).
  // We use a single "suppress" state and walk the buffer recognizing the
  // earliest open marker each iteration.
  let emittedLen = 0;
  let suppressMode: null | 'tool_call' | 'think' = null;
  let pendingToolCallId = 1;

  // The longest open marker we need to keep buffered when no open tag has
  // been found yet — otherwise we could split a `<think>` or `<tool_call>`
  // across two delta emissions and leak the prefix to the UI.
  const MAX_OPEN_LEN = Math.max(TOOL_CALL_OPEN.length, THINK_OPEN.length);

  try { for await (const chunk of stream as AsyncIterable<any>) {
    if (signal?.aborted) { stopReason = 'aborted'; break; }
    const choice = chunk?.choices?.[0];
    if (choice?.delta?.content) {
      const delta = choice.delta.content as string;
      rawText += delta;
      // Walk the buffer for both `<tool_call>` and `<think>` markers.
      // Native function-calling models don't emit tool_call markup — the
      // SDK exposes tool calls via `delta.tool_calls` below — but they CAN
      // emit `<think>` tags if the user loaded a reasoning-style custom
      // model, so the scanner runs in both modes.
      while (emittedLen < rawText.length) {
        if (suppressMode === null) {
          const tcIdx = !native ? rawText.indexOf(TOOL_CALL_OPEN, emittedLen) : -1;
          const thIdx = rawText.indexOf(THINK_OPEN, emittedLen);
          const nextOpen = pickEarliest(tcIdx, thIdx);
          if (nextOpen === null) {
            // No open marker present — emit everything up to a safe
            // cutoff (leave the last few chars unemitted so a marker
            // straddling deltas doesn't leak its prefix).
            const safe = Math.max(emittedLen, rawText.length - MAX_OPEN_LEN);
            if (safe > emittedLen) {
              callbacks.onText?.(rawText.slice(emittedLen, safe));
              emittedLen = safe;
            }
            break;
          }
          // Emit text up to the open marker, then enter suppress mode.
          if (nextOpen.idx > emittedLen) callbacks.onText?.(rawText.slice(emittedLen, nextOpen.idx));
          emittedLen = nextOpen.idx + (nextOpen.kind === 'tool_call' ? TOOL_CALL_OPEN.length : THINK_OPEN.length);
          suppressMode = nextOpen.kind;
          if (nextOpen.kind === 'tool_call') {
            // Provisional announcement; the actual name is unknown until parse.
            callbacks.onToolStart?.(`tc_${pendingToolCallId++}`, 'tool');
          }
        } else if (suppressMode === 'tool_call') {
          const closeIdx = rawText.indexOf(TOOL_CALL_CLOSE, emittedLen);
          if (closeIdx === -1) break;
          emittedLen = closeIdx + TOOL_CALL_CLOSE.length;
          suppressMode = null;
        } else {
          const closeIdx = rawText.indexOf(THINK_CLOSE, emittedLen);
          if (closeIdx === -1) break;
          emittedLen = closeIdx + THINK_CLOSE.length;
          suppressMode = null;
        }
      }
    }
    if (native && choice?.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
        const idx = tc.index ?? 0;
        let entry = toolBuf.get(idx);
        if (!entry) {
          entry = { id: tc.id ?? `tool_${idx}`, name: '', argsRaw: '', announced: false };
          toolBuf.set(idx, entry);
        }
        if (tc.id) entry.id = tc.id;
        if (tc.function?.name) entry.name = tc.function.name;
        if (tc.function?.arguments) entry.argsRaw += tc.function.arguments;
        if (!entry.announced && entry.name) {
          entry.announced = true;
          callbacks.onToolStart?.(entry.id, entry.name);
        }
      }
    }
    if (choice?.finish_reason) stopReason = choice.finish_reason;
    if (chunk?.usage) {
      usage.inputTokens = chunk.usage.prompt_tokens ?? usage.inputTokens;
      usage.outputTokens = chunk.usage.completion_tokens ?? usage.outputTokens;
    }
  } } catch (err: any) {
    // WebLLM throws ToolCallOutputParseError when a native function-calling
    // model responds with plain text instead of a JSON tool call array. The
    // content deltas were already streamed into rawText, so we treat this
    // as a normal end-of-turn by resetting stopReason to 'stop'.
    if (err?.name !== 'ToolCallOutputParseError') throw err;
    stopReason = 'stop';
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  // Final flush: anything still unemitted outside a suppressed block goes
  // out now. (Anything still inside `<think>` or `<tool_call>` is dropped
  // by intent — see truncation handling below for the tool-call case.)
  if (suppressMode === null && emittedLen < rawText.length) {
    callbacks.onText?.(rawText.slice(emittedLen));
    emittedLen = rawText.length;
  }

  // Truncation detection: max_tokens was hit OR we're stuck mid-tool-call
  // with no closing marker. (Truncated `<think>` blocks aren't surfaced —
  // the user wouldn't have seen them even if completed.) Show the partial
  // tool-call body so the user understands what failed, and flag the
  // result so chatLoop can emit a "response was cut off" notice.
  const truncatedMidToolCall = suppressMode === 'tool_call';
  // A truncated `<think>` block (suppressMode === 'think' at stream end)
  // doesn't need its own surface — the user never saw the partial CoT
  // anyway, and `truncatedMaxTokens` below still flags the cut-off turn.
  const truncatedMaxTokens = stopReason === 'length' || stopReason === 'max_tokens';
  if (truncatedMidToolCall && emittedLen < rawText.length) {
    callbacks.onText?.(`\n\n[partial output — tool call was cut off]\n${rawText.slice(emittedLen)}`);
    emittedLen = rawText.length;
  }

  // Strip any complete `<think>...</think>` blocks before further parsing.
  // The streaming scanner already kept them out of the live bubble; this
  // makes sure they don't get persisted as part of the assistant message
  // (which would also rebroadcast them to the model on the next turn).
  // Unclosed `<think>` tails (truncation) just get dropped.
  const withoutThink = stripThinkBlocks(rawText);

  let toolCalls: PersistedToolCall[] = [];
  let cleanedText: string;
  if (native) {
    toolCalls = collectNativeToolCalls(toolBuf);
    cleanedText = withoutThink;
  } else {
    const parsed = parsePromptToolCalls(withoutThink);
    toolCalls = parsed.toolCalls;
    cleanedText = parsed.cleanedText;
  }

  // Normalize finish_reason to match Anthropic vocabulary ("tool_use" /
  // "end_turn") so chatLoop's branching reads the same.
  let normStop = stopReason;
  // An aborted turn wins over everything else: chatLoop persists the partial
  // text and skips tool execution when stopReason is 'aborted'.
  if (signal?.aborted || stopReason === 'aborted') normStop = 'aborted';
  else if (toolCalls.length > 0 && !truncatedMidToolCall) normStop = 'tool_use';
  else if (truncatedMidToolCall || truncatedMaxTokens) normStop = 'max_tokens';
  else if (stopReason === 'stop') normStop = 'end_turn';

  return {
    text: cleanedText,
    toolCalls,
    stopReason: normStop,
    usage,
    truncated: truncatedMidToolCall || (truncatedMaxTokens && toolCalls.length === 0),
  };
}

/** Cached lookup of WebLLM's `functionCallingModelIds`. Async because the
 *  list lives inside the lazy-loaded WebLLM chunk.
 *
 *  We gate on our own `officialToolCalling` flag (currently false for all
 *  curated models) because WebLLM's list is over-inclusive — advertised
 *  models either don't get JSON-schema injection or reject a custom system
 *  prompt when tools are passed. All curated models use the prompt-
 *  engineered `<tool_call>` path instead. */
let nativeIdsCache: Set<string> | null = null;
async function supportsNativeToolCalls(modelId: string): Promise<boolean> {
  if (!nativeIdsCache) {
    const webllm = await import('@mlc-ai/web-llm');
    nativeIdsCache = new Set(webllm.functionCallingModelIds as readonly string[]);
  }
  if (!nativeIdsCache.has(modelId)) return false;
  const info = LOCAL_MODELS.find(m => m.id === modelId);
  return info?.officialToolCalling === true;
}

function collectNativeToolCalls(toolBuf: Map<number, { id: string; name: string; argsRaw: string }>): PersistedToolCall[] {
  const out: PersistedToolCall[] = [];
  for (const entry of toolBuf.values()) {
    if (!entry.name) continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = entry.argsRaw.trim().length > 0 ? JSON.parse(entry.argsRaw) : {};
    } catch {
      parsed = { __raw: entry.argsRaw };
    }
    out.push({ id: entry.id, name: entry.name, input: parsed });
  }
  return out;
}

// === Prompt-engineered tool calling ===

const TOOL_CALL_OPEN = '<tool_call>';
const TOOL_CALL_CLOSE = '</tool_call>';

// Reasoning-style models (Qwen 3, Qwen 3.5, DeepSeek-R1 and their MLC
// builds) emit `<think>...</think>` chain-of-thought blocks at the start
// of every response, often with empty content when the prompt is trivial.
// We strip them at every level: the streaming scanner suppresses live
// emission, and `stripThinkBlocks` cleans the persisted text so they
// don't echo back on the next turn through the message history.
const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

/** Given two `indexOf` results, return the earliest non-negative match
 *  along with which marker matched. Returns null when neither is found.
 *  Used by the streaming scanner to decide which suppression mode to
 *  enter when the model interleaves `<think>` and `<tool_call>` output. */
function pickEarliest(
  tcIdx: number,
  thIdx: number,
): { idx: number; kind: 'tool_call' | 'think' } | null {
  if (tcIdx < 0 && thIdx < 0) return null;
  if (tcIdx < 0) return { idx: thIdx, kind: 'think' };
  if (thIdx < 0) return { idx: tcIdx, kind: 'tool_call' };
  return tcIdx < thIdx ? { idx: tcIdx, kind: 'tool_call' } : { idx: thIdx, kind: 'think' };
}

/** Remove every complete `<think>...</think>` block from a string. Used
 *  post-stream so the persisted assistant message — and therefore the
 *  history sent on the next turn — never carries chain-of-thought
 *  markup. Unclosed (truncated) tails are also stripped from the
 *  opening marker onward. */
function stripThinkBlocks(text: string): string {
  // Greedy strip of completed blocks first (non-greedy `[\s\S]*?` so
  // adjacent blocks don't merge). The `\s*` after `</think>` swallows
  // the whitespace that typically follows so we don't leave a blank
  // line at the top of the bubble.
  const completed = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  // Then strip any trailing unclosed block (truncation).
  const unclosed = completed.indexOf(THINK_OPEN);
  return unclosed >= 0 ? completed.slice(0, unclosed).trimEnd() : completed.trimEnd();
}

/** Build a compact tool-use instruction block to append to the system
 *  prompt. Kept terse — the 70B's 4K context window can't spare much for
 *  tool docs, so we summarize each tool as one line and rely on the model's
 *  instruction following to emit correct <tool_call> markup. */
function appendPromptToolDocs(existingSuffix: string, tools: ToolDefinition[]): string {
  if (tools.length === 0) return existingSuffix;
  const lines: string[] = [];
  if (existingSuffix.trim().length > 0) lines.push(existingSuffix);
  lines.push('');
  lines.push('## Tool calling');
  lines.push('');
  lines.push('Call a tool by emitting (verbatim):');
  lines.push('<tool_call>{"name": "tool_name", "arguments": {…}}</tool_call>');
  lines.push('After a tool call, stop and wait for the result. Multiple calls per turn are allowed.');
  lines.push('');
  lines.push('Available tools:');
  for (const t of tools) lines.push(`- ${compactToolSignature(t)}`);
  return lines.join('\n');
}

function compactToolSignature(t: ToolDefinition): string {
  const props = (t.input_schema.properties ?? {}) as Record<string, { type?: string; items?: { type?: string } }>;
  const required = new Set(t.input_schema.required ?? []);
  const args = Object.entries(props).map(([name, schema]) => {
    let type = schema.type ?? 'any';
    if (type === 'array' && schema.items?.type) type = `${schema.items.type}[]`;
    return required.has(name) ? `${name}: ${type}` : `${name}?: ${type}`;
  }).join(', ');
  // Trim description to a single sentence — most descriptions already end
  // at the first period.
  const shortDesc = t.description.split(/[.!]\s/)[0].trim();
  return `\`${t.name}(${args})\` — ${shortDesc}.`;
}

/** Pull `<tool_call>...</tool_call>` blocks out of a model response. Returns
 *  the cleaned conversational text (with markup stripped) plus parsed calls. */
function parsePromptToolCalls(text: string): { cleanedText: string; toolCalls: PersistedToolCall[] } {
  const calls: PersistedToolCall[] = [];
  let cleaned = '';
  let cursor = 0;
  let n = 0;
  while (cursor < text.length) {
    const open = text.indexOf(TOOL_CALL_OPEN, cursor);
    if (open === -1) {
      cleaned += text.slice(cursor);
      break;
    }
    cleaned += text.slice(cursor, open);
    const close = text.indexOf(TOOL_CALL_CLOSE, open + TOOL_CALL_OPEN.length);
    if (close === -1) {
      // Truncated — keep what we have and stop. The malformed tail is
      // dropped from the user-visible text rather than printed verbatim.
      break;
    }
    const body = text.slice(open + TOOL_CALL_OPEN.length, close).trim();
    const parsed = tryParseToolCallBody(body);
    if (parsed) {
      calls.push({ id: `tc_${++n}`, name: parsed.name, input: parsed.arguments });
    }
    cursor = close + TOOL_CALL_CLOSE.length;
  }
  return { cleanedText: cleaned.trim(), toolCalls: calls };
}

function tryParseToolCallBody(body: string): { name: string; arguments: Record<string, unknown> } | null {
  // Be lenient: strip a JSON code fence if the model wraps the call.
  const stripped = body.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(stripped) as { name?: unknown; arguments?: unknown; parameters?: unknown };
    if (typeof obj.name !== 'string') return null;
    const args = (obj.arguments ?? obj.parameters ?? {}) as Record<string, unknown>;
    return { name: obj.name, arguments: typeof args === 'object' && args !== null ? args : {} };
  } catch {
    return null;
  }
}

/** Interrupt a generation in progress. Used by the chat panel's stop button. */
export async function interruptLocal(): Promise<void> {
  if (loaded?.engine?.interruptGenerate) {
    try { loaded.engine.interruptGenerate(); } catch { /* noop */ }
  }
}

/** Single-shot, non-streamed completion. Compaction uses it. */
export async function summarizeLocal(
  modelId: string,
  system: string,
  user: string,
  maxTokens = 512,
): Promise<{ text: string; usage: TurnUsage }> {
  if (!loaded || loaded.modelId !== modelId) {
    throw new Error(`Local model ${modelId} is not loaded.`);
  }
  const { engine } = loaded;
  const response = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    max_tokens: maxTokens,
    temperature: 0.4,
  });
  const text = response?.choices?.[0]?.message?.content ?? '';
  return {
    text,
    usage: {
      inputTokens: response?.usage?.prompt_tokens ?? 0,
      outputTokens: response?.usage?.completion_tokens ?? 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
}

// === Anthropic-shape ↔ OpenAI-shape translation ===

function buildOpenAiTools(tools: ToolDefinition[]): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function buildLocalApiMessages(
  systemPrompt: string,
  systemSuffix: string,
  history: ChatMessage[],
  info: LocalModelInfo,
  native: boolean,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const sys = systemSuffix.trim().length > 0 ? `${systemPrompt}\n\n${systemSuffix}` : systemPrompt;
  out.push({ role: 'system', content: sys });

  for (const msg of history) {
    if (msg.role === 'user') {
      if (native) {
        // Native function-calling models expect one OpenAI "tool" message
        // per tool_call_id.
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const r of msg.toolResults) {
            out.push({ role: 'tool', tool_call_id: r.toolUseId, content: r.content });
          }
        }
        const content = userBlocksToContent(msg.blocks, info);
        if (content !== null) out.push({ role: 'user', content });
      } else {
        // Prompt-engineered path: collapse tool results into a single user
        // turn the model can read as plain text.
        const parts: string[] = [];
        if (msg.toolResults && msg.toolResults.length > 0) {
          for (const r of msg.toolResults) {
            parts.push(`<tool_result${r.isError ? ' error="true"' : ''}>\n${r.content}\n</tool_result>`);
          }
        }
        const textContent = userBlocksToContent(msg.blocks, info);
        if (typeof textContent === 'string') parts.push(textContent);
        else if (Array.isArray(textContent)) {
          // Vision multipart: append the parts directly when supported.
          // Falls through below.
        }
        if (parts.length > 0) {
          if (Array.isArray(textContent)) {
            const merged: unknown[] = [...textContent, { type: 'text', text: parts.join('\n\n') }];
            out.push({ role: 'user', content: merged });
          } else {
            out.push({ role: 'user', content: parts.join('\n\n') });
          }
        } else if (Array.isArray(textContent)) {
          out.push({ role: 'user', content: textContent });
        }
      }
    } else {
      const content = assistantTextOf(msg.blocks);
      if (native) {
        const toolCalls = (msg.toolCalls ?? []).map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.input ?? {}) },
        }));
        const assistantMsg: Record<string, unknown> = { role: 'assistant' };
        if (content.length > 0) assistantMsg.content = content;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        if (content.length > 0 || toolCalls.length > 0) out.push(assistantMsg);
      } else {
        // Re-serialize prior tool calls in the same `<tool_call>` markup
        // the model is being trained on this turn — keeps the conversation
        // self-consistent.
        const parts: string[] = [];
        if (content.length > 0) parts.push(content);
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            parts.push(`${TOOL_CALL_OPEN}\n${JSON.stringify({ name: tc.name, arguments: tc.input ?? {} })}\n${TOOL_CALL_CLOSE}`);
          }
        }
        if (parts.length > 0) out.push({ role: 'assistant', content: parts.join('\n\n') });
      }
    }
  }
  return out;
}

function userBlocksToContent(blocks: ChatBlock[], info: LocalModelInfo): string | Array<unknown> | null {
  const textParts: string[] = [];
  const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text.trim().length > 0) textParts.push(b.text);
    } else if (b.type === 'image' && info.supportsVision) {
      imageParts.push({ type: 'image_url', image_url: { url: imageDataUrl(b.source) } });
    }
    // Non-vision models silently drop image blocks. The toggle-suffix in
    // systemPrompt.ts already tells the model it can't see views, so the
    // model shouldn't ask for them.
  }
  if (textParts.length === 0 && imageParts.length === 0) return null;
  if (imageParts.length === 0) return textParts.join('\n\n');
  // Mixed text+image — OpenAI multipart content array.
  const parts: unknown[] = imageParts;
  if (textParts.length > 0) parts.push({ type: 'text', text: textParts.join('\n\n') });
  return parts;
}

function assistantTextOf(blocks: ChatBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push(b.text);
    // Cross-provider review lands as an assistant turn; surface it on the
    // next turn so the local model sees the reviewer's feedback.
    else if (b.type === 'review' && b.text.length > 0) {
      parts.push(`[Review from ${b.provider}/${b.model}]\n${b.text}`);
    }
  }
  return parts.join('');
}

function imageDataUrl(source: ImageSource): string {
  return `data:${source.mediaType};base64,${source.data}`;
}
