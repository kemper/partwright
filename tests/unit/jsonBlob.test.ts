import { describe, it, expect } from 'vitest';
import { jsonToBlob } from '../../src/export/jsonBlob';

const SAMPLES: unknown[] = [
  null, 0, -1.5, 'a "quoted"\n  string', true, false,
  [], {}, [1, 'x', null, [], {}],
  { a: 1, b: undefined, c: () => 1, d: [undefined, () => 1, NaN, Infinity], e: { f: { g: [] } } },
  { date: new Date(0), nested: { toJSON: (k: string) => `key:${k}` } },
  { boxed: [new Number(3), new String('s'), new Boolean(false)] },
  { '': 'empty key', 'ü': 'unicode', '\u0000': 'nul' },
  { session: { name: 'x', versions: Array.from({ length: 50 }, (_, i) => ({ index: i, code: 'return 1;'.repeat(i) })) } },
];

describe('jsonToBlob', () => {
  for (const indent of [0, 2]) {
    it(`matches JSON.stringify byte-for-byte (indent ${indent})`, async () => {
      for (const v of SAMPLES) {
        expect(await jsonToBlob(v, indent).text()).toBe(JSON.stringify(v, null, indent));
      }
    });
  }

  it('splits large documents into multiple parts with identical output', async () => {
    const big = { chunks: Array.from({ length: 40 }, (_, i) => `${i}`.padEnd(500_000, 'x')) };
    expect(await jsonToBlob(big, 2).text()).toBe(JSON.stringify(big, null, 2));
  });

  it('throws on circular references like JSON.stringify', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => jsonToBlob(a)).toThrow(TypeError);
  });

  it('allows the same object to appear twice (not circular)', async () => {
    const shared = { x: 1 };
    const v = { a: shared, b: [shared] };
    expect(await jsonToBlob(v, 2).text()).toBe(JSON.stringify(v, null, 2));
  });

  it('sets the mime type', () => {
    expect(jsonToBlob({}, 0, 'application/json').type).toBe('application/json');
  });
});
