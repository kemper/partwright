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
  /** Which backend the chat is talking to right now. */
  provider: Provider;
  /** Anthropic model for cloud chats. Always present so the user can switch
   *  back to Anthropic without re-picking a model. */
  anthropicModel: AnthropicModelId;
  /** WebLLM model for local chats. Present from the first time the user
   *  picks one in the local-model modal. */
  localModel: LocalModelId | null;
}

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
export function activeModel(toggles: ChatToggles): ModelId | null {
  if (toggles.provider === 'anthropic') return toggles.anthropicModel;
  return toggles.localModel;
}
