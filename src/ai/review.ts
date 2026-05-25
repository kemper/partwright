// Cross-provider review: hand the current session state to a DIFFERENT
// model and ask for feedback. The reviewer sees the same things a human
// would when they open the session — code, viewport snapshot, notes —
// without any tools or follow-up turns. Output lands in the chat as a
// 'review' block AND (optionally) as a [REVIEW from ...] session note
// so the original agent picks it up on the next turn via getSessionContext.

import { streamTurn as anthropicStreamTurn, buildApiMessages } from './anthropic';
import { streamTurn as openaiStreamTurn } from './openai';
import { streamTurn as geminiStreamTurn } from './gemini';
import { streamLocalTurn } from './local';
import { turnCostUsd } from './cost';
import { recordEvent } from './diagnostics';
import { generateId } from '../storage/db';
import { putMessages, getKey } from './db';
import { providerLabel } from './settings';
import { captureIsoViews } from './images';
import type {
  ChatBlock,
  ChatMessage,
  ImageSource,
  Provider,
  TurnUsage,
} from './types';

const REVIEW_SYSTEM = `You are a senior CAD reviewer giving a SECOND OPINION on another
model's work-in-progress inside Partwright, a parametric browser CAD
tool. Be concise and direct. Output plain text (no markdown headings,
no JSON), 4-10 sentences. Cover:

- What looks right vs wrong in the current code or rendered geometry.
- Concrete suggestions the original model can act on next turn (with
  numbers when applicable: dimensions, angles, axes).
- Anything that contradicts the stated user requirements / decisions
  in the session notes.

Do NOT rewrite the code. Do NOT pretend to be the original model. Open
with a one-line verdict ("looks correct", "close, but…", "needs rework
because…") so the user gets the takeaway at a glance.`;

export interface ReviewContext {
  /** Active editor code. */
  code: string;
  /** Editor language label. */
  language: 'manifold-js' | 'scad';
  /** Snapshot of the rendered geometry (4-iso composite by default). */
  snapshot: ImageSource | null;
  /** Stat blob from window.partwright.getGeometryData (already a JSON string). */
  geometryStats: string;
  /** Session notes in order, oldest first. */
  notes: string[];
  /** What the user wants the reviewer to look at. Free text. */
  focus?: string;
}

export interface ReviewRequest {
  provider: Provider;
  model: string;
  /** Optional override; review() looks up the stored key when omitted
   *  for hosted providers, and ignores it for local. */
  apiKey?: string;
  context: ReviewContext;
  sessionId: string;
  /** Set false to skip writing a session note. Defaults to true. */
  promoteToNote?: boolean;
}

export interface ReviewResult {
  text: string;
  usage: TurnUsage;
  costUsd: number;
  message: ChatMessage;
}

export async function runReview(
  req: ReviewRequest,
  onProgress?: (phase: 'capturing' | 'sending' | 'persisting') => void,
): Promise<ReviewResult> {
  const userText = formatReviewPrompt(req.context);
  const blocks: ChatBlock[] = [{ type: 'text', text: userText }];
  if (req.context.snapshot) blocks.push({ type: 'image', source: req.context.snapshot });

  // Single-shot ephemeral history — no tools, no recursion. The review
  // is essentially a one-prompt summarize, but going through streamTurn
  // exercises the same multimodal-vision path each provider uses for a
  // normal chat (so an image-capable model actually looks at the image).
  const ephemeral: ChatMessage = {
    id: generateId(),
    sessionId: req.sessionId,
    role: 'user',
    blocks,
    createdAt: Date.now(),
    seq: 0,
  };

  onProgress?.('sending');
  const t0 = performance.now();

  let text = '';
  let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  try {
    if (req.provider === 'anthropic') {
      const key = req.apiKey ?? (await getKey('anthropic'))?.apiKey;
      if (!key) throw new Error('Anthropic API key required for review.');
      const r = await anthropicStreamTurn({
        apiKey: key,
        model: req.model,
        systemPrompt: REVIEW_SYSTEM,
        systemSuffix: '',
        apiMessages: buildApiMessages([ephemeral]),
        tools: [],
        // No maxTokens override: use each provider's reasoning-aware default
        // (Anthropic 8192, OpenAI 8192, Gemini 32768). A hardcoded 1024 here
        // let a thinking/reasoning reviewer model (Gemini Pro, OpenAI o-series)
        // spend the whole ceiling on hidden reasoning and return an empty review.
      });
      text = r.text;
      usage = r.usage;
    } else if (req.provider === 'openai') {
      const key = req.apiKey ?? (await getKey('openai'))?.apiKey;
      if (!key) throw new Error('OpenAI API key required for review.');
      const r = await openaiStreamTurn({
        apiKey: key,
        model: req.model,
        systemPrompt: REVIEW_SYSTEM,
        systemSuffix: '',
        history: [ephemeral],
        tools: [],
        // See the Anthropic branch: use the provider default so an o-series /
        // gpt-5 reviewer has headroom for hidden reasoning + the answer.
      });
      text = r.text;
      usage = r.usage;
    } else if (req.provider === 'gemini') {
      const key = req.apiKey ?? (await getKey('gemini'))?.apiKey;
      if (!key) throw new Error('Gemini API key required for review.');
      const r = await geminiStreamTurn({
        apiKey: key,
        model: req.model,
        systemPrompt: REVIEW_SYSTEM,
        systemSuffix: '',
        history: [ephemeral],
        tools: [],
        // See the Anthropic branch: Gemini's 32768 default is what keeps a
        // Pro/2.5 thinking reviewer from spending the ceiling on reasoning.
      });
      text = r.text;
      usage = r.usage;
    } else {
      // local — keep an explicit ceiling (local's default is only 768, which
      // can truncate a multi-sentence review), but give the answer headroom.
      const r = await streamLocalTurn({
        modelId: req.model,
        systemPrompt: REVIEW_SYSTEM,
        systemSuffix: '',
        history: [ephemeral],
        tools: [],
        maxTokens: 2048,
      });
      text = r.text;
      usage = r.usage;
    }
  } catch (err) {
    recordEvent({
      provider: req.provider, model: req.model, kind: 'review',
      durationMs: Math.round(performance.now() - t0),
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      requestSummary: `code=${req.context.code.length}ch, notes=${req.context.notes.length}, snapshot=${req.context.snapshot ? 'yes' : 'no'}`,
    });
    throw err;
  }
  recordEvent({
    provider: req.provider, model: req.model, kind: 'review',
    durationMs: Math.round(performance.now() - t0),
    status: 'ok',
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cacheReadInputTokens,
    textPreview: text.slice(0, 200),
    requestSummary: `code=${req.context.code.length}ch, notes=${req.context.notes.length}, snapshot=${req.context.snapshot ? 'yes' : 'no'}`,
  });

  const costUsd = turnCostUsd(req.provider, req.model, usage);

  onProgress?.('persisting');
  const reviewDurationMs = Math.round(performance.now() - t0);
  const reviewMsg: ChatMessage = {
    id: generateId(),
    sessionId: req.sessionId,
    role: 'assistant',
    blocks: [{ type: 'review', provider: req.provider, model: req.model, text: text || '(empty review)' }],
    usage,
    costUsd,
    createdAt: Date.now(),
    durationMs: reviewDurationMs,
    // Reviews insert into the live chat AFTER all current messages.
    // Use Date.now() so the seq sorts late even if the primary agent
    // is still mid-turn (its seq counter is bounded by iter * 2).
    seq: Date.now(),
  };
  await putMessages([reviewMsg]);

  if (req.promoteToNote !== false) {
    await tryWriteSessionNote(req.provider, req.model, text);
  }

  return { text, usage, costUsd, message: reviewMsg };
}

function formatReviewPrompt(ctx: ReviewContext): string {
  const lines: string[] = [];
  lines.push('Please review the current state of this Partwright session.');
  if (ctx.focus && ctx.focus.trim().length > 0) {
    lines.push('');
    lines.push(`Focus: ${ctx.focus.trim()}`);
  }
  lines.push('');
  lines.push(`Editor language: ${ctx.language}`);
  lines.push('');
  lines.push('=== Current code ===');
  lines.push('```' + (ctx.language === 'scad' ? 'scad' : 'js'));
  lines.push(ctx.code);
  lines.push('```');
  lines.push('');
  lines.push('=== Geometry stats (from runtime) ===');
  lines.push(ctx.geometryStats);
  lines.push('');
  if (ctx.notes.length > 0) {
    lines.push('=== Session notes (oldest first) ===');
    for (const n of ctx.notes) lines.push(`- ${n}`);
    lines.push('');
  }
  if (ctx.snapshot) {
    lines.push('=== Snapshot ===');
    lines.push('A 4-iso composite of the current rendered geometry is attached.');
  } else {
    lines.push('(No snapshot — no geometry currently rendered, so reason from code + stats only.)');
  }
  return lines.join('\n');
}

async function tryWriteSessionNote(provider: Provider, model: string, text: string): Promise<void> {
  const w = window as unknown as { partwright?: { addSessionNote?: (t: string) => Promise<unknown> } };
  if (!w.partwright?.addSessionNote) return;
  const oneLine = text.replace(/\s+/g, ' ').trim().slice(0, 600);
  try {
    await w.partwright.addSessionNote(`[REVIEW from ${providerLabel(provider)} / ${model}] ${oneLine}`);
  } catch { /* swallow — review still made it into the chat transcript */ }
}

/** Pull the current code, language, stats, and session notes off the
 *  window.partwright API. Used to populate the preview in the review
 *  modal and the actual payload sent to the reviewer. */
export async function gatherReviewContext(): Promise<ReviewContext> {
  const w = window as unknown as {
    partwright?: {
      getCode?: () => string;
      getActiveLanguage?: () => 'manifold-js' | 'scad';
      getGeometryData?: () => unknown;
      listSessionNotes?: () => Promise<Array<{ text: string }>>;
    };
  };
  const code = w.partwright?.getCode?.() ?? '';
  const language: 'manifold-js' | 'scad' = w.partwright?.getActiveLanguage?.() ?? 'manifold-js';
  const stats = w.partwright?.getGeometryData?.();
  const geometryStats = stats ? JSON.stringify(stats, null, 2) : '(no current geometry)';
  let notes: string[] = [];
  try {
    const raw = await (w.partwright?.listSessionNotes?.() ?? Promise.resolve([]));
    notes = raw.map(n => n.text);
  } catch { /* listSessionNotes may not be available if no session */ }
  const snapshot = await captureIsoViews();
  return { code, language, geometryStats, notes, snapshot };
}
