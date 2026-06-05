// Gemini vision → text "build spec". Used by the Self-Modeling Studio to turn a
// photo into a structured, modelable recipe that a CAD-modeling AI follows —
// splitting the hard "perceive AND build" task into perception (here) and
// construction (the modeling AI). Hand-rolled fetch against the same v1beta
// generativelanguage REST API as src/ai/gemini.ts. Pure prompt/response helpers
// unit-test without a network.

import type { InlineImage } from './geminiImage';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export type SpecStyle = 'stylized' | 'lowpoly' | 'realistic';

/** The analysis instruction: produce a quantitative, modelable build spec, not
 *  a mood/photography description. Sizes are RELATIVE to head dimensions so the
 *  modeler can scale freely. */
export function buildSpecPrompt(style: SpecStyle): string {
  const aim = style === 'lowpoly'
    ? 'a clean LOW-POLY bust (bold simplified faceted forms)'
    : style === 'realistic'
      ? 'a realistic-attempt bust'
      : 'a clean STYLIZED character bust';
  return [
    `You are a 3D modeling director. From the attached photo(s) of one person, write a precise, numbered BUILD SPEC that a 3D modeler will follow to make ${aim} (head, neck, and shoulders).`,
    'Describe ONLY modelable geometry — no mood, lighting, or photography notes. Give sizes and positions RELATIVE to head width/height (e.g. "nose projects ~0.12× head-width", "eyes at 45% of head height, ~0.3× head-width apart") so the modeler can scale freely.',
    'Cover, in this order:',
    '1. Overall head shape + proportions (height:width ratio, jaw shape, cheeks, chin).',
    '2. Hair mass (shape, volume, where it sits) and beard/facial hair (coverage area + length), if any.',
    '3. Any hat / glasses / accessories — describe each as simple primitives and give its EXACT placement (e.g. "baseball cap = dome + forward flat brim, dome sits at the brow line, never over the eyes").',
    '4. Facial features: brow, nose (shape + projection), eyes (height, spacing, size), mouth/lips (height, width).',
    '5. Neck + shoulders (width relative to head, slope).',
    '6. Colours per region — skin, hair, beard, hat, clothing — as plain colour names or hex.',
    'Be concrete and quantitative. Keep it under ~250 words. Output ONLY the spec (no preamble).',
  ].join('\n');
}

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Extract the spec text from a generateContent response, or throw with the
 *  most useful diagnostic. */
export function parseSpecResponse(json: GenerateContentResponse): string {
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Blocked by the model (${json.promptFeedback.blockReason}).`);
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map(p => p.text).filter((t): t is string => typeof t === 'string').join('').trim();
  if (!text) {
    const reason = json.candidates?.[0]?.finishReason;
    throw new Error(`The model returned no spec text${reason ? ` (finish reason: ${reason})` : ''}.`);
  }
  return text;
}

/** Build the generateContent request body: the analysis prompt followed by the
 *  reference image(s). */
export function buildSpecRequest(images: InlineImage[], prompt: string): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        ...images.map(img => ({ inlineData: { mimeType: img.mediaType, data: img.data } })),
      ],
    }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };
}

/** Analyze the photo(s) into a build spec (plain text). */
export async function analyzeImageToSpec(args: {
  apiKey: string;
  model: string;
  images: InlineImage[];
  style: SpecStyle;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/models/${encodeURIComponent(args.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify(buildSpecRequest(args.images, buildSpecPrompt(args.style))),
    signal: args.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200) || res.statusText}`);
  }
  return parseSpecResponse(await res.json());
}
