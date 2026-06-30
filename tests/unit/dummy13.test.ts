// Unit tests for the pure-logic parts of dummy13. The geometry builders that
// need the manifold-3d WASM module are exercised by the catalog bake.

import { describe, it, expect } from 'vitest';
import { DUMMY13_SPEC, __testables__ } from '../../src/geometry/dummy13';

const { resolveSpec } = __testables__;

describe('dummy13.DUMMY13_SPEC', () => {
  it('pins the universal 6mm socket cavity — every joint in the figure', () => {
    // This is THE spec — soozafone's design genius. Changing it breaks
    // interop with every official Dummy 13 part.
    expect(DUMMY13_SPEC.socketCavityD).toBe(6.0);
  });

  it('default ball is 5.7mm — tighter than stock 5.0 for pose hold', () => {
    expect(DUMMY13_SPEC.ballD).toBe(5.7);
    // Must stay smaller than cavity or the joint can't articulate.
    expect(DUMMY13_SPEC.ballD).toBeLessThan(DUMMY13_SPEC.socketCavityD);
  });

  it('socket housing matches official: wall 3mm, body 5.5mm thick', () => {
    expect(DUMMY13_SPEC.socketWall).toBe(3.0);
    expect(DUMMY13_SPEC.bodyT).toBe(5.5);
  });

  it('hip width 16mm and shoulder width 12mm — official socket spacings', () => {
    expect(DUMMY13_SPEC.hipWidth).toBe(16);
    expect(DUMMY13_SPEC.shoulderWidth).toBe(12);
  });
});

describe('dummy13.resolveSpec', () => {
  it('returns DUMMY13_SPEC defaults when input is empty', () => {
    const spec = resolveSpec({});
    expect(spec.socketCavityD).toBe(DUMMY13_SPEC.socketCavityD);
    expect(spec.ballD).toBe(DUMMY13_SPEC.ballD);
  });

  it('overrides only the fields the caller specifies', () => {
    const spec = resolveSpec({ ballD: 5.0 });
    expect(spec.ballD).toBe(5.0); // stock-spec swap
    expect(spec.socketCavityD).toBe(6.0); // unchanged
    expect(spec.hipWidth).toBe(16);
  });

  it('total body-axis segment length (head to ankle, no foot) is in range', () => {
    const s = DUMMY13_SPEC;
    const total = s.headH + s.neckLen + s.chestH + s.abdomenH + s.waistH + s.hipsH + s.thighLen + s.shinLen;
    // 11 + 10 + 24 + 18 + 16 + 6 + 24 + 33 = 142mm (segment-only; bridges/feet add more)
    expect(total).toBeGreaterThan(130);
    expect(total).toBeLessThan(160);
  });
});
