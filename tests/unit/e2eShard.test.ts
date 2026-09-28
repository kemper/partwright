import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
// @ts-expect-error — plain .mjs helper shared with playwright.config.ts (no .d.ts)
import { assignShards, parseShardSpec, filesForShard, loadTimings } from '../../scripts/lib/e2eShard.mjs';

describe('e2e time-balanced sharding', () => {
  it('parses i/N and rejects malformed or out-of-range specs', () => {
    expect(parseShardSpec(undefined)).toBeNull();
    expect(parseShardSpec('')).toBeNull();
    expect(parseShardSpec('2/8')).toEqual({ index: 2, total: 8 });
    expect(() => parseShardSpec('0/8')).toThrow();
    expect(() => parseShardSpec('9/8')).toThrow();
    expect(() => parseShardSpec('two')).toThrow();
  });

  it('balances by weight, not count (LPT)', () => {
    const timings = { 'a.spec.ts': 10, 'b.spec.ts': 6, 'c.spec.ts': 4, 'd.spec.ts': 0.1, 'e.spec.ts': 0.1 };
    const shards: string[][] = assignShards(Object.keys(timings), timings, 2);
    const load = (s: string[]) => s.reduce((t, f) => t + timings[f as keyof typeof timings], 0);
    expect(shards[0]).toEqual(['a.spec.ts', 'd.spec.ts']);
    expect(load(shards[0])).toBeCloseTo(10.1);
    expect(load(shards[1])).toBeCloseTo(10.1);
  });

  it('weights files with no recorded timing at the median', () => {
    const timings = { 'a.spec.ts': 1, 'b.spec.ts': 5, 'c.spec.ts': 9 };
    const shards: string[][] = assignShards(['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'new.spec.ts'], timings, 2);
    // c(9) → s0; new(5, median) → s1; b(5) → s1; a(1) → s0.
    expect(shards).toEqual([['a.spec.ts', 'c.spec.ts'], ['b.spec.ts', 'new.spec.ts']]);
  });

  it('puts every real spec file in exactly one shard', () => {
    const all = readdirSync('tests').filter((f) => f.endsWith('.spec.ts')).sort();
    for (const total of [1, 3, 8]) {
      const got: string[] = [];
      for (let i = 1; i <= total; i++) got.push(...filesForShard(i, total, 'tests'));
      expect(got.sort()).toEqual(all);
    }
  });

  it('timings file only lists spec files', () => {
    for (const f of Object.keys(loadTimings('tests/e2e-timings.json'))) expect(f).toMatch(/\.spec\.ts$/);
  });
});
