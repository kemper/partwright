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
  splitForPrinting: (opts?: unknown) => Promise<{ partCount?: number; holeCount?: number; connectorCount?: number; notes?: string[]; parts?: { count: number }; error?: string }>;
  splitAlongPlane: (opts: unknown) => Promise<{ partCount?: number; connectorCount?: number; parts?: { count: number }; error?: string }>;
  createSession: (name?: string) => Promise<unknown>;
  listParts: () => Promise<{ id: string; name: string }[]>;
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

  test('auto split honours the connector type (regression: type was being collapsed to dowel)', async ({ page }) => {
    await openEditor(page);
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const oversized = 'const { Manifold } = api; return Manifold.cube([400,400,80], true).translate([0,0,40]);';
      await pw.run(oversized);
      const dowel = await pw.splitForPrinting({ connector: { type: 'dowel', diameter: 6, count: 2 }, save: false });
      await pw.run(oversized);
      const dovetail = await pw.splitForPrinting({ connector: { type: 'dovetail', width: 16, count: 2 }, save: false });
      await pw.run(oversized);
      const screw = await pw.splitForPrinting({ connector: { type: 'screw', diameter: 4, count: 2 }, save: false });
      return { dowel, dovetail, screw };
    });
    expect(res.dowel.error).toBeUndefined();
    expect(res.dovetail.error).toBeUndefined();
    expect(res.screw.error).toBeUndefined();
    // The notes label each connector by its requested type — proves the type isn't being collapsed.
    expect((res.dowel.notes ?? []).join(' ')).toMatch(/dowel/i);
    expect((res.dovetail.notes ?? []).join(' ')).toMatch(/dovetail/i);
    expect((res.screw.notes ?? []).join(' ')).toMatch(/screw/i);
  });

  test('splitAlongPlane cuts a model in two with a dovetail connector', async ({ page }) => {
    await openEditor(page);
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.cube([60,40,30], true).translate([0,0,15]);');
      // Vertical plane through the centre (normal +X), dovetail key.
      return pw.splitAlongPlane({ plane: { point: [0, 0, 15], normal: [1, 0, 0] }, connector: { type: 'dovetail', width: 12 }, count: 1, save: false });
    });
    expect(res.error).toBeUndefined();
    expect(res.partCount).toBe(2);
  });

  test('splitForPrinting emits a part per chunk into the session', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('split-parts-test');
      await pw.run('const { Manifold } = api; return Manifold.cube([400,400,80], true).translate([0,0,40]);');
      const before = (await pw.listParts()).length;
      const r = await pw.splitForPrinting({ connector: { type: 'pin' } });
      const after = (await pw.listParts()).length;
      return { partCount: r.partCount ?? 0, before, after };
    });
    expect(result.partCount).toBeGreaterThanOrEqual(2);
    // Original part preserved + one new part per chunk.
    expect(result.after).toBe(result.before + result.partCount);
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

  test('the Print panel split button cuts an oversized model into parts', async ({ page }) => {
    await openEditor(page);
    const before = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('panel-split-test');
      await pw.run('const { Manifold } = api; return Manifold.cube([400,400,80], true).translate([0,0,40]);');
      return (await pw.listParts()).length;
    });

    await page.locator('#print-tools-toggle').dispatchEvent('click');
    await page.waitForSelector('#print-tools-panel:not(.hidden)');
    // Plane-mode toggle exists (interactive gizmo path).
    await expect(page.locator('#print-split-plane')).toBeVisible();

    await page.locator('#print-split-btn').dispatchEvent('click'); // default: auto fit-bed
    await expect(page.locator('#print-tools-panel')).toContainText(/Split into \d+ part/i, { timeout: 15_000 });

    const after = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return (await pw.listParts()).length;
    });
    expect(after).toBeGreaterThan(before);
  });
});
