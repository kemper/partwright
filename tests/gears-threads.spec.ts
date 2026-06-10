// Exercises every api.gears.* and api.threads.* builder on the real manifold-3d
// WASM kernel. The unit tier (tests/unit/gears.test.ts, threads.test.ts) covers
// the involute math, profile geometry, and mesh topology; this spec proves each
// builder actually produces a valid, watertight manifold with the expected
// component count — catching degenerate booleans the pure-logic tests can't see.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

interface RunResult {
  status: string;
  error?: string;
  isManifold?: boolean;
  componentCount?: number;
  triangleCount?: number;
  boundingBox?: { x: number[]; y: number[]; z: number[]; dimensions: number[] };
}

async function run(page: Page, code: string): Promise<RunResult> {
  return await page.evaluate(async (src) => {
    const pw = (window as unknown as { partwright: { run: (c: string) => Promise<unknown> } }).partwright;
    const r = await pw.run(src) as { geometry?: RunResult } & RunResult;
    return (r.geometry ?? r) as RunResult;
  }, code);
}

// Each case returns a Manifold from a gears/threads builder. `components` is the
// expected connected-component count (a meshing pair is legitimately 2).
const cases: Array<{ name: string; code: string; components?: number }> = [
  { name: 'gears.spur (with bore)', code: `return api.gears.spur({ module: 2, teeth: 18, thickness: 6, bore: 6 });` },
  { name: 'gears.spur (hub, no bore)', code: `return api.gears.spur({ module: 1.5, teeth: 24, thickness: 5, hubDiameter: 10, hubHeight: 4 });` },
  { name: 'gears.spur (helical)', code: `return api.gears.spur({ module: 2, teeth: 16, thickness: 8, helix: 20 });` },
  { name: 'gears.rack', code: `return api.gears.rack({ module: 2, teeth: 8, thickness: 6 });` },
  { name: 'threads.rod (M8)', code: `return api.threads.rod({ size: 'M8', length: 16 });` },
  { name: 'threads.rod (left-handed, no chamfer)', code: `return api.threads.rod({ size: 'M6', length: 12, handed: 'left', chamfer: false });` },
  { name: 'threads.rod (explicit dia/pitch)', code: `return api.threads.rod({ diameter: 10, pitch: 1.5, length: 14 });` },
  { name: 'threads.bolt (hex)', code: `return api.threads.bolt({ size: 'M8', length: 20 });` },
  { name: 'threads.bolt (socket + shank)', code: `return api.threads.bolt({ size: 'M6', length: 16, headType: 'socket', shank: 4 });` },
  { name: 'threads.nut (M8)', code: `return api.threads.nut({ size: 'M8' });` },
];

test.describe('gears & threads builders produce valid manifolds', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  for (const c of cases) {
    test(`${c.name} is a valid manifold`, async ({ page }) => {
      const r = await run(page, c.code);
      if (r.status === 'error') throw new Error(`${c.name} failed:\n${r.error}`);
      expect(r.isManifold, `${c.name} should be watertight`).toBe(true);
      expect(r.componentCount, `${c.name} component count`).toBe(c.components ?? 1);
      expect(r.triangleCount ?? 0).toBeGreaterThan(0);
    });
  }

  test('gears.pair meshes as two separate components', async ({ page }) => {
    const r = await run(page, `
      const p = api.gears.pair({ module: 2, teeth1: 12, teeth2: 24, thickness: 6, bore1: 5, bore2: 8 });
      return api.labeledUnion([
        { name: 'pinion', shape: p.pinion },
        { name: 'gear', shape: p.gear },
      ]);
    `);
    if (r.status === 'error') throw new Error(`pair failed:\n${r.error}`);
    expect(r.isManifold).toBe(true);
    // The two gears mesh without fusing: they stay distinct components.
    expect(r.componentCount).toBe(2);
    // The 24-tooth gear is centred at +X by the centre distance (36mm).
    expect(r.boundingBox!.x[1]).toBeGreaterThan(50);
  });

  test('bad thread size throws a clear, self-correcting error', async ({ page }) => {
    const r = await run(page, `return api.threads.rod({ size: 'M7', length: 5 });`);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/unknown size/i);
  });
});
