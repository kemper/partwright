// Golden path for the "Place on plate" tools (drop-to-floor / center on plate).
// Covers both write-back modes end to end through the console API, plus the
// viewport panel button, and the no-op short-circuit when already positioned.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A cube floating well above the bed and off the XY origin.
const FLOATING_CUBE = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10]).translate([5, 5, 30]);';

test.describe('Place on plate', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('parametric drop + center grounds the model and keeps editable code', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-parametric');
      await pw.run(code);
      const before = pw.getGeometryData().boundingBox;
      const placed = await pw.placeModel({ dropToFloor: true, centerX: true, centerY: true, mode: 'parametric' });
      const after = pw.getGeometryData().boundingBox;
      return { before, placed, after, parametric: pw.canPlaceParametric(), src: pw.getCode() };
    }, [FLOATING_CUBE]);

    expect(result.before?.z?.[0]).toBeCloseTo(30, 1);
    expect(result.placed.error).toBeUndefined();
    expect(result.placed.mode).toBe('parametric');
    // Floor on Z=0, centered on XY.
    expect(result.after?.z?.[0]).toBeCloseTo(0, 2);
    const cx = ((result.after!.x![0] + result.after!.x![1]) / 2);
    const cy = ((result.after!.y![0] + result.after!.y![1]) / 2);
    expect(cx).toBeCloseTo(0, 2);
    expect(cy).toBeCloseTo(0, 2);
    // Code stayed parametric (wrapped + translated), not baked to a mesh.
    expect(result.src).toContain('@partwright-placement');
    expect(result.src).toContain('Manifold.cube([10, 10, 10])');
    expect(result.src).not.toContain('Manifold.ofMesh');
  });

  test('bake mode grounds the model and flattens to an imported mesh', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-bake');
      await pw.run(code);
      const placed = await pw.placeModel({ dropToFloor: true, mode: 'bake' });
      return { placed, after: pw.getGeometryData().boundingBox, src: pw.getCode() };
    }, [FLOATING_CUBE]);

    expect(result.placed.error).toBeUndefined();
    expect(result.after?.z?.[0]).toBeCloseTo(0, 2);
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('re-dropping an already-grounded model is a no-op', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-noop');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10]);'); // already on Z=0
      return pw.placeModel({ dropToFloor: true, mode: 'parametric' });
    });
    expect(result.error).toBeUndefined();
    expect(result.noop).toBe(true);
  });

  test('viewport Place panel drops the model to the floor', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-ui');
      await pw.run(code);
    }, [FLOATING_CUBE]);

    // Open the Tools popover, then the Place panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#place-viewport-toggle').click();
    await expect(page.getByText('Place on plate')).toBeVisible();

    await page.getByRole('button', { name: /Drop to floor/i }).click();

    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getGeometryData().boundingBox?.z?.[0]),
    ).toBeCloseTo(0, 1);
  });
});
