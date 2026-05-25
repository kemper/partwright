// Shared types for the in-app AI chat. The wire format mirrors what the
// Anthropic SDK accepts for `messages.create` so transcripts can round-trip
// through the API with minimal massaging — but we own this interface so a
// future provider (OpenAI, Gemini, Ollama) can adapt to it without changing
// the storage layer.

import type { LocalModelId } from './localModels';

/** Anthropic = hosted Claude (BYO API key). Local = WebLLM running on the
 *  user's GPU. OpenAI / Gemini = hosted, BYO key. Only one is active per
 *  chat at a time; switching is a UI affordance, not a per-turn decision. */
export type Provider = 'anthropic' | 'local' | 'openai' | 'gemini';

export type AnthropicModelId = 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7';

/** Curated OpenAI model ids the picker offers up front. Stored as a plain
 *  string on ChatToggles so custom ids the user types in the settings
 *  modal still fit. */
export type OpenaiModelId =
  | 'gpt-5.5'
  | 'gpt-5'
  | 'gpt-5-mini'
  | 'gpt-5-nano'
  | 'o3'
  | 'gpt-4.1'
  | 'gpt-4o'
  | 'gpt-4o-mini';

/** Curated Gemini model ids we ship as defaults. `geminiModel` on
 *  ChatToggles is a plain `string`, so newer ids picked via "Load models
 *  from your key" or the custom-id input fit too. */
export type GeminiModelId =
  | 'gemini-3.1-pro-preview'
  | 'gemini-pro-latest'
  | 'gemini-3.5-flash'
  | 'gemini-flash-latest'
  | 'gemini-flash-lite-latest';

/** Either an Anthropic model name or a WebLLM model_id or a hosted-provider
 *  model id. The shape is the same at the type level (a string) so callers
 *  can treat it opaquely. */
export type ModelId = AnthropicModelId | LocalModelId | OpenaiModelId | GeminiModelId;

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
    /** Resolution preset for the agent's verification renders (renderView /
     *  renderViews). Sets the default image size and caps any size the model
     *  asks for, so a turn can't blow the budget on huge images. */
    resolution: 'low' | 'medium' | 'high';
    /** Default angle set for renderViews when the model omits one. 'auto'
     *  picks 2-3 by shape, 'tri' = 3 (front/top/iso), 'all' = 4. More angles
     *  cost more image tokens. */
    angles: 'auto' | 'tri' | 'all';
  };
  scope: {
    /** Allow the model to call run/runAndSave (+ runIsolated). */
    runCode: boolean;
    /** Allow the model to call saveVersion / forkVersion. */
    saveVersions: boolean;
    /** Allow the model to call paint helpers. */
    paintFaces: boolean;
    /** Allow the model to call addSessionNote. OFF saves a tool round-trip
     *  per note — the chat transcript already records the reasoning. */
    sessionNotes: boolean;
  };
  /** Number of times the loop will silently feed an error back to the model
   *  before surfacing it. 0/1/3. */
  autoRetry: 0 | 1 | 3;
  /** Maximum number of agent-loop iterations (tool round-trips) per user
   *  turn. The agent stops with a "stopped at cap" banner if it would
   *  exceed this. 'low'=4, 'medium'=16, 'high'=32, 'ultra'=64,
   *  'infinity'=unlimited. */
  maxIterations: 'low' | 'medium' | 'high' | 'ultra' | 'infinity';
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
  /** Extended-thinking / reasoning level for the active hosted provider.
   *  Maps per-provider to Anthropic `budget_tokens`, Gemini `thinkingBudget`
   *  (+ `includeThoughts`), and OpenAI `reasoning_effort`. 'off' sends no
   *  thinking request at all, so it reproduces the pre-feature behavior
   *  byte-for-byte — the control is opt-in. No effect on the local provider
   *  (WebLLM models do their own thing and we strip `<think>` blocks). */
  thinking: 'off' | 'low' | 'medium' | 'high';
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
  /** OpenAI model id. Plain string so the user can type a custom id (e.g.
   *  a dated snapshot) and have it stick across provider switches. */
  openaiModel: string;
  /** Google Gemini model id. Same custom-id story as OpenAI. */
  geminiModel: string;
}

/** Source of truth for the iteration-cap dropdown. The toggle pill,
 *  the agent loop, and the per-turn system suffix all derive from this
 *  single record — add/rename a tier here and the three call sites
 *  pick it up automatically. */
export const MAX_ITERATIONS: Record<ChatToggles['maxIterations'], { value: number; label: string; promptLabel: string; hint: string }> = {
  low:      { value: 4,  label: 'Low (4)',  promptLabel: '4',         hint: 'Short turns. Useful when the model wanders.' },
  medium:   { value: 16, label: 'Med (16)', promptLabel: '16',        hint: 'Comfortable for most paint workflows.' },
  high:     { value: 32, label: 'High (32)', promptLabel: '32',       hint: 'Default. Headroom for multi-step builds and verification.' },
  ultra:    { value: 64, label: 'Ultra (64)', promptLabel: '64',      hint: 'Long autonomous runs. Watch the cost meter.' },
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

/** Source of truth for the verification-render resolution dropdown. `value`
 *  is the square pixel size used for the agent's renderView/renderViews output
 *  — both the default when the model omits a size and the cap applied to any
 *  size it requests. Same pattern as MAX_ITERATIONS / MAX_SPEND. */
export const RENDER_RESOLUTION: Record<ChatToggles['vision']['resolution'], { value: number; label: string; promptLabel: string; hint: string }> = {
  low:    { value: 256, label: 'Low (256)',  promptLabel: '256px', hint: 'Smallest verification images. Cheapest vision spend; fine detail can be hard to read.' },
  medium: { value: 384, label: 'Med (384)',  promptLabel: '384px', hint: 'Default. Balances clarity against image-token cost.' },
  high:   { value: 512, label: 'High (512)', promptLabel: '512px', hint: 'Sharpest verification images. Best for fine detail; costs the most image tokens.' },
};

/** Pixel-size lookup derived from RENDER_RESOLUTION so the numbers can't drift
 *  from the dropdown labels. */
export const RENDER_RESOLUTION_PX: Record<ChatToggles['vision']['resolution'], number> =
  Object.fromEntries(Object.entries(RENDER_RESOLUTION).map(([k, v]) => [k, v.value])) as Record<ChatToggles['vision']['resolution'], number>;

/** Source of truth for the thinking-level dropdown. The pill, the
 *  per-provider request builders, and the per-turn suffix all read from
 *  this single record. The concrete token budgets / effort levels each
 *  level maps to are provider-specific and live next to each provider's
 *  wire format (see `thinkingBudget()` in anthropic.ts / gemini.ts and
 *  `reasoningEffort()` in openai.ts). */
export const THINKING_LEVELS: Record<ChatToggles['thinking'], { label: string; promptLabel: string; hint: string }> = {
  off:    { label: 'Off',  promptLabel: 'off',    hint: 'No extended reasoning. Lowest cost + latency. Reproduces the pre-feature behavior exactly.' },
  low:    { label: 'Low',  promptLabel: 'low',    hint: 'A short think before acting. Good for routine edits where a little planning helps.' },
  medium: { label: 'Med',  promptLabel: 'medium', hint: 'Balanced reasoning for multi-step geometry, assemblies, and tricky paint selectors.' },
  high:   { label: 'High', promptLabel: 'high',   hint: 'Deep reasoning for the hardest spatial problems. Costs the most output tokens.' },
};

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
  /** Anthropic extended-thinking blocks captured verbatim (with their
   *  signatures) so the agent's tool-use loop can replay them on the next
   *  request. The Anthropic API requires this when thinking is combined with
   *  tools: an assistant turn that contains a `tool_use` block must be
   *  preceded by its `thinking` block, signature intact, or the next request
   *  400s. Only the Anthropic request builder reads this; other providers
   *  ignore it (Gemini's continuity rides on `thoughtSignature` on the tool
   *  call; OpenAI hides its reasoning entirely). Display is driven separately
   *  by the `'thinking'` ChatBlock. */
  thinkingBlocks?: ThinkingBlockData[];
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
   *  out (e.g. the model crashed, a provider 4xx/5xx). Rendered with a red
   *  border so it stands out from a normal reply, and offers a Retry button
   *  that re-sends the last user message. Not persisted to IndexedDB. */
  errored?: boolean;
  /** Marks a synthetic assistant message representing a turn that auto-stopped
   *  early but is resumable — it hit the iteration cap, the session spend cap,
   *  a max_tokens truncation, a refusal, or ended without a final message.
   *  Rendered as a distinct amber notice with a "Keep going" button that
   *  continues the agent loop from the existing history (no new user prompt).
   *  Not persisted to IndexedDB. */
  stopNotice?: { reason: TurnOutcomeReason; detail?: string; iterations: number };
  /** Wall-clock milliseconds for this single model request/response cycle. */
  durationMs?: number;
  /** Cumulative model time in milliseconds across all API calls since the
   *  user triggered this turn (resets each time the user sends a message). */
  turnElapsedMs?: number;
}

export type ChatBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  /** The model's reasoning / thought summary for a turn (Gemini 3 thinking
   *  models' `thought` parts, or Anthropic extended-thinking text when the
   *  Thinking pill is on). Rendered as a collapsed expand/contract box in the
   *  panel — kept out of the main answer bubble so verbose chains of thought
   *  don't bury the reply. This block is display-only and is NEVER replayed
   *  as model text by any request builder: re-feeding the prose wastes tokens.
   *  Cross-turn continuity, where a provider needs it, rides on a separate
   *  signed payload — `thoughtSignature` on the tool call for Gemini, and the
   *  `ChatMessage.thinkingBlocks` array for Anthropic. */
  | { type: 'thinking'; text: string }
  /** A review produced by an alternate provider via the Review feature.
   *  Rendered with a distinct bubble in the panel; serialized as plain
   *  prefixed text when sent to any provider on the next turn (none have
   *  a native concept for "feedback from another model"). */
  | { type: 'review'; provider: Provider; model: string; text: string };

/** Anthropic extended-thinking blocks captured verbatim for replay during
 *  tool use. Mirrors the SDK's `ThinkingBlock` / `RedactedThinkingBlock`
 *  shapes (kept as a local type so this module stays SDK-agnostic).
 *  `redacted_thinking` blocks have no readable text — they're opaque
 *  encrypted reasoning the API still requires echoed back. */
export type ThinkingBlockData =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };

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
  /** Gemini 3+ attaches an opaque `thoughtSignature` to each functionCall
   *  part and REQUIRES it to be echoed back on the next request — omitting
   *  it returns a 400 ("Function call is missing a thought_signature").
   *  Captured on parse, replayed when rebuilding Gemini request contents.
   *  Other providers ignore this field. */
  thoughtSignature?: string;
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
  switch (toggles.provider) {
    case 'anthropic': return toggles.anthropicModel;
    case 'openai': return toggles.openaiModel;
    case 'gemini': return toggles.geminiModel;
    case 'local': return toggles.localModel;
  }
}
