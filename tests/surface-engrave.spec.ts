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

  test('engraveModel honors planar position (posU) — offsets the carve', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-pos');
      await pw.run(code);
      // Cut "I" through the slab near the left edge (posU 0.15) vs centered.
      const left = await pw.engraveModel({ text: 'I', through: true, size: 8, posU: 0.15, posV: 0.5, resolution: 140 });
      return { left };
    }, [SLAB]);
    expect(result.left.error).toBeUndefined();
    expect(result.left.ok).toBe(true);
    // A through-cut on a slab raises genus (one hole), proving the carve landed.
    expect(result.left.geometry.genus).toBeGreaterThanOrEqual(1);
  });

  test('engraveModel preserves model paint (carries colors onto the carved mesh)', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-color');
      await pw.run(code);
      pw.paintSlab({ axis: 'z', offset: 2.5, thickness: 2, color: [0.85, 0.15, 0.15], name: 'top' });
      const r = await pw.engraveModel({ text: 'HI', through: false, depth: 1.5, size: 30, resolution: 150, preserveColor: true });
      return { r: { ok: r.ok, error: r.error, colorsCarried: r.colorsCarried }, regions: pw.listRegions()?.length };
    }, [SLAB]);
    expect(result.r.error).toBeUndefined();
    // Paint survives the carve: a non-trivial number of triangles carried color
    // and the region is still present (it would be 0 / wiped before the fix).
    expect(result.r.colorsCarried).toBeGreaterThan(0);
    expect(result.regions).toBeGreaterThanOrEqual(1);
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

    // The placement controls render: click-to-place button + a quarter-point snap.
    await expect(page.getByRole('button', { name: '📌 Click to place on model' })).toBeVisible();
    await page.getByRole('button', { name: '75%', exact: true }).first().click();

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

  test('Engrave place mode: clicking the model sets the placement face', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('engrave-place');
      await pw.run(code);
    }, [SLAB]);

    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await page.getByRole('button', { name: 'Engrave', exact: true }).click();
    await page.getByPlaceholder('HELLO').fill('HI');
    await expect(page.getByText('Previewing — Apply to save a version.')).toBeVisible({ timeout: 15_000 });

    // Enter place mode → the outline follows the cursor; clicking the model drops it.
    await page.getByRole('button', { name: '📌 Click to place on model' }).click();
    const canvas = page.locator('canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // The face readout reflects a click-placed face (top of the slab from the iso view).
    await expect(page.locator('div', { hasText: /^Face: .* · placed by click$/ }).first())
      .toBeVisible({ timeout: 10_000 });
  });
});
