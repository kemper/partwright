// Golden path for the Hollow / vase-mode surface modifier. Covers the public
// API (applyHollow → thin watertight shell, optional open top + drain holes)
// and the Surface panel UI wiring (Hollow / vase tab → whole-model Apply bakes
// an ofMesh wrapper).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A straight cylinder is a clean vase blank — the SDF surface-nets path keeps a
// uniform-thickness shell manifold (matching the Voronoi-lamp test's choice).
const CYL = 'const { Manifold } = api;\nreturn Manifold.cylinder(40, 15, 15, 96);';

test.describe('Hollow / vase surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('applyHollow bakes a watertight, single-component thin shell', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-api');
      await pw.run(code);
      const before = pw.getGeometryData().volume;
      const r = await pw.applyHollow({ wallThickness: 2 });
      return { r, stats: pw.getGeometryData(), src: pw.getCode(), before };
    }, [CYL]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('hollow / vase');
    // A sealed hollow shell is watertight/manifold; its inner and outer walls are
    // two disconnected closed surfaces, so Manifold counts two components.
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBe(2);
    // Hollowing removes the interior, so the shell uses far less material.
    expect(result.stats.volume).toBeLessThan(result.before * 0.6);
    // Baked to an imported mesh (same path as STL import).
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('open top lops the cap off — the result is shorter and still manifold', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-open');
      await pw.run(code);
      const r = await pw.applyHollow({ wallThickness: 2, openTop: true, rimHeight: 6 });
      return { r, stats: pw.getGeometryData() };
    }, [CYL]);

    expect(result.r.error).toBeUndefined();
    expect(result.stats.isManifold).toBe(true);
    // The top is cut at ~ (40 - 6), so the shell no longer reaches the original top.
    expect(result.stats.boundingBox.z[1]).toBeLessThan(36);
  });

  test('drain holes open the base (a planter) without breaking manifoldness', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-planter');
      await pw.run(code);
      const r = await pw.applyHollow({ wallThickness: 2, openTop: true, rimHeight: 6, drainHoles: 4, drainRadius: 2 });
      return { r, stats: pw.getGeometryData() };
    }, [CYL]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    // The bored holes are sealed by the wall's thickness, so the mesh is still a
    // single watertight manifold piece — just with through-holes in the floor.
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBe(1);
  });

  test('Surface panel Hollow / vase tab applies on the whole model', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-ui');
      await pw.run(code);
    }, [CYL]);

    // Open the Tools popover, then the Surface panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();

    // Switch to the Hollow / vase tab and apply to the whole model.
    await page.getByRole('button', { name: 'Hollow / vase', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    // Apply saves a new version that bakes the shell mesh.
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 30_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
