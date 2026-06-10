// Golden path for the Lattice-infill surface modifier. Covers the public API
// (applyInfill → smooth manifold-js mesh with a TPMS lattice interior) and the
// Surface panel UI wiring (Lattice infill tab → whole-model Apply bakes an
// ofMesh wrapper).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(18, 48);';

test.describe('Lattice infill surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('applyInfill (gyroid) bakes a smooth manifold-js skin + lattice', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('infill-gyroid');
      await pw.run(code);
      const r = await pw.applyInfill({ pattern: 'gyroid', cellSize: 9, wallThickness: 1.6, skinThickness: 1.6, resolution: 110 });
      return { r, stats: pw.getGeometryData(), src: pw.getCode() };
    }, [SPHERE]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('lattice infill');
    // Default output stays on manifold-js (ofMesh wrapper, NOT a voxel decode).
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
    expect(result.src).not.toContain('voxels.decode(');
    expect(result.src).toContain('gyroid');
    // Skin + interior lattice → many more triangles than the bare sphere, and a
    // perforated interior pushes the genus well above 0.
    expect(result.stats.triangleCount).toBeGreaterThan(200);
    expect(result.stats.genus).toBeGreaterThan(3);
    // Baked at the model's true scale (sphere radius 18 → bbox ~±18).
    expect(result.stats.boundingBox.x[1]).toBeLessThan(22);
  });

  test('honeycomb pattern is accepted', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('infill-honeycomb');
      await pw.run(code);
      const r = await pw.applyInfill({ pattern: 'honeycomb', cellSize: 10, wallThickness: 1.8, skinThickness: 1.8, resolution: 100 });
      return { r, src: pw.getCode() };
    }, [SPHERE]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.src).toContain('honeycomb');
  });

  test('Surface panel Lattice infill tab applies on the whole model', async ({ page }) => {
    test.setTimeout(90_000); // the continuous-field bake takes several seconds
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('infill-ui');
      await pw.run(code);
    }, [SPHERE]);

    // Open the Tools popover, then the Surface panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();

    // Switch to the Lattice infill tab and apply to the whole model.
    await page.getByRole('button', { name: 'Lattice infill', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    // Apply saves a new version that bakes the lattice mesh (the continuous-field
    // bake is a few seconds, so allow a generous window).
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 70_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
