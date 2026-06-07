import { describe, it, expect } from 'vitest';
import { printTestedBadge } from '../../src/content/data/catalogCategories';

describe('printTestedBadge', () => {
  it('defaults to "Untested" when the flag is absent', () => {
    const badge = printTestedBadge(undefined);
    expect(badge.tested).toBe(false);
    expect(badge.label).toBe('Untested');
    expect(badge.search).toContain('untested');
    expect(badge.title).toMatch(/not print-tested/i);
  });

  it('treats an explicit false the same as absent', () => {
    expect(printTestedBadge(false)).toEqual(printTestedBadge(undefined));
  });

  it('reports verified state when the flag is true', () => {
    const badge = printTestedBadge(true);
    expect(badge.tested).toBe(true);
    expect(badge.label).toBe('✓ Print-tested');
    expect(badge.search).toContain('verified');
    expect(badge.title).toMatch(/verified/i);
  });

  it('uses distinct search tokens so each state is independently findable', () => {
    expect(printTestedBadge(true).search).toContain('verified');
    expect(printTestedBadge(false).search).not.toContain('verified');
    expect(printTestedBadge(false).search).toContain('untested');
    expect(printTestedBadge(true).search).not.toContain('untested');
  });

  it('untested tokens never contain the "print-tested" substring (filter matches substrings)', () => {
    // The catalog filter uses haystack.includes(token), so searching
    // "print-tested" must surface only verified tiles — the untested token
    // must not collide with it.
    expect(printTestedBadge(false).search).not.toContain('print-tested');
    expect(printTestedBadge(true).search).toContain('print-tested');
  });
});
