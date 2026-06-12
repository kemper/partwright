import { describe, it, expect } from 'vitest';
import { frameRateAdjustedDamping } from '../../src/renderer/orbitDamping';

const BASE = 0.1;
const REF = 60;

describe('frameRateAdjustedDamping', () => {
  it('is a no-op at the reference frame rate', () => {
    expect(frameRateAdjustedDamping(BASE, 1 / 60, 60)).toBeCloseTo(BASE, 12);
  });

  it('raises the factor when frames are longer (lower fps)', () => {
    // 30 fps -> a frame is 2 reference-frames long, so decay must be 1-(0.9)^2.
    expect(frameRateAdjustedDamping(BASE, 1 / 30, REF)).toBeCloseTo(1 - 0.9 ** 2, 12);
    // 15 fps -> 4 reference-frames long.
    expect(frameRateAdjustedDamping(BASE, 1 / 15, REF)).toBeCloseTo(1 - 0.9 ** 4, 12);
  });

  it('lowers the factor when frames are shorter (higher fps)', () => {
    // 120 fps -> half a reference-frame, so decay is 1-(0.9)^0.5 < base.
    const f = frameRateAdjustedDamping(BASE, 1 / 120, REF);
    expect(f).toBeCloseTo(1 - 0.9 ** 0.5, 12);
    expect(f).toBeLessThan(BASE);
  });

  it('keeps the per-second decay constant across frame rates', () => {
    // Composing the per-frame survival (1-f) over one second of frames must land
    // on the same remaining fraction regardless of how that second is sliced.
    const oneSecond = (fps: number) => {
      const f = frameRateAdjustedDamping(BASE, 1 / fps, REF);
      return (1 - f) ** fps; // survival after `fps` frames == 1 second
    };
    const ref = oneSecond(60);
    expect(oneSecond(30)).toBeCloseTo(ref, 6);
    expect(oneSecond(90)).toBeCloseTo(ref, 6);
    expect(oneSecond(144)).toBeCloseTo(ref, 6);
  });

  it('caps below 1 so a very long frame cannot destabilise the controls', () => {
    // A multi-second frame (tab was backgrounded) would otherwise push the factor
    // to ~1; it must stay strictly under 1.
    expect(frameRateAdjustedDamping(BASE, 5, REF)).toBeLessThanOrEqual(0.9);
    expect(frameRateAdjustedDamping(BASE, 5, REF)).toBeGreaterThan(0);
  });

  it('falls back to base for non-positive / non-finite inputs', () => {
    expect(frameRateAdjustedDamping(BASE, 0, REF)).toBe(BASE);
    expect(frameRateAdjustedDamping(BASE, -1 / 60, REF)).toBe(BASE);
    expect(frameRateAdjustedDamping(BASE, NaN, REF)).toBe(BASE);
    expect(frameRateAdjustedDamping(BASE, 1 / 60, 0)).toBe(BASE);
    expect(frameRateAdjustedDamping(0, 1 / 60, REF)).toBe(0);
  });
});
