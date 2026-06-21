// "Auto-populate with AI" for the publish modal. Reviews the session — code,
// geometry stats, session notes, a 4-iso snapshot, and recent AI chat history —
// and asks the user's ACTIVE provider for a listing title, description, and tags
// to publish to Printables / MakerWorld / Thingiverse / Thangs.
//
// Reuses the one-shot turn dispatch (oneShot.ts) and the context gatherer
// (review.ts). Output is parsed as JSON; the active provider/model is whatever
// drives the chat, so it only works when an AI model is connected.

import { streamOneShotTurn } from './oneShot';
import { gatherReviewContext } from './review';
import { loadSettings } from './settings';
import { getKey, listMessages } from './db';
import { activeModel } from './types';
import { generateId } from '../storage/db';
import { recordEvent } from './diagnostics';
import { parseAiPublishMetadata, type PublishMetadata } from '../publish/publishTargets';
import type { ChatBlock, ChatMessage, Provider } from './types';

export type { PublishMetadata };

const METADATA_SYSTEM = `You write listing metadata for a 3D-printable model so its
designer can publish it to a model-sharing site (Printables, MakerWorld,
Thingiverse, Thangs). You are given the model's code, geometry stats, the
designer's session notes, recent AI-chat history, and a rendered image.

Produce a catchy but accurate listing. Reply with ONLY a JSON object, no prose,
no markdown fences:
{
  "title": "short, descriptive, < 60 chars",
  "description": "2-4 short paragraphs: what it is, notable features, print/usage notes. Plain text, no markdown headings.",
  "tags": ["8-15 lowercase keywords, single or short multi-word, no '#'"]
}

Base everything on what's actually in the model and notes — do not invent
features, dimensions, or materials that aren't supported by the inputs.`;

/** Whether the currently-active AI provider is connected (has a key / endpoint /
 *  local model). Drives the "Auto-populate" button's enabled state. */
export async function isActiveProviderConnected(): Promise<boolean> {
  const { toggles } = loadSettings();
  switch (toggles.provider) {
    case 'anthropic':
    case 'openai':
    case 'gemini':
      return !!(await getKey(toggles.provider));
    case 'custom':
      return toggles.customBaseUrl.trim().length > 0 && toggles.customModel.trim().length > 0;
    case 'local':
      return !!toggles.localModel;
  }
}

/** A compact transcript of the most recent chat turns, for the prompt. */
async function recentChatSummary(sessionId: string, maxMessages = 12): Promise<string> {
  let messages: ChatMessage[] = [];
  try {
    messages = await listMessages(sessionId);
  } catch { return ''; }
  const recent = messages.slice(-maxMessages);
  const lines: string[] = [];
  for (const m of recent) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const text = m.blocks
      .map(b => (b.type === 'text' || b.type === 'review' ? b.text : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) lines.push(`${m.role === 'user' ? 'User' : 'AI'}: ${text.slice(0, 400)}`);
  }
  return lines.join('\n');
}

/**
 * Generate publish metadata from the current session using the active AI
 * provider. Throws if no model is connected or the provider call fails.
 */
export async function generatePublishMetadata(sessionId: string): Promise<PublishMetadata> {
  const { toggles } = loadSettings();
  const provider: Provider = toggles.provider;
  const model = activeModel(toggles);
  if (!model) throw new Error('No AI model selected. Connect one in AI settings first.');

  const ctx = await gatherReviewContext();
  const chat = await recentChatSummary(sessionId);

  const promptLines: string[] = [
    'Write listing metadata for this 3D model.',
    '',
    `Editor language: ${ctx.language}`,
    '',
    '=== Code ===',
    '```' + (ctx.language === 'scad' ? 'scad' : 'js'),
    ctx.code,
    '```',
    '',
    '=== Geometry stats ===',
    ctx.geometryStats,
  ];
  if (ctx.notes.length > 0) {
    promptLines.push('', '=== Session notes (oldest first) ===');
    for (const n of ctx.notes) promptLines.push(`- ${n}`);
  }
  if (chat) {
    promptLines.push('', '=== Recent AI chat (oldest first) ===', chat);
  }
  promptLines.push('', ctx.snapshot
    ? '=== Snapshot ===\nA 4-iso composite of the rendered model is attached.'
    : '(No snapshot — reason from code + stats.)');

  const blocks: ChatBlock[] = [{ type: 'text', text: promptLines.join('\n') }];
  if (ctx.snapshot) blocks.push({ type: 'image', source: ctx.snapshot });

  const ephemeral: ChatMessage = {
    id: generateId(),
    sessionId,
    role: 'user',
    blocks,
    createdAt: Date.now(),
    seq: 0,
  };

  const t0 = performance.now();
  try {
    const { text, usage } = await streamOneShotTurn({
      provider,
      model,
      systemPrompt: METADATA_SYSTEM,
      history: [ephemeral],
    });
    const parsed = parseAiPublishMetadata(text);
    recordEvent({
      provider, model, kind: 'review',
      durationMs: Math.round(performance.now() - t0),
      status: 'ok',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      textPreview: text.slice(0, 200),
      requestSummary: `publish-metadata code=${ctx.code.length}ch notes=${ctx.notes.length} chat=${chat.length}ch`,
    });
    return parsed;
  } catch (err) {
    recordEvent({
      provider, model, kind: 'review',
      durationMs: Math.round(performance.now() - t0),
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      requestSummary: 'publish-metadata',
    });
    throw err;
  }
}
