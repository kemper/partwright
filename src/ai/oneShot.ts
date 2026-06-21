// Shared single-shot (no-tools, no-recursion) turn dispatch across all five
// providers. Both the cross-provider review (review.ts) and the publish-metadata
// generator (publishMetadata.ts) need "send one prompt + optional image, get
// text back" — extracted here so the per-provider branching lives in one place.
//
// Returns the raw text + usage; callers own cost accounting, diagnostics, and
// persistence. Each branch uses the provider's reasoning-aware default maxTokens
// (so a thinking model doesn't spend its ceiling on hidden reasoning and return
// empty), except local which keeps an explicit ceiling since its default (768)
// can truncate a multi-sentence answer.

import { streamTurn as anthropicStreamTurn, buildApiMessages } from './anthropic';
import { streamTurn as openaiStreamTurn } from './openai';
import { streamTurn as geminiStreamTurn } from './gemini';
import { streamTurn as customStreamTurn } from './custom';
import { streamLocalTurn } from './local';
import { getKey } from './db';
import { loadSettings } from './settings';
import type { ChatMessage, Provider, TurnUsage } from './types';

export interface OneShotRequest {
  provider: Provider;
  model: string;
  systemPrompt: string;
  /** Single-message (or short) ephemeral history — no tools are passed. */
  history: ChatMessage[];
  /** Optional key override; looked up from storage for hosted providers when omitted. */
  apiKey?: string;
  /** Explicit ceiling for the local provider (defaults to 2048). */
  localMaxTokens?: number;
}

export interface OneShotResult {
  text: string;
  usage: TurnUsage;
}

export async function streamOneShotTurn(req: OneShotRequest): Promise<OneShotResult> {
  if (req.provider === 'anthropic') {
    const key = req.apiKey ?? (await getKey('anthropic'))?.apiKey;
    if (!key) throw new Error('Anthropic API key required.');
    const r = await anthropicStreamTurn({
      apiKey: key,
      model: req.model,
      systemPrompt: req.systemPrompt,
      systemSuffix: '',
      apiMessages: buildApiMessages(req.history),
      tools: [],
    });
    return { text: r.text, usage: r.usage };
  }
  if (req.provider === 'openai') {
    const key = req.apiKey ?? (await getKey('openai'))?.apiKey;
    if (!key) throw new Error('OpenAI API key required.');
    const r = await openaiStreamTurn({
      apiKey: key,
      model: req.model,
      systemPrompt: req.systemPrompt,
      systemSuffix: '',
      history: req.history,
      tools: [],
    });
    return { text: r.text, usage: r.usage };
  }
  if (req.provider === 'gemini') {
    const key = req.apiKey ?? (await getKey('gemini'))?.apiKey;
    if (!key) throw new Error('Gemini API key required.');
    const r = await geminiStreamTurn({
      apiKey: key,
      model: req.model,
      systemPrompt: req.systemPrompt,
      systemSuffix: '',
      history: req.history,
      tools: [],
    });
    return { text: r.text, usage: r.usage };
  }
  if (req.provider === 'custom') {
    const baseUrl = loadSettings().toggles.customBaseUrl;
    if (!baseUrl.trim()) throw new Error('Custom endpoint URL required. Set it in AI Settings → Custom.');
    const key = req.apiKey ?? (await getKey('custom'))?.apiKey ?? '';
    const r = await customStreamTurn({
      apiKey: key,
      baseUrl,
      model: req.model,
      systemPrompt: req.systemPrompt,
      systemSuffix: '',
      history: req.history,
      tools: [],
    });
    return { text: r.text, usage: r.usage };
  }
  // local
  const r = await streamLocalTurn({
    modelId: req.model,
    systemPrompt: req.systemPrompt,
    systemSuffix: '',
    history: req.history,
    tools: [],
    maxTokens: req.localMaxTokens ?? 2048,
  });
  return { text: r.text, usage: r.usage };
}
