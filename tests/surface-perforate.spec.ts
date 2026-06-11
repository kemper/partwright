// Golden path for the perforated-lattice surface modifier (the regular-pattern
// sibling of the Voronoi lamp). Covers the public API (applyPerforatedLattice →
// a watertight, see-through strut shell on each pattern) and the Surface panel
// UI wiring (Perforate tab → whole-model Apply bakes an ofMesh wrapper).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

const CYL = 'const { Manifold } = api;\nreturn Manifold.cylinder(40, 15, 15, 64);';
const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(18, 48);';

test.describe('Perforated lattice surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('applyPerforatedLattice (hex) bakes a smooth, perforated manifold shell', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('perforate-hex');
      await pw.run(code);
      const r = await pw.applyPerforatedLattice({ pattern: 'hex', cellSize: 9, wallThickness: 2.5, strutWidth: 0.32, resolution: 120 });
      return { r, stats: pw.getGeometryData(), src: pw.getCode() };
    }, [CYL]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('perforated lattice');
    // Stays on manifold-js (ofMesh wrapper, NOT a voxel decode).
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
    expect(result.src).not.toContain('voxels.decode(');
    // A real see-through shell with windows cut through: watertight/manifold and
    // high genus (many holes). A thin web can fuse into a few edge-joined islands.
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBeGreaterThanOrEqual(1);
    expect(result.stats.genus).toBeGreaterThan(5);
    // Baked at the model's true scale (cylinder radius 15 → bbox < 20).
    expect(result.stats.boundingBox.x[1]).toBeLessThan(20);
  });

  test('all three patterns open windows (genus > 0)', async ({ page }) => {
    for (const pattern of ['square', 'triangle'] as const) {
      const r = await page.evaluate(async ([code, pat]) => {
        const pw = (window as unknown as { partwright: any }).partwright;
        await pw.createSession(`perforate-${pat}`);
        await pw.run(code);
        const res = await pw.applyPerforatedLattice({ pattern: pat, cellSize: 8, wallThickness: 2.5, strutWidth: 0.3, resolution: 110 });
        return { res, stats: pw.getGeometryData() };
      }, [SPHERE, pattern] as const);
      expect(r.res.error).toBeUndefined();
      expect(r.stats.isManifold).toBe(true);
      expect(r.stats.genus).toBeGreaterThan(2);
    }
  });

  test('Surface panel Perforate tab applies on the whole model', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('perforate-ui');
      await pw.run(code);
    }, [SPHERE]);

    // Open the Tools popover, then the Surface panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();

    // Switch to the Perforate tab and apply (whole-model only — no region UI).
    await page.getByRole('button', { name: 'Perforate', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    // Apply saves a new version that bakes the perforated mesh.
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 30_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
