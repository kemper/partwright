import { describe, it, expect } from 'vitest';
import { FIT_DIMS, DEFAULT_FIT, applyDims, startValues, humanCode, fitCoordinateDescent, shiftedIoU, fitSilhouetteIoU } from '../../src/human/humanFit';

describe('human fit', () => {
  it('writes each dimension at its path, mirrors the leg spread, and keeps the base', () => {
    const dims = ['weight', 'hips', 'armL', 'legSpread'].map((k) => FIT_DIMS[k]);
    const o = applyDims({ hair: 'bob', body: { age: 30 } }, dims, [0.7, -0.4, 45, 10]) as { hair: string; body: object; morphs: Record<string, number>; pose: Record<string, { raiseSide: number }> };
    expect(o.hair).toBe('bob');
    expect(o.body).toEqual({ age: 30, weight: 0.7 });
    expect(o.morphs['hip-scale-horiz']).toBe(-0.4);
    expect(o.pose.armL.raiseSide).toBe(45);
    expect(o.pose.legL.raiseSide).toBe(10);
    expect(o.pose.legR.raiseSide).toBe(10);
    expect(humanCode(o)).toMatch(/^return api\.human\(\{/);
  });

  it('starts from the base options where they set a value', () => {
    const dims = DEFAULT_FIT.map((k) => FIT_DIMS[k]);
    const v = startValues({ body: { gender: 0.2 } }, dims);
    expect(v[DEFAULT_FIT.indexOf('gender')]).toBe(0.2);
    expect(v[DEFAULT_FIT.indexOf('weight')]).toBe(FIT_DIMS.weight.start);
  });

  it('coordinate descent finds the optimum of a bounded bowl', async () => {
    const dims = [FIT_DIMS.weight, FIT_DIMS.vShape, FIT_DIMS.armL];
    const target = [0.8, -0.3, 40];
    const score = async (x: number[]) => -((x[0] - target[0]) ** 2 + (x[1] - target[1]) ** 2 + ((x[2] - target[2]) / 100) ** 2);
    const r = await fitCoordinateDescent(dims, [0.5, 0, 8], score, { budget: 200 });
    expect(r.values[0]).toBeCloseTo(0.8, 1);
    expect(r.values[1]).toBeCloseTo(-0.3, 1);
    expect(Math.abs(r.values[2] - 40)).toBeLessThan(3);
    expect(r.evaluations).toBeLessThanOrEqual(200);
  });

  it('shiftedIoU re-aligns a silhouette that moved sideways', () => {
    const W = 20, H = 10;
    const box = (x0: number) => { const m = new Int32Array(W * H).fill(-2); for (let y = 2; y < 8; y++) for (let x = x0; x < x0 + 6; x++) m[y * W + x] = 0; return m; };
    expect(shiftedIoU(box(4), box(8), W, H, 0)).toBeLessThan(0.3);
    expect(shiftedIoU(box(4), box(8), W, H, 5)).toBe(1);
  });

  it('fitSilhouetteIoU scores a photo-match debug result, forgiving a small sideways offset', () => {
    const W = 100, H = 50;
    const box = (x0: number) => { const m = new Int32Array(W * H).fill(-2); for (let y = 10; y < 40; y++) for (let x = x0; x < x0 + 20; x++) m[y * W + x] = 0; return m; };
    expect(fitSilhouetteIoU({ width: W, height: H, photo: box(40), model: box(45) })).toBe(1);
    expect(fitSilhouetteIoU({ width: W, height: H, photo: box(10), model: box(70) })).toBe(0);
  });
});
