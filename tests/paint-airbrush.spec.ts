// Geodesic airbrush: sprays a soft speckle whose edge fades out via a
// stochastic per-triangle dither (NOT colour blending — every triangle is
// painted fully or not, so the result stays one printable colour per triangle).
// It's a coverage mode of the geodesic brush, so it follows the surface and
// never bleeds through a thin/hollow wall. Driven through paintAirbrush (same
// path as the UI spray).

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 10], true);`);
  });
}

test.describe('geodesic airbrush', () => {
  test('paintAirbrush sprays a region, subdivides for speckle, light by default', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh().numTri;
      const r = pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, seed: 1, color: [0.9, 0.2, 0.2] });
      return { r, before, after: pw.getMesh().numTri, regions: pw.listRegions().length };
    });
    expect(out.r.error).toBeFalsy();
    expect(out.r.strength).toBe(0.4);              // light spackle by default
    expect(out.r.triangles).toBeGreaterThan(0);
    expect(out.after).toBeGreaterThan(out.before); // feather refined for fine speckle
    expect(out.regions).toBe(1);
  });

  test('higher strength covers strictly more (fixed seed → superset, non-flaky)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const spray = (strength: number) => {
        pw.clearColors();
        return pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, strength, softness: 0.5, seed: 1, maxEdge: 0.2, color: [1, 0, 0] }).triangles;
      };
      return { light: spray(0.3), heavy: spray(0.9) };
    });
    expect(out.light).toBeGreaterThan(0);
    expect(out.heavy).toBeGreaterThan(out.light);
  });

  test('geodesic: the spray stays on the surface (no bleed through a thin wall)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Thin plate: top z=1, bottom z=-1. A radius-6 spray at the top centre
      // must stay on the top (the bottom is a disconnected wall).
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 2], true);`);
      pw.paintAirbrush({ points: [[0, 0, 1]], radius: 6, strength: 1, softness: 0.5, seed: 1, color: [1, 0, 0] });
      return pw.listRegions()[0].bbox;
    });
    expect(out.min[2]).toBeGreaterThan(0); // nothing sprayed onto the back face
  });

  test('the speckle is deterministic across save + reload', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('airbrush-persist');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      pw.paintAirbrush({ points: [[0, 0, 2]], radius: 5, strength: 0.6, softness: 0.5, seed: 3, maxEdge: 0.3, color: [0.2, 0.7, 1] });
      const paintedColored = pw.listRegions()[0].triangles;
      const sv = await pw.runAndSave(pw.getCode(), 'airbrush-v');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      await pw.loadVersion({ index: sv.version.index });
      return { paintedColored, reloadedColored: pw.listRegions()[0]?.triangles ?? 0, regions: pw.listRegions().length };
    });
    expect(out.paintedColored).toBeGreaterThan(0);
    expect(out.reloadedColored).toBe(out.paintedColored); // same speckle reproduced
    expect(out.regions).toBe(1);
  });

  test('overlapping sprays survive save + reload identically (multi-stroke determinism)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('airbrush-multi');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      // Two overlapping sprays — the second appends onto the mesh the first
      // already refined; reload replays both from the base. The dither keys off
      // refined centroids, so both paths must converge.
      pw.paintAirbrush({ points: [[-3, 0, 2]], radius: 5, strength: 0.6, softness: 0.5, seed: 2, maxEdge: 0.3, color: [1, 0, 0] });
      pw.paintAirbrush({ points: [[3, 0, 2]], radius: 5, strength: 0.6, softness: 0.5, seed: 3, maxEdge: 0.3, color: [0, 0, 1] });
      const live = pw.listRegions().map((r: { triangles: number }) => r.triangles);
      const sv = await pw.runAndSave(pw.getCode(), 'multi-v');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      await pw.loadVersion({ index: sv.version.index });
      return { live, reloaded: pw.listRegions().map((r: { triangles: number }) => r.triangles) };
    });
    expect(out.live.length).toBe(2);
    expect(out.live[0]).toBeGreaterThan(0);
    expect(out.live[1]).toBeGreaterThan(0);
    expect(out.reloaded).toEqual(out.live); // both sprays reproduce exactly on reload
  });

  test('the brush panel has a Spray toggle that reveals strength/softness and disables Slab', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    const sprayToggle = page.locator('#brush-spray-toggle');
    await expect(sprayToggle).toBeVisible();
    await expect(sprayToggle).toContainText('Off');
    await expect(page.locator('#brush-spray-strength')).toBeHidden();

    await sprayToggle.dispatchEvent('click');
    await expect(sprayToggle).toContainText('On');
    await expect(page.locator('#brush-spray-strength')).toBeVisible();
    await expect(page.locator('#brush-spray-softness')).toBeVisible();
    // Spray is geodesic-only, so the Slab surface button is disabled while on.
    await expect(page.locator('#paint-picker-panel button[title*="thin shell"]')).toBeDisabled();
  });

  test('a spray drag commits a speckled region and subdivides the mesh', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 3], true);`);
      pw.setBrushSize(5);
    });
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
    await page.locator('#brush-spray-toggle').dispatchEvent('click'); // spray on
    await page.waitForTimeout(150);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh().numTri;
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      fire('pointermove', cx, cy);
      fire('pointerdown', cx, cy);
      for (let dx = 6; dx <= 24; dx += 6) fire('pointermove', cx + dx, cy);
      fire('pointerup', cx + 24, cy);
      // The interactive brush commits through the async (worker-backed) paint
      // pipeline; wait for the subdivision job to settle.
      await pw.waitForPaint();
      return { before, after: pw.getMesh().numTri, regions: pw.listRegions().length };
    });
    expect(out.regions).toBe(1);
    expect(out.after).toBeGreaterThan(out.before); // the spray subdivided for speckle
  });
});
