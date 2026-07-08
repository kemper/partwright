import { describe, it, expect } from 'vitest';
import {
  printTestedBadge,
  printStatusOf,
  printStatusCounts,
  latestVersionIndex,
} from '../../src/content/data/catalogCategories';

describe('printTestedBadge', () => {
  it('defaults to "Untested" when no input is given', () => {
    const badge = printTestedBadge();
    expect(badge.tested).toBe(false);
    expect(badge.stale).toBe(false);
    expect(badge.label).toBe('Untested');
    expect(badge.search).toContain('untested');
    expect(badge.title).toMatch(/not print-tested/i);
  });

  it('treats an explicit false the same as absent', () => {
    expect(printTestedBadge({ printTested: false })).toEqual(printTestedBadge({}));
    expect(printTestedBadge({ printTested: false })).toEqual(printTestedBadge());
  });

  it('reports verified state when the flag is true', () => {
    const badge = printTestedBadge({ printTested: true });
    expect(badge.tested).toBe(true);
    expect(badge.stale).toBe(false);
    expect(badge.label).toBe('✓ Print-tested');
    expect(badge.search).toContain('verified');
    expect(badge.title).toMatch(/verified/i);
  });

  it('uses distinct search tokens so each state is independently findable', () => {
    expect(printTestedBadge({ printTested: true }).search).toContain('verified');
    expect(printTestedBadge({ printTested: false }).search).not.toContain('verified');
    expect(printTestedBadge({ printTested: false }).search).toContain('untested');
    expect(printTestedBadge({ printTested: true }).search).not.toContain('untested');
  });

  it('untested tokens never contain the "print-tested" substring (filter matches substrings)', () => {
    // The catalog filter uses haystack.includes(token), so searching
    // "print-tested" must surface only verified tiles — the untested token
    // must not collide with it.
    expect(printTestedBadge({ printTested: false }).search).not.toContain('print-tested');
    expect(printTestedBadge({ printTested: true }).search).toContain('print-tested');
  });

  it('surfaces the curator note in the tooltip, ahead of the generic line', () => {
    const badge = printTestedBadge({ printTested: true, note: 'Comes out really cleanly.' });
    expect(badge.title).toContain('Comes out really cleanly.');
    // The generic "Verified — …" fallback is replaced by the note.
    expect(badge.title).not.toMatch(/^Verified —/);
  });

  it('appends the tested-version provenance when a version is known and current', () => {
    const badge = printTestedBadge({ printTested: true, testedVersion: 3, latestVersion: 3 });
    expect(badge.stale).toBe(false);
    expect(badge.label).toBe('✓ Print-tested');
    expect(badge.title).toContain('Verified at version 3.');
  });

  it('flags a stale print when the model has advanced past the tested version', () => {
    const badge = printTestedBadge({
      printTested: true,
      note: 'Printed and works.',
      testedVersion: 2,
      latestVersion: 5,
    });
    expect(badge.tested).toBe(true);
    expect(badge.stale).toBe(true);
    expect(badge.label).toBe('✓ Print-tested (v2)');
    expect(badge.classes).toContain('amber');
    expect(badge.title).toContain('Printed and works.');
    expect(badge.title).toMatch(/updated to version 5/);
    expect(badge.search).toContain('outdated');
  });

  it('does not flag stale when tested at (or beyond) the latest version', () => {
    expect(printTestedBadge({ printTested: true, testedVersion: 4, latestVersion: 4 }).stale).toBe(false);
    expect(printTestedBadge({ printTested: true, testedVersion: 5, latestVersion: 4 }).stale).toBe(false);
  });

  it('stays current when the tested version is unknown, even with a latest version', () => {
    // Only a testedVersion can make a print stale — asserting "a print exists"
    // without pinning a version must not trip the re-test warning.
    const badge = printTestedBadge({ printTested: true, latestVersion: 9 });
    expect(badge.stale).toBe(false);
    expect(badge.title).not.toMatch(/version/i);
  });
});

describe('printStatusOf', () => {
  it('maps the flag to one bucket, treating absent/false as untested', () => {
    expect(printStatusOf(true)).toBe('tested');
    expect(printStatusOf(false)).toBe('untested');
    expect(printStatusOf(undefined)).toBe('untested');
  });
});

describe('printStatusCounts', () => {
  it('tallies tested vs untested across entries', () => {
    const counts = printStatusCounts([
      { printTested: true },
      { printTested: true },
      { printTested: false },
      {},
    ]);
    expect(counts.get('tested')).toBe(2);
    expect(counts.get('untested')).toBe(2);
  });

  it('omits a status with no entries (so a fully-untested catalog shows no facet)', () => {
    const counts = printStatusCounts([{ printTested: false }, {}]);
    expect(counts.has('tested')).toBe(false);
    expect(counts.get('untested')).toBe(2);
  });
});

describe('latestVersionIndex', () => {
  it('returns the highest version index (linear history)', () => {
    expect(latestVersionIndex([{ index: 1 }, { index: 2 }, { index: 3 }])).toBe(3);
  });

  it('uses revision depth, not array length, for a multi-part kit', () => {
    // A 37-part kit whose parts are all at index 1 has a latest *version* of 1,
    // even though the array holds 37 entries — the trap that would falsely flag
    // a print tested at v1 as stale (37 > 1).
    const parts = Array.from({ length: 37 }, () => ({ index: 1 }));
    expect(latestVersionIndex(parts)).toBe(1);
  });

  it('falls back to the array length when no indices are present', () => {
    expect(latestVersionIndex([{}, {}])).toBe(2);
    expect(latestVersionIndex([])).toBe(0);
  });

  it('keeps a print tested at the deepest index from reading as stale', () => {
    // Regression guard: dummy13-style kit, tested at v1, must not be stale.
    const parts = Array.from({ length: 37 }, () => ({ index: 1 }));
    const badge = printTestedBadge({ printTested: true, testedVersion: 1, latestVersion: latestVersionIndex(parts) });
    expect(badge.stale).toBe(false);
  });
});
