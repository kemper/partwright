// AI-assisted filament-palette setup: hand one or more photos/screenshots of
// filament (spools, swatch cards, a slicer/AMS color list) to the user's
// configured model and get back a list of {name, hex} colors. Single-shot,
// no tools — the same cross-provider pattern as review.ts. The pure JSON
// parser lives in ../color/palette (parseFilamentColors) so it's unit-tested
// without a browser.

import { streamTurn as anthropicStreamTurn, buildApiMessages } from './anthropic';
import { streamTurn as openaiStreamTurn } from './openai';
import { streamTurn as geminiStreamTurn } from './gemini';
import { streamTurn as customStreamTurn } from './custom';
import { streamLocalTurn, resolveLocalModel } from './local';
import { recordEvent } from './diagnostics';
import { generateId } from '../storage/db';
import { getKey } from './db';
import { loadSettings } from './settings';
import { activeModel } from './types';
import { parseFilamentColors, type FilamentColor } from '../color/palette';
import type { ChatBlock, ChatMessage, ImageSource } from './types';

const FILAMENT_SYSTEM = `You identify 3D-printer filament colors from images.

The user attaches one or more images: photos of filament spools, printed swatch
cards, or screenshots of a slicer / AMS color list. Identify each DISTINCT
filament color shown. Judge the actual filament/material color — ignore the
spool core, packaging, background, on-screen text, and lighting glare.

Return ONLY a JSON object, no prose and no markdown fences:

{
  "filaments": [
    { "name": "<short distinct name, e.g. 'Matte Black' or 'Galaxy Purple'>", "hex": "#RRGGBB" }
  ]
}

Rules:
- "hex" MUST be a 6-digit #RRGGBB sRGB value.
- Give each color a concise, distinct name. If a brand or material is clearly
  legible you may fold it in (e.g. "PLA Silver").
- Merge near-duplicates: if two swatches are essentially the same color, list
  it once.
- Only include colors actually present in the images.
- Return strictly the JSON object. No commentary.`;

/**
 * Send the attached filament images to the active provider/model and return
 * the recognized colors. Resolves the provider, model, and API key from the
 * current AI settings (same selection the chat uses). Throws a user-facing
 * Error on missing key/model, an unusable local model, or an empty result.
 */
export async function analyzeFilamentPhotos(images: ImageSource[]): Promise<FilamentColor[]> {
  if (images.length === 0) throw new Error('Attach at least one filament photo first.');

  const toggles = loadSettings().toggles;
  const provider = toggles.provider;
  const model = activeModel(toggles);
  if (!model) throw new Error('Pick an AI model first in AI settings, then try again.');

  const userText = 'These are images of 3D-printer filament I own. Identify each '
    + 'distinct filament color and return the palette as JSON.';
  const blocks: ChatBlock[] = [
    { type: 'text', text: userText },
    ...images.map((source): ChatBlock => ({ type: 'image', source })),
  ];
  const ephemeral: ChatMessage = {
    id: generateId(),
    sessionId: '__filament__',
    role: 'user',
    blocks,
    createdAt: Date.now(),
    seq: 0,
  };

  const t0 = performance.now();
  let text = '';
  try {
    if (provider === 'anthropic') {
      const key = (await getKey('anthropic'))?.apiKey;
      if (!key) throw new Error('Add an Anthropic API key in AI settings to analyze photos.');
      const r = await anthropicStreamTurn({
        apiKey: key, model, systemPrompt: FILAMENT_SYSTEM, systemSuffix: '',
        apiMessages: buildApiMessages([ephemeral]), tools: [],
      });
      text = r.text;
    } else if (provider === 'openai') {
      const key = (await getKey('openai'))?.apiKey;
      if (!key) throw new Error('Add an OpenAI API key in AI settings to analyze photos.');
      const r = await openaiStreamTurn({
        apiKey: key, model, systemPrompt: FILAMENT_SYSTEM, systemSuffix: '',
        history: [ephemeral], tools: [],
      });
      text = r.text;
    } else if (provider === 'gemini') {
      const key = (await getKey('gemini'))?.apiKey;
      if (!key) throw new Error('Add a Gemini API key in AI settings to analyze photos.');
      const r = await geminiStreamTurn({
        apiKey: key, model, systemPrompt: FILAMENT_SYSTEM, systemSuffix: '',
        history: [ephemeral], tools: [],
      });
      text = r.text;
    } else if (provider === 'custom') {
      const baseUrl = toggles.customBaseUrl;
      if (!baseUrl.trim()) throw new Error('Set the endpoint URL in AI settings → Custom to analyze photos.');
      const key = (await getKey('custom'))?.apiKey ?? '';
      const r = await customStreamTurn({
        apiKey: key, baseUrl, model, systemPrompt: FILAMENT_SYSTEM, systemSuffix: '',
        history: [ephemeral], tools: [],
      });
      text = r.text;
    } else {
      // local — most browser models are text-only; a non-vision one silently
      // drops the image and hallucinates, so refuse up front with guidance.
      let supportsVision = false;
      try { supportsVision = resolveLocalModel(model).supportsVision; } catch { /* unknown model */ }
      if (!supportsVision) {
        throw new Error('This local model can’t see images. Switch to a cloud provider, or pick a Vision local model, then try again.');
      }
      const r = await streamLocalTurn({
        modelId: model, systemPrompt: FILAMENT_SYSTEM, systemSuffix: '',
        history: [ephemeral], tools: [], maxTokens: 2048,
      });
      text = r.text;
    }
  } catch (err) {
    recordEvent({
      provider, model, kind: 'filament',
      durationMs: Math.round(performance.now() - t0),
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      requestSummary: `images=${images.length}`,
    });
    throw err;
  }

  const colors = parseFilamentColors(text);
  recordEvent({
    provider, model, kind: 'filament',
    durationMs: Math.round(performance.now() - t0),
    status: 'ok',
    textPreview: text.slice(0, 200),
    requestSummary: `images=${images.length}, parsed=${colors.length}`,
  });

  if (colors.length === 0) {
    throw new Error('The model didn’t return any recognizable colors. Try a clearer, well-lit photo — or add colors manually.');
  }
  return colors;
}
