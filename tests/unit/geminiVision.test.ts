import { describe, it, expect } from 'vitest';
import { buildSpecPrompt, parseSpecResponse, buildSpecRequest } from '../../src/ai/geminiVision';
import { buildSpecModelingPrompt } from '../../src/recon/studioModel';

describe('buildSpecPrompt', () => {
  it('asks for a quantitative, modelable build spec (not photography notes)', () => {
    const p = buildSpecPrompt('stylized');
    expect(p).toMatch(/build spec/i);
    expect(p).toMatch(/relative to head/i);
    expect(p).toMatch(/colours?|colors?/i);
    expect(p).toMatch(/stylized/i);
  });

  it('varies the aim by style', () => {
    expect(buildSpecPrompt('lowpoly')).toMatch(/low-poly/i);
    expect(buildSpecPrompt('realistic')).toMatch(/realistic/i);
  });
});

describe('buildSpecRequest', () => {
  it('puts the prompt first, then the image(s)', () => {
    const req = buildSpecRequest(
      [{ mediaType: 'image/png', data: 'AAA' }, { mediaType: 'image/jpeg', data: 'BBB' }],
      'analyze this',
    ) as { contents: Array<{ parts: Array<Record<string, unknown>> }> };
    const parts = req.contents[0].parts;
    expect(parts[0]).toEqual({ text: 'analyze this' });
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAA' } });
    expect(parts[2]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'BBB' } });
  });
});

describe('parseSpecResponse', () => {
  it('joins the text parts of the first candidate', () => {
    const spec = parseSpecResponse({
      candidates: [{ content: { parts: [{ text: '1. Head: ovoid.' }, { text: ' 2. Nose: wedge.' }] } }],
    });
    expect(spec).toBe('1. Head: ovoid. 2. Nose: wedge.');
  });

  it('surfaces a safety block', () => {
    expect(() => parseSpecResponse({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(/SAFETY/);
  });

  it('throws when there is no text', () => {
    expect(() => parseSpecResponse({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }))
      .toThrow(/no spec text/i);
  });
});

describe('buildSpecModelingPrompt', () => {
  it('embeds the spec, says there is no image, and prescribes the staged verify loop', () => {
    const out = buildSpecModelingPrompt('1. Head: tall ovoid.\n2. Beard: dark, lower 40%.', 'stylized');
    expect(out).toContain('=== BUILD SPEC ===');
    expect(out).toContain('1. Head: tall ovoid.');
    expect(out).toMatch(/no reference image/i);
    expect(out).toMatch(/renderView/);
    expect(out).toMatch(/above the brow/i); // the hat-placement guardrail
    expect(out).toMatch(/styliz/i);
  });
});
