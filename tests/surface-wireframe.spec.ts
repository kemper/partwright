// Golden path for the Wireframe / edge-cage surface modifier. Covers the public
// API (applyWireframe → hollow strut cage baked as an ofMesh wrapper), the
// no-sharp-edges error case, and the Surface panel UI wiring (Wireframe tab →
// whole-model Apply).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A chamfered box: lots of sharp feature edges, no smooth surface to confuse the
// crease test.
const BOX = 'const { Manifold } = api;\nreturn Manifold.cube([24, 24, 24], true);';
const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(16, 64);';

test.describe('Wireframe / edge-cage surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('applyWireframe bakes a hollow edge cage from a boxy model', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('wireframe-api');
      await pw.run(code);
      const solidVol = pw.getGeometryData().volume;
      const r = await pw.applyWireframe({ strutRadius: 1, resolution: 96 });
      return { r, stats: pw.getGeometryData(), src: pw.getCode(), solidVol };
    }, [BOX]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('wireframe');
    // Baked to an imported mesh (ofMesh wrapper), not a voxel decode.
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
    expect(result.src).not.toContain('voxels.decode(');
    // A cage of struts has far more triangles than the 12-tri solid cube…
    expect(result.stats.triangleCount).toBeGreaterThan(12);
    // …and is hollow: its volume is a small fraction of the original solid.
    expect(result.stats.volume).toBeLessThan(result.solidVol * 0.5);
    expect(result.stats.volume).toBeGreaterThan(0);
  });

  test('applyWireframe errors on a fully smooth model (no sharp edges to cage)', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('wireframe-smooth');
      await pw.run(code);
      // A high-poly sphere has no creases above the default 25° threshold.
      return await pw.applyWireframe({ strutRadius: 1, resolution: 64 });
    }, [SPHERE]);

    expect(result.ok).toBeUndefined();
    expect(String(result.error)).toMatch(/no sharp feature edges/i);
  });

  test('Surface panel Wireframe tab applies on the whole model', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('wireframe-ui');
      await pw.run(code);
    }, [BOX]);

    // Open the Tools popover, then the Surface panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();

    // Switch to the Wireframe tab and apply (whole-model only — no region UI).
    await page.getByRole('button', { name: 'Wireframe', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 30_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
