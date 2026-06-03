import { describe, it, expect } from 'vitest';
import {
  dataUrlToInline,
  inlineToDataUrl,
  buildImageRequest,
  parseImageResponse,
  pickImageModel,
} from '../../src/ai/geminiImage';

describe('data URL <-> inline image', () => {
  it('round-trips a base64 data URL', () => {
    const url = 'data:image/png;base64,AQIDBA==';
    const inline = dataUrlToInline(url);
    expect(inline).toEqual({ mediaType: 'image/png', data: 'AQIDBA==' });
    expect(inlineToDataUrl(inline)).toBe(url);
  });

  it('rejects non-data URLs', () => {
    expect(() => dataUrlToInline('https://example.com/x.png')).toThrow(/data:/);
  });
});

describe('buildImageRequest', () => {
  it('puts the prompt and the source image into one user turn, image output only', () => {
    const req = buildImageRequest({ mediaType: 'image/jpeg', data: 'ABC' }, 'turn left') as any;
    expect(req.contents[0].role).toBe('user');
    expect(req.contents[0].parts[0]).toEqual({ text: 'turn left' });
    expect(req.contents[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'ABC' } });
    expect(req.generationConfig.responseModalities).toEqual(['IMAGE']);
  });
});

describe('parseImageResponse', () => {
  it('extracts the first inline image part', () => {
    const img = parseImageResponse({
      candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: 'ZZZ' } }] } }],
    });
    expect(img).toEqual({ mediaType: 'image/png', data: 'ZZZ' });
  });

  it('surfaces a safety block reason', () => {
    expect(() => parseImageResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/SAFETY/);
  });

  it('explains a text-only (no image) response', () => {
    expect(() => parseImageResponse({
      candidates: [{ content: { parts: [{ text: 'I cannot do that' }] }, finishReason: 'STOP' }],
    })).toThrow(/text, not an image/i);
  });

  it('handles an empty response', () => {
    expect(() => parseImageResponse({})).toThrow(/No image/i);
  });
});

describe('pickImageModel', () => {
  it('prefers a flash model, then the highest version', () => {
    expect(pickImageModel(['gemini-2.5-flash-image', 'gemini-3-pro-image', 'gemini-3-flash-image']))
      .toBe('gemini-3-flash-image');
  });

  it('falls back to the highest version when no flash exists', () => {
    expect(pickImageModel(['gemini-2.5-pro-image', 'gemini-3-pro-image'])).toBe('gemini-3-pro-image');
  });

  it('returns null for an empty list', () => {
    expect(pickImageModel([])).toBeNull();
  });
});
