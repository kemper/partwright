import { describe, it, expect } from 'vitest';
import { sourceUsesBrep } from '../../src/geometry/brepRuntime';

describe('sourceUsesBrep', () => {
  it('detects api.BREP.box(...) usage', () => {
    expect(sourceUsesBrep('return api.BREP.box([10, 10, 10]).fillet(2);')).toBe(true);
  });

  it('detects destructured BREP', () => {
    expect(sourceUsesBrep('const { BREP } = api;\nreturn BREP.cylinder(5, 10);')).toBe(true);
  });

  it('detects BREP in arbitrary positions', () => {
    expect(sourceUsesBrep('// uses BREP for fillets')).toBe(true);
    expect(sourceUsesBrep('const x = "BREP"; return Manifold.cube([1,1,1]);')).toBe(true);
  });

  it('returns false for code without BREP', () => {
    expect(sourceUsesBrep('return Manifold.cube([10, 10, 10]);')).toBe(false);
    expect(sourceUsesBrep('// just manifold')).toBe(false);
  });

  it('uses word boundaries so it does not match substrings', () => {
    // No false-positive on identifiers that happen to contain "BREP".
    expect(sourceUsesBrep('const aBREPb = 1;')).toBe(false);
    expect(sourceUsesBrep('const xBREP = 1;')).toBe(false);
    expect(sourceUsesBrep('const BREPx = 1;')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(sourceUsesBrep('')).toBe(false);
    expect(sourceUsesBrep('   \n\n   ')).toBe(false);
  });

  it('detects BREP after various preceding whitespace / punctuation', () => {
    expect(sourceUsesBrep('(BREP)')).toBe(true);
    expect(sourceUsesBrep('=BREP\n')).toBe(true);
    // `.BREP` matches because `.` is a non-word char and `B` is a word char —
    // this is the desired behaviour: `api.BREP` should trigger the loader.
    expect(sourceUsesBrep('api.BREP')).toBe(true);
  });
});
