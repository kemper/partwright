import { describe, it, expect } from 'vitest';
import { rewriteVersionCode } from '../../src/storage/versionRewrite';
import { simpleHash } from '../../src/geometry/simpleHash';

const OLD = 'return api.Manifold.cube([10,10,10], true);';
const NEW = 'const c = api.Manifold.cube([10,10,10], true);\nreturn c;';

describe('rewriteVersionCode — the canonical code/codeHash/colorRegions sync', () => {
  it('replaces the code and restamps a FRESH codeHash to the new code', () => {
    const v = { code: OLD, geometryData: { codeHash: simpleHash(OLD), volume: 1000 } };
    rewriteVersionCode(v, NEW);
    expect(v.code).toBe(NEW);
    expect(v.geometryData.codeHash).toBe(simpleHash(NEW));
    expect(v.geometryData.volume).toBe(1000); // untouched
  });

  it('preserves a STALE codeHash so the app still re-runs (stats of unknown provenance stay flagged)', () => {
    const staleHash = simpleHash('some other code entirely');
    const v = { code: OLD, geometryData: { codeHash: staleHash } };
    rewriteVersionCode(v, NEW);
    expect(v.code).toBe(NEW);
    expect(v.geometryData.codeHash).toBe(staleHash);
    expect(v.geometryData.codeHash).not.toBe(simpleHash(NEW));
  });

  it('leaves a missing codeHash missing (no false freshness claim)', () => {
    const v = { code: OLD, geometryData: { volume: 5 } as Record<string, unknown> };
    rewriteVersionCode(v, NEW);
    expect('codeHash' in v.geometryData).toBe(false);
  });

  it('tolerates null/absent geometryData', () => {
    expect(rewriteVersionCode({ code: OLD, geometryData: null }, NEW).code).toBe(NEW);
    expect(rewriteVersionCode({ code: OLD }, NEW).code).toBe(NEW);
  });

  it('updates BOTH colorRegions mirrors when regions are passed', () => {
    const oldRegions = [{ id: 1 }, { id: 2 }];
    const retained = [{ id: 2 }];
    const v = {
      code: OLD,
      colorRegions: oldRegions,
      geometryData: { codeHash: simpleHash(OLD), colorRegions: oldRegions },
    };
    rewriteVersionCode(v, NEW, { colorRegions: retained });
    expect(v.colorRegions).toBe(retained);
    expect(v.geometryData.colorRegions).toBe(retained);
    expect(v.geometryData.codeHash).toBe(simpleHash(NEW));
  });

  it('leaves both mirrors alone when colorRegions is not passed', () => {
    const regions = [{ id: 1 }];
    const v = { code: OLD, colorRegions: regions, geometryData: { colorRegions: regions } };
    rewriteVersionCode(v, NEW);
    expect(v.colorRegions).toBe(regions);
    expect(v.geometryData.colorRegions).toBe(regions);
  });

  it('returns the same object for chaining', () => {
    const v = { code: OLD };
    expect(rewriteVersionCode(v, NEW)).toBe(v);
  });
});
