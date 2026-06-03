// Gemini image generation ("nano banana" family) — used by the Self-Modeling
// Studio to re-render a source photo from alternate angles. Hand-rolled fetch
// against the same v1beta generativelanguage REST API as src/ai/gemini.ts; no
// SDK. The request/response/model-pick helpers are pure so they unit-test
// without a network.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface InlineImage {
  /** MIME type, e.g. "image/png". */
  mediaType: string;
  /** Base64 bytes, no `data:` prefix. */
  data: string;
}

/** Split a `data:<mime>;base64,<bytes>` URL into an {@link InlineImage}. */
export function dataUrlToInline(dataUrl: string): InlineImage {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Expected a data: URL');
  const mediaType = m[1] || 'image/png';
  const data = m[2] ? m[3] : btoa(decodeURIComponent(m[3]));
  return { mediaType, data };
}

/** Compose an {@link InlineImage} back into a `data:` URL. */
export function inlineToDataUrl(img: InlineImage): string {
  return `data:${img.mediaType};base64,${img.data}`;
}

/** Build the generateContent request body for an image-editing turn. */
export function buildImageRequest(source: InlineImage, prompt: string): Record<string, unknown> {
  return {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inlineData: { mimeType: source.mediaType, data: source.data } },
      ],
    }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Pull the first image part out of a generateContent response, or throw with
 *  the most useful diagnostic the response affords (block reason, text, etc.). */
export function parseImageResponse(json: GenerateContentResponse): InlineImage {
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Blocked by the model (${json.promptFeedback.blockReason}).`);
  }
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      return { mediaType: p.inlineData.mimeType || 'image/png', data: p.inlineData.data };
    }
  }
  const text = parts.map(p => p.text).filter(Boolean).join(' ').trim();
  const reason = json.candidates?.[0]?.finishReason;
  throw new Error(
    text ? `Model returned text, not an image: ${text.slice(0, 200)}`
      : `No image in the response${reason ? ` (finish reason: ${reason})` : ''}.`,
  );
}

/** Choose the best image-capable model id from a candidate list: prefer the
 *  "flash" tier (fast/cheap, the nano-banana sweet spot), then the highest
 *  version. Returns null for an empty list. */
export function pickImageModel(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return [...ids].sort((a, b) => {
    const af = /flash/i.test(a) ? 0 : 1, bf = /flash/i.test(b) ? 0 : 1;
    if (af !== bf) return af - bf;
    return b.localeCompare(a, undefined, { numeric: true });
  })[0];
}

/** List the key's image-generation-capable models (the `*-image` Gemini family,
 *  excluding the separate Imagen text-to-image API). Newest-ish first. */
export async function listGeminiImageModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${API_BASE}/models?pageSize=1000`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200) || res.statusText}`);
  }
  const data = await res.json() as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
  const ids: string[] = [];
  for (const m of data.models ?? []) {
    if (!m.name) continue;
    const id = m.name.replace(/^models\//, '');
    if (!/image/i.test(id) || /imagen/i.test(id)) continue;
    if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
    ids.push(id);
  }
  ids.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return ids;
}

/** Generate one alternate-angle image. Returns the image as a `data:` URL. */
export async function generateAngleImage(args: {
  apiKey: string;
  model: string;
  source: InlineImage;
  prompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const res = await fetch(`${API_BASE}/models/${encodeURIComponent(args.model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify(buildImageRequest(args.source, args.prompt)),
    signal: args.signal,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200) || res.statusText}`);
  }
  const img = parseImageResponse(await res.json());
  return inlineToDataUrl(img);
}
