// End-to-end tests for the design-for-printing suite, exercised through the real
// WASM geometry pipeline:
//   - the Gridfinity generator builds geometry in the sandbox
//   - checkPrintability reports bed fit on small vs oversized models
//   - scaleModel transforms the live mesh
//   - splitForPrinting cuts an oversized model into pieces
//   - the 🖨 Print overlay panel opens and renders a report
//
// Uses dispatchEvent('click') for overlay buttons to dodge the onboarding tour
// backdrop, matching simplify.spec.ts.

import { test, expect, type Page } from 'playwright/test';

type Geo = { volume?: number; triangleCount?: number; isManifold?: boolean; boundingBox?: { dimensions?: [number, number, number] } };
type PW = {
  run: (code: string) => Promise<Geo>;
  getGeometryData: () => Geo;
  checkPrintability: (opts?: unknown) => { ok?: boolean; bedFit?: { fits: boolean }; checks?: { id: string; level: string }[]; error?: string };
  scaleModel: (opts: unknown) => Promise<{ dimensions?: [number, number, number]; error?: string }>;
  splitForPrinting: (opts?: unknown) => Promise<{ partCount?: number; holeCount?: number; error?: string }>;
  createSession: (name?: string) => Promise<unknown>;
};

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { checkPrintability?: unknown } }).partwright?.checkPrintability,
    { timeout: 20_000 },
  );
}

async function openEditor(page: Page) {
  await page.goto('/editor');
  await waitForEngine(page);
}

const CUBE = (s: number) => `const { Manifold } = api; return Manifold.cube([${s}, ${s}, ${s}], true).translate([0,0,${s / 2}]);`;

test.describe('Print tools', () => {
  test('Gridfinity generator builds real geometry', async ({ page }) => {
    await openEditor(page);
    const geo = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.run('return api.Gridfinity.bin({ cols: 2, rows: 1, heightUnits: 4 });');
    });
    expect(geo.volume ?? 0).toBeGreaterThan(0);
    expect(geo.triangleCount ?? 0).toBeGreaterThan(0);
  });

  test('checkPrintability reports bed fit for small vs oversized models', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.cube([20,20,20], true).translate([0,0,10]);');
      const small = pw.checkPrintability();
      await pw.run('const { Manifold } = api; return Manifold.cube([300,300,300], true).translate([0,0,150]);');
      const big = pw.checkPrintability();
      return { small, big };
    });
    expect(result.small.bedFit?.fits).toBe(true);
    expect(result.small.ok).toBe(true);
    expect(result.big.bedFit?.fits).toBe(false);
    expect(result.big.checks?.find(c => c.id === 'bed')?.level).toBe('fail');
  });

  test('scaleModel doubles the model dimensions', async ({ page }) => {
    await openEditor(page);
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.cube([10,10,10], true).translate([0,0,5]);');
      return pw.scaleModel({ factor: 2, save: false });
    });
    expect(res.dimensions?.[0]).toBeCloseTo(20, 1);
    expect(res.dimensions?.[2]).toBeCloseTo(20, 1);
  });

  test('splitForPrinting cuts an oversized model into pieces', async ({ page }) => {
    await openEditor(page);
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      // 400mm cube far exceeds the default 256mm bed → at least a 2×2 grid.
      await pw.run('const { Manifold } = api; return Manifold.cube([400,400,150], true).translate([0,0,75]);');
      return pw.splitForPrinting({ save: false });
    });
    expect(res.error).toBeUndefined();
    expect(res.partCount ?? 0).toBeGreaterThanOrEqual(2);
  });

  test('the Print panel opens and renders a printability report', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.cube([20,20,20], true).translate([0,0,10]);');
    });

    await page.locator('#print-tools-toggle').dispatchEvent('click');
    await page.waitForSelector('#print-tools-panel:not(.hidden)');
    await expect(page.locator('#print-check-btn')).toBeVisible();

    await page.locator('#print-check-btn').dispatchEvent('click');
    // The report lists individual checks — the watertight one always renders.
    await expect(page.locator('#print-report')).toContainText(/Watertight|print-ready|Printable|blocker/i, { timeout: 10_000 });
  });
});
