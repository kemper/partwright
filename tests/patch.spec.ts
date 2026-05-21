// Unit tests for the literal find/replace patch helpers behind forkVersion
// and modifyAndTest. These run in Node (no browser) — the module is kept
// dependency-free precisely so it can be tested in isolation.

import { test, expect } from 'playwright/test';
import { applyLiteralPatch, applyPatches } from '../src/ai/patch';

test.describe('applyLiteralPatch', () => {
  test('replaces a unique match', () => {
    expect(applyLiteralPatch('const size = 20;', 'size = 20', 'size = 24')).toBe('const size = 24;');
  });

  test('throws when the find string is absent (the silent-failure bug)', () => {
    // Before the fix, String.replace returned the input unchanged and the
    // fork "succeeded" having changed nothing. Now it must error.
    expect(() => applyLiteralPatch('const a = 1;', 'const b = 2;', 'const b = 3;'))
      .toThrow(/not present/);
  });

  test('throws when the find string matches more than once', () => {
    expect(() => applyLiteralPatch('x = x + x;', 'x', 'y'))
      .toThrow(/matches \d+ places/);
  });

  test('throws on an empty find string', () => {
    expect(() => applyLiteralPatch('abc', '', 'z')).toThrow(/non-empty string/);
  });

  test('treats `$` sequences in the replacement literally', () => {
    // String.replace would interpret `$&` as the matched text; split/join must not.
    expect(applyLiteralPatch('cost = PRICE;', 'PRICE', '$5')).toBe('cost = $5;');
    expect(applyLiteralPatch('a = TOKEN;', 'TOKEN', '$&b')).toBe('a = $&b;');
  });
});

test.describe('applyPatches', () => {
  test('applies a sequence of unique patches', () => {
    const code = 'const w = 10;\nconst h = 20;';
    const out = applyPatches([
      { find: 'w = 10', replace: 'w = 15' },
      { find: 'h = 20', replace: 'h = 25' },
    ], code);
    expect(out).toBe('const w = 15;\nconst h = 25;');
  });

  test('reports which patch index failed', () => {
    const code = 'const w = 10;\nconst h = 20;';
    expect(() => applyPatches([
      { find: 'w = 10', replace: 'w = 15' },
      { find: 'h = 99', replace: 'h = 25' },
    ], code)).toThrow(/patches\[1\]/);
  });

  test('a later patch can match text introduced by an earlier one', () => {
    const out = applyPatches([
      { find: 'A', replace: 'B' },
      { find: 'B', replace: 'C' },
    ], 'A');
    expect(out).toBe('C');
  });
});
