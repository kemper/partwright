// Unit tests for the literal find/replace patch helpers behind forkVersion
// and modifyAndTest. These run in Node via vitest (no browser) — the module is
// kept dependency-free precisely so it can be tested in isolation.

import { describe, test, expect } from 'vitest';
import { applyLiteralPatch, applyPatches } from '../../src/ai/patch';

describe('applyLiteralPatch', () => {
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

  test('falls back to whitespace-normalized match when exact fails', () => {
    // Auto-formatter collapsed multi-line declaration to one line; patch find
    // still has the original whitespace.
    const code = 'const a = 1, b = 2;';
    const find = 'const a = 1,\n  b = 2;';
    expect(applyLiteralPatch(code, find, 'const a = 3, b = 4;')).toBe('const a = 3, b = 4;');
  });

  test('whitespace fallback still errors when normalized find is absent', () => {
    expect(() => applyLiteralPatch('const a = 1;', 'const b = 2;', 'const b = 3;'))
      .toThrow(/not present/);
  });

  test('whitespace fallback still errors when normalized find is ambiguous', () => {
    // Two occurrences even after normalization
    const code = 'const x = 1;\nconst x = 1;';
    expect(() => applyLiteralPatch(code, 'const\nx = 1;', 'const x = 2;'))
      .toThrow(/not present|matches \d+ places/);
  });
});

describe('applyPatches', () => {
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
