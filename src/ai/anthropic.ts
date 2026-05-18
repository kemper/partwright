// Anthropic SDK wrapper. Owns the browser-side client (with
// dangerouslyAllowBrowser=true), the request shape, and streaming. The
// agent loop in chatLoop.ts calls into this module — it does not import the
// Anthropic SDK directly so the provider can be swapped out later.

import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatBlock,
  ChatMessage,
  ImageSource,
  ModelId,
  PersistedToolCall,
  PersistedToolResult,
  TurnUsage,
} from './types';
import type { ToolDefinition } from './tools';

let cachedClient: Anthropic | null = null;
let cachedKey: string | null = null;

function getClient(apiKey: string): Anthropic {
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  cachedClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  cachedKey = apiKey;
  return cachedClient;
}

/** Drop the cached client. Called on disconnect so the next connect rebuilds
 *  with the new key. */
export function resetClient(): void {
  cachedClient = null;
  cachedKey = null;
}

/** Validate a key by issuing the cheapest possible request. Returns null on
 *  success or an error message. We intentionally hit /v1/messages (not
 *  /v1/models) so we exercise the same code path the chat will use — auth,
 *  CORS, and beta-header handling. */
export async function validateKey(apiKey: string): Promise<string | null> {
  try {
    const client = getClient(apiKey);
    await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    });
    return null;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return 'Invalid API key.';
    }
    if (err instanceof Anthropic.APIError) {
      return `${err.status ?? 'API'}: ${err.message}`;
    }
    return err instanceof Error ? err.message : String(err);
  }
}

export interface StreamCallbacks {
  /** Called for each text delta as it arrives. Use to incrementally update
   *  the in-progress assistant bubble. */
  onText?: (delta: string) => void;
  /** Called once the model has decided to call a tool — input may still be
   *  streaming, so don't act on this yet. */
  onToolStart?: (toolUseId: string, toolName: string) => void;
}

export interface StreamResult {
  /** The model's text response for this turn (concatenation of text blocks). */
  text: string;
  /** Tool calls the model wants executed. */
  toolCalls: PersistedToolCall[];
  /** Why the model stopped: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | etc. */
  stopReason: string;
  /** Token usage attributed to this single API call. */
  usage: TurnUsage;
  /** Raw assistant content blocks — needed verbatim on the next request. */
  rawAssistantBlocks: Anthropic.ContentBlock[];
}

export interface RequestSpec {
  apiKey: string;
  model: ModelId;
  systemPrompt: string;
  /** Per-toggle suffix appended after the cached system prompt. Kept on a
   *  separate cache breakpoint so it doesn't poison the main cache. */
  systemSuffix: string;
  /** Full prior conversation, in API format (already includes any tool
   *  results). */
  apiMessages: Anthropic.MessageParam[];
  tools: ToolDefinition[];
  /** Hard ceiling on output tokens for this turn. We default to 8K — large
   *  enough for verbose reasoning + a tool call, small enough to not hit
   *  HTTP timeouts on browsers. */
  maxTokens?: number;
}

export async function streamTurn(
  spec: RequestSpec,
  callbacks: StreamCallbacks = {},
  signal?: AbortSignal,
): Promise<StreamResult> {
  const client = getClient(spec.apiKey);
  const max_tokens = spec.maxTokens ?? 8192;

  // System is sent as an array of blocks so we can attach cache_control to
  // the large stable prefix (the full ai.md body) while leaving the small
  // toggle-aware suffix uncached. See shared/prompt-caching.md for the
  // prefix-match invariant.
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: spec.systemPrompt, cache_control: { type: 'ephemeral' } },
  ];
  if (spec.systemSuffix.trim().length > 0) {
    system.push({ type: 'text', text: spec.systemSuffix });
  }

  // Cache the tool list at the last entry. The Anthropic API treats everything
  // up to and including the cache_control marker as one cacheable prefix, so
  // a single marker on the last tool covers the entire list. The cache
  // invalidates automatically whenever the list changes (e.g. toggles flip a
  // tool on/off), so stale cache hits are not a concern.
  const tools: Anthropic.Tool[] = spec.tools.map((t, i, arr) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    ...(i === arr.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));

  const stream = client.messages.stream({
    model: spec.model,
    max_tokens,
    system,
    tools,
    messages: spec.apiMessages,
  });

  // Mirror text deltas into a local buffer so we still have the partial
  // response if the stream is aborted before finalMessage() resolves.
  let collectedText = '';
  stream.on('text', delta => {
    collectedText += delta;
    callbacks.onText?.(delta);
  });

  // Track tool_use blocks as they start so the UI can render a "calling X..."
  // bubble even before the input is fully streamed.
  if (callbacks.onToolStart) {
    stream.on('streamEvent', event => {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        callbacks.onToolStart!(event.content_block.id, event.content_block.name);
      }
    });
  }

  // Tear down the stream when the caller aborts. The SDK exposes both
  // stream.abort() and the underlying AbortController via stream.controller;
  // abort() is the public API and works across SDK versions.
  const abortListener = () => { try { stream.abort(); } catch { /* already done */ } };
  if (signal) {
    if (signal.aborted) abortListener();
    else signal.addEventListener('abort', abortListener);
  }

  try {
    const finalMessage = await stream.finalMessage();
    return collectResult(finalMessage);
  } catch (err) {
    if (signal?.aborted) {
      // Abort race: return what we collected. Tool calls are dropped
      // because a tool_use block that streamed only partial input cannot
      // be a valid request to the model on the next turn — the parser
      // would reject it. The partial text stays so the user can see how
      // far the model had gotten.
      const partialBlocks: Anthropic.ContentBlock[] = collectedText.length > 0
        ? [{ type: 'text', text: collectedText, citations: null }]
        : [];
      return {
        text: collectedText,
        toolCalls: [],
        stopReason: 'aborted',
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        rawAssistantBlocks: partialBlocks,
      };
    }
    throw err;
  } finally {
    if (signal) signal.removeEventListener('abort', abortListener);
  }
}

function collectResult(message: Anthropic.Message): StreamResult {
  let text = '';
  const toolCalls: PersistedToolCall[] = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        // The SDK gives us the parsed object — never raw-string match.
        input: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }
  const usage: TurnUsage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
  };
  return {
    text,
    toolCalls,
    stopReason: message.stop_reason ?? 'unknown',
    usage,
    rawAssistantBlocks: message.content,
  };
}

/** Convert our persisted ChatMessage history into the Anthropic message
 *  array shape. Tool calls and tool results need to interleave properly:
 *  an assistant turn that called tools becomes a single message containing
 *  text + tool_use blocks; the user reply containing tool_result blocks
 *  follows immediately. */
export function buildApiMessages(history: ChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const msg of history) {
    if (msg.role === 'user') {
      const content = userBlocksToApi(msg.blocks, msg.toolResults ?? []);
      if (content.length > 0) out.push({ role: 'user', content });
    } else {
      const content = assistantBlocksToApi(msg.blocks, msg.toolCalls ?? []);
      if (content.length > 0) out.push({ role: 'assistant', content });
    }
  }
  return sanitizeToolUse(out);
}

/** Repair dangling tool_use/tool_result invariant violations before the
 *  messages array is sent to the API. When a turn is aborted or stalls
 *  mid-tool-call, the history can contain an assistant message with
 *  tool_use blocks that has no matching tool_result in the next message —
 *  the API rejects this with a 400.
 *
 *  Two cases:
 *  1. Orphaned tool_use at the tail (no following user message at all) —
 *     strip the assistant message entirely so the conversation ends cleanly
 *     on the last complete user message.
 *  2. Orphaned tool_use mid-conversation (next message is a user message
 *     that doesn't carry the matching tool_results) — inject synthetic
 *     tool_result blocks marked is_error so the invariant is satisfied and
 *     the model understands those tools didn't complete. */
function sanitizeToolUse(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;

    const content = msg.content as Anthropic.ContentBlockParam[];
    const toolUseIds = content
      .filter(b => b.type === 'tool_use')
      .map(b => (b as { type: 'tool_use'; id: string }).id);
    if (toolUseIds.length === 0) continue;

    const next = messages[i + 1];

    if (!next) {
      // Trailing assistant message with unexecuted tool calls — strip it so
      // the conversation ends on a user message the model can respond to.
      messages.splice(i, 1);
      i--;
      continue;
    }

    const nextContent = (Array.isArray(next.content) ? next.content : []) as Anthropic.ContentBlockParam[];
    const coveredIds = new Set(
      nextContent
        .filter(b => b.type === 'tool_result')
        .map(b => (b as { type: 'tool_result'; tool_use_id: string }).tool_use_id)
    );
    const missing = toolUseIds.filter(id => !coveredIds.has(id));
    if (missing.length === 0) continue;

    // Inject synthetic results for the missing IDs, prepended so tool_results
    // appear before any user text (required by the API).
    const synthetic: Anthropic.ContentBlockParam[] = missing.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: 'Tool call was interrupted and did not complete.',
      is_error: true,
    }));

    if (next.role === 'user' && Array.isArray(next.content)) {
      (next.content as Anthropic.ContentBlockParam[]).unshift(...synthetic);
    } else {
      messages.splice(i + 1, 0, { role: 'user', content: synthetic });
      i++;
    }
  }
  return messages;
}

function userBlocksToApi(blocks: ChatBlock[], toolResults: PersistedToolResult[]): Anthropic.ContentBlockParam[] {
  // Tool results MUST come first per the API rules when a user turn carries
  // them — and an assistant tool_use block must be answered before any new
  // user text in that same turn.
  const out: Anthropic.ContentBlockParam[] = [];
  for (const r of toolResults) {
    // When the tool returned an image (renderView), we pass array content
    // with a short text block + the image block. The model treats this
    // exactly like a multimodal user message: vision can interpret the
    // pixels, and the text gives the result context (e.g. the camera
    // parameters used).
    if (r.image) {
      out.push({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: [
          { type: 'text', text: r.content },
          imageBlockToApi(r.image),
        ],
        is_error: r.isError,
      });
    } else {
      out.push({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: r.content,
        is_error: r.isError,
      });
    }
  }
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text.trim().length > 0) out.push({ type: 'text', text: b.text });
    } else if (b.type === 'image') {
      out.push(imageBlockToApi(b.source));
    }
  }
  return out;
}

function assistantBlocksToApi(blocks: ChatBlock[], toolCalls: PersistedToolCall[]): Anthropic.ContentBlockParam[] {
  const out: Anthropic.ContentBlockParam[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text.length > 0) out.push({ type: 'text', text: b.text });
  }
  for (const tc of toolCalls) {
    out.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
  }
  return out;
}

function imageBlockToApi(source: ImageSource): Anthropic.ImageBlockParam {
  return {
    type: 'image',
    source: { type: 'base64', media_type: source.mediaType, data: source.data },
  };
}

/** Run a single non-streamed message — used by manual compaction (fast,
 *  cheap, on Haiku) where we just want the summary text. */
export async function summarize(
  apiKey: string,
  model: ModelId,
  system: string,
  user: string,
  maxTokens = 4096,
): Promise<{ text: string; usage: TurnUsage }> {
  const client = getClient(apiKey);
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
  return {
    text,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

export { Anthropic };
