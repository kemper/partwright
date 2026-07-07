import { describe, it, expect } from 'vitest';
import { printTestedBadge } from '../../src/content/data/catalogCategories';

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
