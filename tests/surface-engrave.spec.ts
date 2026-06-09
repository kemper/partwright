// Golden path for the Engrave / cut-through surface modifier. Covers the public
// API (engraveModel → recessed channels vs holes through the wall) and the
// Surface panel UI wiring (Engrave tab → text → Apply bakes an ofMesh wrapper).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A slab to label / perforate.
const SLAB = 'const { Manifold } = api;\nreturn Manifold.cube([60, 24, 6], true);';

test.describe('Engrave / cut-through surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('engraveModel (recess) carves channels and stays a single watertight solid', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-recess');
      await pw.run(code);
      const before = pw.getGeometryData();
      const r = await pw.engraveModel({ text: 'HELLO', through: false, depth: 2, size: 48, axis: 'z', side: 'max', resolution: 160 });
      return { r, before, after: pw.getGeometryData(), src: pw.getCode() };
    }, [SLAB]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('engrave');
    // A recess removes material but doesn't perforate: still one watertight solid.
    expect(result.after.isManifold).toBe(true);
    expect(result.after.componentCount).toBe(1);
    // Material was removed (volume shrank) and the mesh was baked via ofMesh.
    expect(result.after.volume).toBeLessThan(result.before.volume);
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('engraveModel (cut-through) perforates the wall — genus rises, stays manifold', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-through');
      await pw.run(code);
      const r = await pw.engraveModel({ text: 'OXO', through: true, size: 44, axis: 'z', side: 'max', resolution: 180 });
      return { r, stats: pw.getGeometryData() };
    }, [SLAB]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.label).toBe('engrave (cut through)');
    // Holes through the slab → manifold, single piece, genus jumps above 0.
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBe(1);
    expect(result.stats.genus).toBeGreaterThan(1);
  });

  test('engraveModel rejects an empty request', async ({ page }) => {
    const r = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-empty');
      await pw.run(code);
      return await pw.engraveModel({});
    }, [SLAB]);
    expect(r.error).toBeTruthy();
  });

  test('Surface panel Engrave tab carves typed text into the model', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-ui');
      await pw.run(code);
    }, [SLAB]);

    // Open the Tools popover, then the Surface panel, then the Engrave tab.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();
    await page.getByRole('button', { name: 'Engrave', exact: true }).click();

    // Type text → the mask rasterizes (async) → the preview kicks in. Wait for
    // that before Apply, since Apply no-ops until a stamp exists.
    await page.getByPlaceholder('HELLO').fill('HI');
    await expect(page.getByText('Previewing — Apply to save a version.')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Apply', exact: true }).click();

    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 30_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
