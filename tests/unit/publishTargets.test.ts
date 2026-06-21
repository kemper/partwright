import { describe, it, expect } from 'vitest';
import {
  PUBLISH_TARGETS,
  findPublishTarget,
  recommendedFormat,
  parseTags,
  buildDefaultDescription,
  composeClipboardText,
  parseAiPublishMetadata,
  PUBLISH_CREDIT,
} from '../../src/publish/publishTargets';

describe('publishTargets', () => {
  it('exposes the four expected platforms with valid upload URLs', () => {
    const ids = PUBLISH_TARGETS.map(t => t.id);
    expect(ids).toEqual(['printables', 'makerworld', 'thingiverse', 'thangs']);
    for (const t of PUBLISH_TARGETS) {
      expect(t.uploadUrl).toMatch(/^https:\/\//);
      expect(t.formats.length).toBeGreaterThan(0);
      expect(t.notes.trim().length).toBeGreaterThan(0);
    }
  });

  it('findPublishTarget resolves by id and rejects unknown ids', () => {
    expect(findPublishTarget('printables')?.label).toBe('Printables');
    expect(findPublishTarget('nope')).toBeUndefined();
  });

  it('recommendedFormat is the first accepted format', () => {
    expect(recommendedFormat(findPublishTarget('printables')!)).toBe('3mf');
    expect(recommendedFormat(findPublishTarget('thingiverse')!)).toBe('stl');
    // MakerWorld prefers the Bambu/Orca project 3MF (build plate + filaments).
    expect(recommendedFormat(findPublishTarget('makerworld')!)).toBe('3mf-bambu');
  });

  it('parseTags trims, splits on commas, and drops blanks', () => {
    expect(parseTags(' a, b ,, c,  ')).toEqual(['a', 'b', 'c']);
    expect(parseTags('')).toEqual([]);
  });

  it('buildDefaultDescription includes the credit line and optional size', () => {
    const plain = buildDefaultDescription('Widget');
    expect(plain).toContain('Widget');
    expect(plain).toContain(PUBLISH_CREDIT);

    const sized = buildDefaultDescription('Widget', { dims: [10.123, 20, 5], units: 'mm' });
    expect(sized).toContain('10.12 × 20 × 5 mm');
  });

  it('composeClipboardText formats title/description and omits empty tags', () => {
    const withTags = composeClipboardText({ title: 'T', description: 'D', tags: ['x', 'y'] });
    expect(withTags).toContain('Title: T');
    expect(withTags).toContain('Description:');
    expect(withTags).toContain('Tags: x, y');

    const noTags = composeClipboardText({ title: 'T', description: 'D', tags: [] });
    expect(noTags).not.toContain('Tags:');
  });

  it('parseAiPublishMetadata parses plain JSON, fenced JSON, and JSON with prose', () => {
    const plain = parseAiPublishMetadata('{"title":"Widget","description":"A thing","tags":["a","b"]}');
    expect(plain).toEqual({ title: 'Widget', description: 'A thing', tags: ['a', 'b'] });

    const fenced = parseAiPublishMetadata('```json\n{"title":"W","description":"D","tags":[]}\n```');
    expect(fenced.title).toBe('W');

    const prosey = parseAiPublishMetadata('Here you go:\n{"title":"W","description":"D"}\nHope that helps!');
    expect(prosey.description).toBe('D');
    expect(prosey.tags).toEqual([]);
  });

  it('parseAiPublishMetadata trims tags and rejects empties / non-strings', () => {
    const r = parseAiPublishMetadata('{"title":"T","description":"D","tags":[" a ","",3,"b"]}');
    expect(r.tags).toEqual(['a', 'b']);
  });

  it('parseAiPublishMetadata throws when there is no title or description', () => {
    expect(() => parseAiPublishMetadata('{"tags":["x"]}')).toThrow();
    expect(() => parseAiPublishMetadata('not json at all')).toThrow();
  });
});
