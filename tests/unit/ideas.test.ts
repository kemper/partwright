import { describe, test, expect } from 'vitest';
import {
  IDEAS,
  IDEA_CATEGORIES,
  filterIdeas,
  promptIdeas,
  starterChipIdeas,
  type Idea,
} from '../../src/ideas/ideas';

// The Ideas dataset feeds both the /ideas gallery and the in-pane prompt
// library. These tests lock the data invariants the UI relies on (ids unique,
// prompts/actions present per category) and the pure search/selection helpers.

describe('IDEAS dataset', () => {
  test('every idea has a unique id', () => {
    const ids = IDEAS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each category in IDEA_CATEGORIES has at least one idea', () => {
    for (const cat of IDEA_CATEGORIES) {
      expect(IDEAS.some((i) => i.category === cat.id), `category ${cat.id} should be non-empty`).toBe(true);
    }
  });

  test('starter and technique ideas carry a non-empty prompt', () => {
    for (const idea of IDEAS.filter((i) => i.category === 'starter' || i.category === 'technique')) {
      expect(typeof idea.prompt, `${idea.id} prompt`).toBe('string');
      expect((idea.prompt ?? '').length, `${idea.id} prompt`).toBeGreaterThan(0);
    }
  });

  test('interactive ideas declare a known action and carry no prompt', () => {
    const knownActions = new Set(['photoToVoxel', 'photoToRelief']);
    for (const idea of IDEAS.filter((i) => i.category === 'interactive')) {
      expect(idea.prompt, `${idea.id} should not have a prompt`).toBeUndefined();
      expect(idea.action, `${idea.id} action`).toBeDefined();
      expect(knownActions.has(idea.action!), `${idea.id} action ${idea.action}`).toBe(true);
    }
  });

  test('learnMore links are root-relative paths', () => {
    for (const idea of IDEAS) {
      if (idea.learnMore !== undefined) {
        expect(idea.learnMore.startsWith('/'), `${idea.id} learnMore`).toBe(true);
      }
    }
  });
});

describe('filterIdeas', () => {
  const sample: Idea[] = [
    { id: 'a', title: 'Coffee mug', blurb: 'a drinking vessel', category: 'starter', emoji: '☕', tags: ['kitchen'], prompt: 'make a mug' },
    { id: 'b', title: 'Spur gear', blurb: 'mechanical part', category: 'technique', emoji: '⚙', tags: ['openscad', 'bosl2'], prompt: 'make a gear' },
  ];

  test('a blank query returns the list unchanged', () => {
    expect(filterIdeas(sample, '')).toEqual(sample);
    expect(filterIdeas(sample, '   ')).toEqual(sample);
  });

  test('matches title, case-insensitively', () => {
    expect(filterIdeas(sample, 'COFFEE').map((i) => i.id)).toEqual(['a']);
  });

  test('matches a tag', () => {
    expect(filterIdeas(sample, 'bosl2').map((i) => i.id)).toEqual(['b']);
  });

  test('matches blurb and prompt text', () => {
    expect(filterIdeas(sample, 'vessel').map((i) => i.id)).toEqual(['a']);
    expect(filterIdeas(sample, 'make a gear').map((i) => i.id)).toEqual(['b']);
  });

  test('a no-match query returns empty', () => {
    expect(filterIdeas(sample, 'zzzznope')).toEqual([]);
  });
});

describe('promptIdeas / starterChipIdeas', () => {
  test('promptIdeas excludes interactive (prompt-less) ideas', () => {
    const withPrompts = promptIdeas();
    expect(withPrompts.length).toBeGreaterThan(0);
    expect(withPrompts.every((i) => typeof i.prompt === 'string' && i.prompt.length > 0)).toBe(true);
    expect(withPrompts.some((i) => i.category === 'interactive')).toBe(false);
  });

  test('starterChipIdeas returns only starters, capped at the limit', () => {
    const chips = starterChipIdeas(3);
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips.every((i) => i.category === 'starter')).toBe(true);
  });
});
