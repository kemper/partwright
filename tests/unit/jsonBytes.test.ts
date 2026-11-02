import { describe, it, expect } from 'vitest';
import { parseJsonBytes, parseJsonBlob } from '../../src/import/jsonBytes';
import { jsonToBlob } from '../../src/export/jsonBlob';

const enc = new TextEncoder();
const parse = (s: string): unknown => parseJsonBytes(enc.encode(s));

const VALID = [
  'null', 'true', 'false', '0', '-0', '12', '-1.5e-3', '1E+10', '3.25',
  '""', '"plain"', '"esc \\" \\\\ \\/ \\b \\f \\n \\r \\t \\u00e9 \\ud83d\\ude00"',
  '"ünïcödé 😀"', '"ends in backslash \\\\"',
  '[]', '{}', ' [ 1 , "a" , null , [ ] , { } ] ',
  '{"a":1,"b":{"c":[true,false]},"a":2}',
  '\n\t{\r\n "k" : "v" }\n',
  '{"session":{"name":"x"},"versions":[{"code":"return api.Manifold.cube([1,2,3]);\\n"}]}',
];

const INVALID = [
  '', ' ', '{', '[1,]', '{"a":1,}', '{a:1}', "'x'", '01', '1.', '.5', '+1', '-', '1e',
  'tru', 'nul', '"unterminated', '[1 2]', '{"a" 1}', '1 2', 'NaN', 'undefined',
];

describe('parseJsonBytes', () => {
  it('matches JSON.parse on valid input', () => {
    for (const s of VALID) expect(parse(s), s).toEqual(JSON.parse(s));
  });

  it('rejects invalid input like JSON.parse', () => {
    for (const s of INVALID) {
      expect(() => JSON.parse(s), `JSON.parse ${s}`).toThrow();
      expect(() => parse(s), s).toThrow(SyntaxError);
    }
  });

  it('keeps __proto__ as an own property, not the prototype', () => {
    const v = parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.getPrototypeOf(v)).toBe(Object.prototype);
    expect(Object.keys(v)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('skips a UTF-8 BOM', () => {
    expect(parseJsonBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('[1]')]))).toEqual([1]);
  });

  it('rejects invalid UTF-8', () => {
    expect(() => parseJsonBytes(new Uint8Array([0x22, 0xff, 0x22]))).toThrow();
  });

  it('round-trips an exported session blob', async () => {
    const data = {
      partwright: '1.0', session: { name: 'big' },
      versions: Array.from({ length: 20 }, (_, i) => ({
        index: i, code: `// v${i}\nreturn "q\\"uote";`, mesh: 'QUJD'.repeat(10_000), stats: { volume: i * 1.5, ok: true, none: null },
      })),
    };
    const blob = jsonToBlob(data, 2);
    expect(parseJsonBytes(new Uint8Array(await blob.arrayBuffer()))).toEqual(data);
    expect(await parseJsonBlob(blob)).toEqual(data);
  });

  it('parseJsonBlob rethrows syntax errors from the fast path', async () => {
    await expect(parseJsonBlob(new Blob(['{bad'], { type: 'application/json' }))).rejects.toThrow(SyntaxError);
  });
});
