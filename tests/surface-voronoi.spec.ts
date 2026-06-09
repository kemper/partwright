// Golden path for the Voronoi-shell surface modifier. Covers the public API
// (applyVoronoiShell → watertight single-component mesh) and the Surface panel
// UI wiring (Voronoi tab → whole-model Apply bakes an ofMesh wrapper).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(18, 48);';

test.describe('Voronoi shell surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('applyVoronoiShell bakes a watertight, single-component cell relief', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('voronoi-api');
      await pw.run(code);
      const r = await pw.applyVoronoiShell({ cellSize: 6, wallWidth: 0.18, amplitude: 1.5 });
      return { r, stats: pw.getGeometryData(), src: pw.getCode() };
    }, [SPHERE]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('voronoi shell');
    // Relief texture preserves topology: still one watertight solid.
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBe(1);
    // Subdivided + baked to an imported mesh.
    expect(result.stats.triangleCount).toBeGreaterThan(12);
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('engraved variant recesses the walls (stays within the original bounds)', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('voronoi-engraved');
      await pw.run(code);
      const before = pw.getGeometryData().boundingBox;
      const r = await pw.applyVoronoiShell({ cellSize: 6, wallWidth: 0.22, amplitude: 1.5, raised: false });
      const after = pw.getGeometryData().boundingBox;
      return { r, before, after };
    }, [SPHERE]);

    expect(result.r.error).toBeUndefined();
    // Engraving carves inward, so the model never grows past the original radius.
    expect(result.after.x[1]).toBeLessThanOrEqual(result.before.x[1] + 0.05);
  });

  test('Surface panel Voronoi tab applies on the whole model', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('voronoi-ui');
      await pw.run(code);
    }, [SPHERE]);

    // Open the Tools popover, then the Surface panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();

    // Switch to the Voronoi tab and apply to the whole model.
    await page.getByRole('button', { name: 'Voronoi', exact: true }).click();
    await page.getByRole('button', { name: 'Whole model', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    // Apply saves a new version that bakes the textured mesh.
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 30_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
