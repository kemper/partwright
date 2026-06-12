// Golden path for the Resize panel's "Fit to print bed" action: a small model
// scaled up uniformly until its most-constraining axis touches the configured
// build volume, committed through the existing scale (bake) path.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A 20×10×10 box: fitting it into the default 256³ bed scales by 256/20 = 12.8×,
// so the longest axis lands on 256 and the others stay proportional.
const SMALL_BOX = 'const { Manifold } = api;\nreturn Manifold.cube([20, 10, 10]);';

test.describe('Resize — fit to bed', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('fits a small model to the build volume and bakes the scaled mesh', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('fit-bed');
      await pw.run(code);
    }, [SMALL_BOX]);

    // Open the Tools popover, then the Resize panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#resize-viewport-toggle').click();
    await expect(page.getByText('Resize model')).toBeVisible();

    await page.getByRole('button', { name: /Fit to print bed/i }).click();
    await page.getByRole('button', { name: /^Apply$/ }).click();

    // The longest axis (X) should land on the 256 mm default bed.
    await expect.poll(async () => page.evaluate(() => {
      const bb = (window as unknown as { partwright: any }).partwright.getGeometryData().boundingBox;
      return bb.x[1] - bb.x[0];
    })).toBeCloseTo(256, 0);

    // Proportions preserved: Y/Z stay half of X (started 10 vs 20).
    const dims = await page.evaluate(() => {
      const bb = (window as unknown as { partwright: any }).partwright.getGeometryData().boundingBox;
      return { y: bb.y[1] - bb.y[0], z: bb.z[1] - bb.z[0] };
    });
    expect(dims.y).toBeCloseTo(128, 0);
    expect(dims.z).toBeCloseTo(128, 0);
  });

  test('scaleModel keeps a manifold-js model parametric (wraps the code in .scale)', async ({ page }) => {
    const out = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('scale-parametric');
      await pw.run(code);
      const res = await pw.scaleModel(2, 2, 2, { mode: 'auto' });
      const bb = pw.getGeometryData().boundingBox;
      return { mode: res.mode, code: pw.getCode(), x: bb.x[1] - bb.x[0] };
    }, [SMALL_BOX]);

    // 'auto' on manifold-js stays parametric: the source is wrapped, not baked.
    expect(out.mode).toBe('parametric');
    expect(out.code).toContain('.scale([2, 2, 2])');
    // And the geometry actually doubled (20 → 40 on X).
    expect(out.x).toBeCloseTo(40, 0);
  });
});
