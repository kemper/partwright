// Shared types for the in-app AI chat. The wire format mirrors what the
// Anthropic SDK accepts for `messages.create` so transcripts can round-trip
// through the API with minimal massaging — but we own this interface so a
// future provider (OpenAI, Gemini, Ollama) can adapt to it without changing
// the storage layer.

export type Provider = 'anthropic';

export type ModelId = 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7';

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
  model: ModelId;
}

export const ITERATION_CAP: Record<ChatToggles['maxIterations'], number> = {
  low: 4,
  medium: 16,
  high: 64,
  infinity: Number.POSITIVE_INFINITY,
};

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
