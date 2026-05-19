// Static registry of WebLLM models we expose to the user. Each entry
// corresponds to a `model_id` in the WebLLM prebuilt config (see
// `node_modules/@mlc-ai/web-llm/lib/index.js` `prebuiltAppConfig.model_list`).
//
// Curation rules:
//   * Only include models that have been tested end-to-end with Partwright
//     and reliably emit <tool_call> blocks, OR have strong architectural
//     evidence of compatibility (e.g. same model family as a tested model).
//     Sub-8B models are only included when their tool-call training is
//     specifically baked into the chat template (not just fine-tuned on top).
//   * For each model we record subjective quality (1-3 stars) for this
//     specific app's use case and the minimum system the model is happy
//     on. These numbers come from local benchmarking + WebLLM's reported
//     vram_required_MB; treat them as guidance, not guarantees.
//   * `promptTier` decides which system prompt the model gets:
//     'slim' (~700 tokens) for small models, 'medium' (~1.1K tokens) for
//     models that can take a richer brief. Both rely on the `readDoc`
//     tool to pull /ai/<topic>.md subdocs on demand, so the in-prompt
//     budget can stay small even when the model needs detailed paint /
//     curves / BOSL2 instructions.

export type LocalModelId = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

/** Coarse grouping shown as section headers in the picker. The `custom`
 *  group is reserved for user-added models from AiSettings.customLocalModels;
 *  no built-in entries live there. */
export type LocalSizeGroup = 'recommended' | 'smaller' | 'larger' | 'flagship' | 'custom';

export type PromptTier = 'slim' | 'medium';

export interface LocalModelInfo {
  id: LocalModelId;
  group: LocalSizeGroup;
  label: string;
  /** Short pitch shown next to the radio button. */
  blurb: string;
  /** Approximate download size, GB. */
  downloadGB: number;
  /** VRAM the model needs once loaded — from WebLLM's prebuilt config. */
  vramMB: number;
  /** Approximate KV-cache memory in MB per 1 K context tokens (float16).
   *  Derived from the model's layer count, number of KV heads, and head
   *  dimension: layers × kvHeads × headDim × 2 (K+V) × 2 bytes × 1000 tokens.
   *  Used at load time to estimate total GPU memory and auto-reduce the
   *  context window on memory-constrained devices.
   *  Total estimate: vramMB + kvCacheMBPer1kTokens × contextTokens / 1000 */
  kvCacheMBPer1kTokens: number;
  /** Human-readable system recommendation (RAM/VRAM combination needed). */
  recommendedSystem: string;
  /** Whether the model can see image inputs. Kept as a property so custom
   *  user-added models can opt in, even though no built-in model currently
   *  supports vision. */
  supportsVision: boolean;
  /** True when WebLLM's native tool-calling path works end-to-end for this
   *  model — WebLLM accepts the OpenAI `tools` field AND injects a JSON-schema
   *  constrained system prompt. Currently false for all curated models: every
   *  curated model uses our prompt-engineered `<tool_call>` path instead. */
  officialToolCalling: boolean;
  /** Subjective quality rating for *this app's* use case (driving Partwright
   *  with tool calls), 1-3 stars. Not a generic LLM benchmark. */
  qualityStars: 1 | 2 | 3;
  /** Which built-in system prompt the model receives by default. */
  promptTier: PromptTier;
  /** Default context window size in tokens for this model. WebLLM caps
   *  every prebuilt WASM at compile time; these are the value we REQUEST
   *  at engine.reload(). The actual ceiling is fetched at load time from
   *  the model's `mlc-chat-config.json` (see `modelMetadata.ts`) and the
   *  requested value gets clamped down to whatever the WASM accepts. So
   *  these can be aggressive — they're capped automatically. KV cache
   *  memory grows linearly with the resolved window; bumping the 70B to
   *  16K eats ~8 GB extra VRAM, hence its conservative default. */
  contextWindowSize: number;
}

/** Estimate total GPU memory required for a model at a given context window.
 *  Returns megabytes. Used by the modal for display and by ensureModelLoaded
 *  for memory-budget auto-reduction. */
export function totalMemoryMB(model: { vramMB: number; kvCacheMBPer1kTokens: number }, contextTokens: number): number {
  return model.vramMB + (model.kvCacheMBPer1kTokens * contextTokens) / 1000;
}

export const LOCAL_MODELS: LocalModelInfo[] = [
  // === Recommended ===
  {
    id: 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
    group: 'recommended',
    label: 'Hermes 3 8B',
    blurb: 'Tested end-to-end with Partwright. NousResearch function-call training on Llama 3.1 — reliably emits tool calls and handles multi-step geometry tasks. Start here.',
    downloadGB: 4.5,
    vramMB: 4876,
    // Llama 3.1 8B: same architecture as Llama 3 8B
    kvCacheMBPer1kTokens: 128,
    recommendedSystem: 'Discrete GPU with 8+ GB VRAM, or Apple Silicon with 16+ GB unified RAM.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 3,
    promptTier: 'medium',
    contextWindowSize: 32768,
  },

];

export const LOCAL_GROUP_LABELS: Record<LocalSizeGroup, string> = {
  recommended: 'Recommended',
  smaller: 'Smaller — laptop-friendly',
  larger: 'Larger — workstation',
  flagship: 'Flagship — heavy hardware',
  custom: 'Custom — your additions',
};

export const LOCAL_GROUP_HINTS: Record<LocalSizeGroup, string> = {
  recommended: 'Tested end-to-end with Partwright. Use this unless you have a specific reason not to.',
  smaller: 'Fits on most laptops. Less reliable at multi-step tool sequences than the 8B models.',
  larger: 'Needs a discrete GPU or beefy Apple Silicon. Better reasoning, 32K context.',
  flagship: 'Cloud-class capability — but the q3 quant + tight 4K context cap (KV cache cost) leaves some on the table.',
  custom: 'Models you added by URL. WebLLM loads them like any prebuilt — you trust the source.',
};

/** Default local model picked when the user opts in but hasn't chosen yet. */
export const DEFAULT_LOCAL_MODEL: LocalModelId = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

/** Returns true when the browser exposes WebGPU. Local models require it. */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
