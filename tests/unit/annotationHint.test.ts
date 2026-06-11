import { describe, it, expect } from 'vitest';
import { formatAnnotationHint } from '../../src/ai/systemPrompt';

describe('formatAnnotationHint', () => {
  it('returns null for an unmarked model (zero suffix cost)', () => {
    expect(formatAnnotationHint([], 0)).toBeNull();
  });

  it('renders a single text note with its anchor', () => {
    const hint = formatAnnotationHint(
      [{ text: 'too thin here', anchor: [3, 0, 5.2] }],
      0,
    )!;
    expect(hint).toContain('1 text note');
    expect(hint).toContain('"too thin here"');
    expect(hint).toContain('(3, 0, 5.2)');
    expect(hint).toMatch(/art-direction|feedback/i);
  });

  it('pluralizes and lists multiple notes', () => {
    const hint = formatAnnotationHint(
      [
        { text: 'round this', anchor: [1, 0, 0] },
        { text: 'flatten', anchor: [-2, 0, 4] },
      ],
      0,
    )!;
    expect(hint).toContain('2 text notes');
    expect(hint).toContain('[1]');
    expect(hint).toContain('[2]');
  });

  it('reports freehand strokes', () => {
    const hint = formatAnnotationHint([], 3)!;
    expect(hint).toContain('3 freehand marks');
    expect(hint).toContain('listAnnotations()');
  });

  it('truncates an overlong note', () => {
    const long = 'x'.repeat(200);
    const hint = formatAnnotationHint([{ text: long, anchor: [0, 0, 0] }], 0)!;
    expect(hint).toContain('…');
    expect(hint).not.toContain('x'.repeat(120));
  });

  it('caps the number listed and notes the remainder', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      text: `note ${i}`, anchor: [i, 0, 0] as [number, number, number],
    }));
    const hint = formatAnnotationHint(many, 0)!;
    expect(hint).toContain('and 4 more');
    expect(hint).toContain('listTextAnnotations()');
  });
});
