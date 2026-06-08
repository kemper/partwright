// Exercises every api.printFit.* builder on the real manifold-3d WASM kernel.
// The unit tier (tests/unit/printFit.test.ts) covers the fastener table and
// profile math; this spec proves each builder actually produces a valid,
// watertight, single-component manifold — catching degenerate booleans the
// pure-logic tests can't see.

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

// Each case returns a single Manifold from a printFit builder. `multi` cases
// are tools that legitimately overlap themselves but should still be 1 piece.
const cases: Array<{ name: string; code: string; maxComponents?: number }> = [
  { name: 'screwHole (socket head)', code: `return api.printFit.screwHole({ size: 'M3', length: 12, head: 'socket' });` },
  { name: 'screwHole (countersunk)', code: `return api.printFit.screwHole({ size: 'M4', length: 10, head: 'countersunk' });` },
  { name: 'screwHole (through, no head)', code: `return api.printFit.screwHole({ size: 'M5', length: 8, head: 'none', through: true });` },
  { name: 'insertBoss (M3)', code: `return api.printFit.insertBoss({ size: 'M3' });` },
  { name: 'insertBoss (custom wall/height)', code: `return api.printFit.insertBoss({ size: 'M4', height: 12, wall: 3, taper: false });` },
  { name: 'nutPocket (plain)', code: `return api.printFit.nutPocket({ size: 'M3' });` },
  { name: 'nutPocket (captive)', code: `return api.printFit.nutPocket({ size: 'M3', captive: true });` },
  { name: 'pin', code: `return api.printFit.pin({ diameter: 5, length: 10 });` },
  { name: 'socket', code: `return api.printFit.socket({ diameter: 5, depth: 8, fit: 'normal' });` },
  { name: 'dovetail.tail', code: `return api.printFit.dovetail({ length: 30, width: 10 }).tail;` },
  { name: 'dovetail.socket', code: `return api.printFit.dovetail({ length: 30, width: 10, fit: 'loose' }).socket;` },
  { name: 'snapFit.clip', code: `return api.printFit.snapFit({ width: 8, length: 14 }).clip;` },
  { name: 'snapFit.clip (rounded)', code: `return api.printFit.snapFit({ width: 8, length: 14, rounded: true }).clip;` },
  { name: 'snapFit.catch', code: `return api.printFit.snapFit({ width: 8, length: 14 }).catch;` },
  { name: 'clearanceCoupon', code: `return api.printFit.clearanceCoupon({ size: 'M3' });`, maxComponents: 1 },
];

// A realistic assembly: a plate with a counterbored screw hole subtracted and
// an insert boss unioned — the kind of composition the AI will write.
const assembly = `
  const plate = api.Manifold.cube([40, 30, 6], false).translate([-20, -15, 0]);
  const hole = api.printFit.screwHole({ size: 'M3', length: 6, head: 'socket' }).translate([-12, 0, 6]);
  const boss = api.printFit.insertBoss({ size: 'M3', height: 8 }).translate([12, 0, 6]);
  return plate.subtract(hole).add(boss);
`;

test.describe('printFit builders produce valid manifolds', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  for (const c of cases) {
    test(`${c.name} is a single-component manifold`, async ({ page }) => {
      const r = await run(page, c.code);
      if (r.status === 'error') throw new Error(`${c.name} failed:\n${r.error}`);
      expect(r.isManifold, `${c.name} should be watertight`).toBe(true);
      expect(r.componentCount, `${c.name} component count`).toBeLessThanOrEqual(c.maxComponents ?? 1);
      expect(r.triangleCount ?? 0).toBeGreaterThan(0);
    });
  }

  test('plate + counterbored hole + insert boss assembles cleanly', async ({ page }) => {
    const r = await run(page, assembly);
    if (r.status === 'error') throw new Error(`assembly failed:\n${r.error}`);
    expect(r.isManifold).toBe(true);
    expect(r.componentCount).toBe(1);
    // The boss rises above the 6mm plate.
    expect(r.boundingBox!.z[1]).toBeGreaterThan(6);
  });

  test('bad size throws a clear, self-correcting error', async ({ page }) => {
    const r = await run(page, `return api.printFit.screwHole({ size: 'M99', length: 5 });`);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/unknown fastener size/i);
  });
});

test.describe('printFit articulation (print-in-place)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('ballJoint captures two parts as free components', async ({ page }) => {
    const r = await run(page, `
      const { Manifold, printFit } = api;
      const j = printFit.ballJoint({ diameter: 8, fit: 'normal' });
      const lower = Manifold.cube([20, 20, 6], true).translate([0, 0, -9]).add(j.ball);
      const upper = Manifold.cube([20, 20, 12], true).translate([0, 0, 6]).subtract(j.socket);
      return lower.add(upper);
    `);
    if (r.status === 'error') throw new Error(`ballJoint failed:\n${r.error}`);
    expect(r.isManifold).toBe(true);
    expect(r.componentCount).toBe(2);
  });

  test('flexi slices a bar into N free links', async ({ page }) => {
    const r = await run(page, `
      const { Manifold, printFit } = api;
      const bar = Manifold.cylinder(60, 6, 6, 64).rotate([0, 90, 0]); // along X
      return printFit.flexi(bar, { segments: 6, axis: 'x', fit: 'normal' });
    `);
    if (r.status === 'error') throw new Error(`flexi failed:\n${r.error}`);
    expect(r.isManifold).toBe(true);
    expect(r.componentCount, 'flexi should decompose into one component per segment').toBe(6);
  });

  test('flexi works along the default Z axis too', async ({ page }) => {
    const r = await run(page, `
      const { Manifold, printFit } = api;
      const tube = Manifold.cylinder(50, 5, 5, 48);
      return printFit.flexi(tube, { segments: 4 });
    `);
    if (r.status === 'error') throw new Error(`flexi(Z) failed:\n${r.error}`);
    expect(r.isManifold).toBe(true);
    expect(r.componentCount).toBe(4);
  });

  test('flexi rejects a non-Manifold first argument', async ({ page }) => {
    const r = await run(page, `return api.printFit.flexi({ not: 'a solid' }, { segments: 3 });`);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/must be a Manifold/i);
  });

  test('flexi rejects segments < 2', async ({ page }) => {
    const r = await run(page, `
      const bar = api.Manifold.cylinder(20, 4, 4, 32);
      return api.printFit.flexi(bar, { segments: 1 });
    `);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/segments/i);
  });
});
