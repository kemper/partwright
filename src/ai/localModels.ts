// Static registry of WebLLM models we expose to the user. Each entry
// corresponds to a `model_id` in the WebLLM prebuilt config (see
// `node_modules/@mlc-ai/web-llm/lib/index.js` `prebuiltAppConfig.model_list`).
//
// We only ship four — one per size tier plus one vision model — so the UI
// stays focused. The download sizes are the unpacked weight size on disk
// (q4f16_1 quantization), which is what users actually pay in bandwidth and
// cache storage.

export type LocalModelId =
  | 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
  | 'Llama-3.2-3B-Instruct-q4f16_1-MLC'
  | 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC'
  | 'Phi-3.5-vision-instruct-q4f16_1-MLC';

export type LocalSizeTier = 'small' | 'medium' | 'large' | 'vision';

export interface LocalModelInfo {
  id: LocalModelId;
  tier: LocalSizeTier;
  label: string;
  /** Short pitch shown next to the radio button. */
  blurb: string;
  /** Approximate download size, GB. Used in the consent step. */
  downloadGB: number;
  /** VRAM the model needs once loaded — from WebLLM's prebuilt config. */
  vramMB: number;
  /** Whether the model can see image inputs. Drives whether we pass image
   *  blocks through or strip them. Only the vision tier is true today. */
  supportsVision: boolean;
  /** Whether WebLLM ships this in `functionCallingModelIds`. Non-flagged
   *  models still get JSON-schema-constrained tool calls via XGrammar; the
   *  flagged ones are explicitly fine-tuned for it. */
  officialToolCalling: boolean;
}

export const LOCAL_MODELS: LocalModelInfo[] = [
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    tier: 'small',
    label: 'Small — Llama 3.2 1B',
    blurb: 'Fastest, runs on most laptops with a GPU. Best for simple shapes and quick code edits.',
    downloadGB: 0.7,
    vramMB: 879,
    supportsVision: false,
    officialToolCalling: false,
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    tier: 'medium',
    label: 'Medium — Llama 3.2 3B',
    blurb: 'Recommended starting point. Strong code reasoning, fits on most modern GPUs.',
    downloadGB: 1.9,
    vramMB: 2264,
    supportsVision: false,
    officialToolCalling: false,
  },
  {
    id: 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC',
    tier: 'large',
    label: 'Large — Hermes 3 8B',
    blurb: 'Fine-tuned for tool calling. Needs a discrete GPU with ~5 GB VRAM.',
    downloadGB: 4.5,
    vramMB: 4876,
    supportsVision: false,
    officialToolCalling: true,
  },
  {
    id: 'Phi-3.5-vision-instruct-q4f16_1-MLC',
    tier: 'vision',
    label: 'Vision — Phi 3.5 Vision 4B',
    blurb: 'Can analyze screenshots of the model. Smaller than Large but adds vision.',
    downloadGB: 3.8,
    vramMB: 3952,
    supportsVision: true,
    officialToolCalling: false,
  },
];

export function findLocalModel(id: LocalModelId): LocalModelInfo {
  const info = LOCAL_MODELS.find(m => m.id === id);
  if (!info) throw new Error(`Unknown local model id: ${id}`);
  return info;
}

/** Default local model picked when the user opts in but hasn't chosen yet. */
export const DEFAULT_LOCAL_MODEL: LocalModelId = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';

/** Returns true when the browser exposes WebGPU. Local models require it. */
export function isWebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}
