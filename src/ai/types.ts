// Shared types for the in-app AI chat. The wire format mirrors what the
// Anthropic SDK accepts for `messages.create` so transcripts can round-trip
// through the API with minimal massaging — but we own this interface so a
// future provider (OpenAI, Gemini, Ollama) can adapt to it without changing
// the storage layer.

import type { LocalModelId } from './localModels';

/** Anthropic = hosted Claude (BYO API key). Local = WebLLM running on the
 *  user's GPU. Only one is active per chat at a time; switching is a UI
 *  affordance, not a per-turn decision. */
export type Provider = 'anthropic' | 'local';

export type AnthropicModelId = 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7';

/** Either an Anthropic model name or a WebLLM model_id. The shape is the
 *  same at the type level (a string) so callers can treat it opaquely. */
export type ModelId = AnthropicModelId | LocalModelId;

/** Named bundles of toggle settings the user can flip between with a
 *  single click. 'custom' means none of the named bundles match — the
 *  user has tweaked individual toggles. */
export type Preset = 'minimal' | 'standard' | 'full' | 'custom';

/** Per-session knobs the user can flip in the toggle strip above the chat
 *  input. These directly shape the request payload (image blocks, tool list,
 *  system-prompt suffix). */
export interface ChatToggles {
  vision: {
    /** Send a snapshot of the 4 iso views with each turn. */
    views: boolean;
  };
  scope: {
    /** Allow the model to call run/runAndSave (+ runIsolated). */
    runCode: boolean;
    /** Allow the model to call saveVersion / forkVersion. */
    saveVersions: boolean;
    /** Allow the model to call paint helpers. */
    paintFaces: boolean;
  };
  /** Number of times the loop will silently feed an error back to the model
   *  before surfacing it. 0/1/3. */
  autoRetry: 0 | 1 | 3;
  /** Maximum number of agent-loop iterations (tool round-trips) per user
   *  turn. The agent stops with a "stopped at cap" banner if it would
   *  exceed this. 'low'=4, 'medium'=16, 'high'=64, 'infinity'=unlimited. */
  maxIterations: 'low' | 'medium' | 'high' | 'infinity';
  /** Hard cap on total USD spent in this session. Sums input + output +
   *  cache read/write across every iteration of every turn so far.
   *  Enforced two ways: the active turn stops with a "stopped at spend
   *  cap" banner when this iteration would push the session total over,
   *  and the panel blocks further sends once the cap has been reached
   *  until the user raises it. Both this and maxIterations apply —
   *  whichever trips first stops the turn. 'infinity' disables the cap.
   *  Local turns are billed at $0, so the cap only matters when the
   *  active provider is Anthropic. */
  maxSpend: 'cheap' | 'low' | 'medium' | 'medHigh' | 'high' | 'veryHigh' | 'infinity';
  /** Which backend the chat is talking to right now. */
  provider: Provider;
  /** Anthropic model for cloud chats. Always present so the user can switch
   *  back to Anthropic without re-picking a model. */
  anthropicModel: AnthropicModelId;
  /** WebLLM model for local chats. Stored as a plain string so user-added
   *  custom model ids (which aren't in the curated `LocalModelId` union)
   *  fit too. Present from the first time the user picks one in the
   *  local-model modal. */
  localModel: string | null;
}

/** Source of truth for the iteration-cap dropdown. The toggle pill,
 *  the agent loop, and the per-turn system suffix all derive from this
 *  single record — add/rename a tier here and the three call sites
 *  pick it up automatically. */
export const MAX_ITERATIONS: Record<ChatToggles['maxIterations'], { value: number; label: string; promptLabel: string; hint: string }> = {
  low:      { value: 4,  label: 'Low (4)',  promptLabel: '4',         hint: 'Short turns. Useful when the model wanders.' },
  medium:   { value: 16, label: 'Med (16)', promptLabel: '16',        hint: 'Default. Comfortable for most paint workflows.' },
  high:     { value: 64, label: 'High (64)', promptLabel: '64',       hint: 'Long autonomous runs. Watch the cost meter.' },
  infinity: { value: Number.POSITIVE_INFINITY, label: '∞', promptLabel: 'unlimited', hint: 'Unlimited. Only stops on completion / error / your Stop click.' },
};

/** Source of truth for the spend-cap dropdown. Same pattern as
 *  MAX_ITERATIONS. */
export const MAX_SPEND: Record<ChatToggles['maxSpend'], { value: number; label: string; promptLabel: string; hint: string }> = {
  cheap:    { value: 0.10,  label: '$0.10', promptLabel: '$0.10',     hint: 'Tight session budget. Pairs well with Haiku and short turns.' },
  low:      { value: 0.50,  label: '$0.50', promptLabel: '$0.50',     hint: 'Safety net for casual iteration.' },
  medium:   { value: 2.00,  label: '$2',    promptLabel: '$2',        hint: 'Default. Comfortable for a Sonnet session with a few vision calls.' },
  medHigh:  { value: 5.00,  label: '$5',    promptLabel: '$5',        hint: 'Multi-turn Sonnet session with steady vision verification.' },
  high:     { value: 10.00, label: '$10',   promptLabel: '$10',       hint: 'Long autonomous runs on Opus, lots of vision verification.' },
  veryHigh: { value: 20.00, label: '$20',   promptLabel: '$20',       hint: 'Marathon Opus sessions. Watch the cost meter.' },
  infinity: { value: Number.POSITIVE_INFINITY, label: '∞', promptLabel: 'unlimited', hint: 'No budget cap. The model can spend whatever it wants.' },
};

/** Cap value lookups — derived from MAX_ITERATIONS / MAX_SPEND so the
 *  numbers can never drift from the dropdown labels. */
export const ITERATION_CAP: Record<ChatToggles['maxIterations'], number> =
  Object.fromEntries(Object.entries(MAX_ITERATIONS).map(([k, v]) => [k, v.value])) as Record<ChatToggles['maxIterations'], number>;
export const SPEND_CAP_USD: Record<ChatToggles['maxSpend'], number> =
  Object.fromEntries(Object.entries(MAX_SPEND).map(([k, v]) => [k, v.value])) as Record<ChatToggles['maxSpend'], number>;

/** Outcome category the agent loop reports back to the UI. Single
 *  source of truth — chatLoop produces these, aiPanel renders them. */
export type TurnOutcomeReason =
  | 'end_turn'
  | 'empty_final'
  | 'iteration_cap'
  | 'spend_cap'
  | 'max_tokens'
  | 'refusal'
  | 'aborted'
  | 'error'
  | 'other';

/** Persisted per-message record. One row per chat message in IndexedDB. */
export interface ChatMessage {
  id: string;
  /** Session this chat belongs to. `'__global__'` when no session is open. */
  sessionId: string;
  role: 'user' | 'assistant';
  /** Free-form blocks. We store a normalized array so multimodal user turns
   *  (text + images) and tool-using assistant turns survive a refresh. */
  blocks: ChatBlock[];
  /** Tool calls emitted by the model on this turn (assistant only). */
  toolCalls?: PersistedToolCall[];
  /** Tool results posted back to the model on this turn (user only —
   *  the next turn's user message carries the previous turn's results). */
  toolResults?: PersistedToolResult[];
  /** Token usage attributed to this turn (assistant only). */
  usage?: TurnUsage;
  /** Estimated USD cost for this turn (assistant only). */
  costUsd?: number;
  createdAt: number;
  /** Sequence ordinal — monotonically increases per session. Restored
   *  ordering uses this rather than createdAt to avoid clock-skew jitter. */
  seq: number;
  /** When the message was synthesized by a compaction summary. */
  compacted?: boolean;
  /** When the user hit Stop mid-stream and we preserved the partial. */
  aborted?: boolean;
  /** Marks a synthetic assistant message representing a turn that errored
   *  out (e.g. the model crashed or hit the iteration cap). Rendered with
   *  a red border so it stands out from a normal reply, and offers a
   *  Retry button next to it. Not persisted to IndexedDB. */
  errored?: boolean;
}

export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource };

export interface ImageSource {
  /** base64-encoded PNG/JPEG bytes (no data: prefix). */
  data: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  /** Caller-supplied label shown to the user above the chip (e.g. "iso views"). */
  label?: string;
}

export interface PersistedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface PersistedToolResult {
  toolUseId: string;
  /** Either a JSON-stringified value the executor returned, or the raw error
   *  message when `isError`. We don't store binary blobs in chat results. */
  content: string;
  isError?: boolean;
  /** Optional image returned by the tool (e.g. renderView snapshots). Sent
   *  to the model as a multimodal content block AND rendered inline in the
   *  panel so the user sees what the agent saw. */
  image?: ImageSource;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface KeyRecord {
  provider: Provider;
  apiKey: string;
  createdAt: number;
  lastUsed: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

/** Returns the active model id given a settings object. Centralized so the
 *  cost meter, the request builder, and the toolbar chip all agree on which
 *  model is in play for the next turn. */
export function activeModel(toggles: ChatToggles): ModelId | string | null {
  if (toggles.provider === 'anthropic') return toggles.anthropicModel;
  return toggles.localModel;
}
