// Static registry of WebLLM models we expose to the user. Each entry
// corresponds to a `model_id` in the WebLLM prebuilt config (see
// `node_modules/@mlc-ai/web-llm/lib/index.js` `prebuiltAppConfig.model_list`).
//
// Curation rules:
//   * Every model must be plausibly capable of tool calling for CAD
//     modeling. The Llama 3.2 1B / SmolLM family are dropped — they
//     understand instructions but routinely fail to emit the tool-call
//     markup we need.
//   * For each model we record subjective quality (1-3 stars) for this
//     specific app's use case and the minimum system the model is happy
//     on. These numbers come from local benchmarking + WebLLM's reported
//     vram_required_MB; treat them as guidance, not guarantees.
//   * `promptTier` decides which system prompt the model gets:
//     'slim' (~540 tokens) for small models, 'medium' (~1200 tokens) for
//     models that can take a richer brief. WebLLM caps every prebuilt at
//     a 4096-token context window — the medium prompt is the upper bound
//     of what fits while still leaving room for the conversation and
//     tool docs.

export type LocalModelId =
  | 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
  | 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC'
  | 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC'
  | 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC'
  | 'Qwen3-8B-q4f16_1-MLC'
  | 'Qwen3.5-9B-q4f16_1-MLC'
  | 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC'
  | 'Llama-3.1-70B-Instruct-q3f16_1-MLC'
  | 'Phi-3.5-vision-instruct-q4f16_1-MLC';

/** Coarse grouping shown as section headers in the picker. The `custom`
 *  group is reserved for user-added models from AiSettings.customLocalModels;
 *  no built-in entries live there. */
export type LocalSizeGroup = 'recommended' | 'smaller' | 'larger' | 'flagship' | 'vision' | 'custom';

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
  /** Human-readable system recommendation (RAM/VRAM combination needed). */
  recommendedSystem: string;
  /** Whether the model can see image inputs. */
  supportsVision: boolean;
  /** Whether WebLLM ships this in `functionCallingModelIds`. Models on
   *  that list use the OpenAI native `tools` request shape; the rest
   *  rely on prompt-engineered `<tool_call>` markup. */
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

export const LOCAL_MODELS: LocalModelInfo[] = [
  // === Recommended ===
  {
    id: 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
    group: 'recommended',
    label: 'Hermes 3 8B',
    blurb: 'Fine-tuned for function calling — most reliable agent on this list. The starting point for serious use.',
    downloadGB: 4.5,
    vramMB: 4876,
    recommendedSystem: 'Discrete GPU with 8+ GB VRAM, or Apple Silicon with 16+ GB unified RAM.',
    supportsVision: false,
    officialToolCalling: true,
    qualityStars: 3,
    promptTier: 'medium',
    contextWindowSize: 32768,
  },

  // === Smaller (laptop-friendly) ===
  {
    id: 'Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC',
    group: 'smaller',
    label: 'Qwen 2.5 Coder 3B',
    blurb: 'Tuned on code; better at JSON tool args than general 3B models. Decent for simple shapes.',
    downloadGB: 2.0,
    vramMB: 2400,
    recommendedSystem: '4+ GB VRAM, or any Apple Silicon Mac with 8+ GB.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 2,
    promptTier: 'slim',
    contextWindowSize: 32768,
  },
  {
    id: 'Hermes-3-Llama-3.2-3B-q4f16_1-MLC',
    group: 'smaller',
    label: 'Hermes 3 (Llama 3.2) 3B',
    blurb: 'Hermes function-call training on a 3B base — gets the format right more often than vanilla 3B Llama.',
    downloadGB: 1.9,
    vramMB: 2264,
    recommendedSystem: '4+ GB VRAM, or 8+ GB Apple Silicon.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 2,
    promptTier: 'slim',
    contextWindowSize: 32768,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    group: 'smaller',
    label: 'Llama 3.2 3B',
    blurb: 'General-purpose 3B instruct model. Works but tends to chat instead of acting.',
    downloadGB: 1.9,
    vramMB: 2264,
    recommendedSystem: '4+ GB VRAM, or 8+ GB Apple Silicon.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 1,
    promptTier: 'slim',
    contextWindowSize: 32768,
  },

  // === Larger (workstation-ish) ===
  {
    id: 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC',
    group: 'larger',
    label: 'Qwen 2.5 Coder 7B',
    blurb: 'Code-specialized at 7B; produces cleaner manifold-js than Llama 3.1 8B in practice.',
    downloadGB: 4.7,
    vramMB: 5100,
    recommendedSystem: '12+ GB VRAM, or Apple Silicon with 16+ GB unified RAM.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 2,
    promptTier: 'medium',
    contextWindowSize: 32768,
  },
  {
    id: 'Qwen3-8B-q4f16_1-MLC',
    group: 'larger',
    label: 'Qwen 3 8B',
    blurb: 'Newer Qwen base, strong instruction following. Good middle ground when you want non-Hermes.',
    downloadGB: 5.4,
    vramMB: 5696,
    recommendedSystem: '12+ GB VRAM, or 16+ GB Apple Silicon.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 2,
    promptTier: 'medium',
    contextWindowSize: 32768,
  },
  {
    id: 'Qwen3.5-9B-q4f16_1-MLC',
    group: 'larger',
    label: 'Qwen 3.5 9B',
    blurb: 'Latest Qwen iteration. Modest upgrade over Qwen 3 8B; same prompt-engineered tool path.',
    downloadGB: 6.0,
    vramMB: 6433,
    recommendedSystem: '12+ GB VRAM, or 16+ GB Apple Silicon.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 2,
    promptTier: 'medium',
    contextWindowSize: 32768,
  },

  // === Flagship — needs serious hardware ===
  {
    id: 'Llama-3.1-70B-Instruct-q3f16_1-MLC',
    group: 'flagship',
    label: 'Llama 3.1 70B (q3)',
    blurb: 'Cloud-class quality, but the 3-bit quant trades some quality for fit. Needs heavy hardware to be tolerable.',
    downloadGB: 29,
    vramMB: 31153,
    recommendedSystem: 'Apple Silicon with 64+ GB unified memory, or a desktop GPU with 40+ GB VRAM. Expect slow first-token latency.',
    supportsVision: false,
    officialToolCalling: false,
    qualityStars: 3,
    promptTier: 'medium',
    // Keep 70B at 4K — KV cache for this model is ~1.2 GB per 4K tokens of
    // context, so 16K would add ~5 GB on top of 31 GB weights.
    contextWindowSize: 4096,
  },

  // === Vision ===
  {
    id: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
    group: 'vision',
    label: 'Phi 3.5 Vision 4B',
    blurb: 'Only browser-runnable model that can see images. Use when you want the AI to look at iso views or reference photos.',
    downloadGB: 3.6,
    vramMB: 3952,
    recommendedSystem: '6+ GB VRAM, or 16+ GB Apple Silicon.',
    supportsVision: true,
    officialToolCalling: false,
    qualityStars: 1,
    promptTier: 'slim',
    // Phi 3.5 Vision's compiled WASM (cs2k) is known to be picky about
    // context overrides — leave at the prebuilt default.
    contextWindowSize: 4096,
  },
];

export const LOCAL_GROUP_LABELS: Record<LocalSizeGroup, string> = {
  recommended: 'Recommended',
  smaller: 'Smaller — laptop-friendly',
  larger: 'Larger — workstation',
  flagship: 'Flagship — heavy hardware',
  vision: 'Vision — image input',
  custom: 'Custom — your additions',
};

export const LOCAL_GROUP_HINTS: Record<LocalSizeGroup, string> = {
  recommended: 'Officially fine-tuned for tool calling. Use this unless you have a reason not to.',
  smaller: 'Fits on most laptops. Less reliable at multi-step tool sequences.',
  larger: 'Needs a discrete GPU or beefy Apple Silicon. Better reasoning, still 4K context.',
  flagship: 'Cloud-class capability — but the q3 quant + 4K context cap leaves some on the table.',
  vision: 'Can interpret reference photos and iso-view screenshots; smaller than tool-calling alternatives.',
  custom: 'Models you added by URL. WebLLM loads them like any prebuilt — you trust the source.',
};

/** Default local model picked when the user opts in but hasn't chosen yet.
 *  Hermes 3 8B — the only model with native tool calling. */
export const DEFAULT_LOCAL_MODEL: LocalModelId = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';

/** Returns true when the browser exposes WebGPU. Local models require it. */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
