// Airbrush: sprays a soft-edged region whose boundary fades out via stochastic
// coverage (a dither), NOT via colour blending — every triangle is painted
// fully or not at all, so the result stays a single printable colour per
// triangle (these models are meant to be 3D-printed).
//
// Covers the UI tool + controls, the window.partwright config + paintAirbrush
// API, and the core invariants:
//   - a spray paints triangles and subdivides the mesh under the footprint
//   - higher strength / lower softness ⇒ strictly more covered triangles
//     (with a fixed seed the dither is a superset, so this is non-flaky)
//   - the speckle is deterministic: it reproduces exactly across save + reload
//   - clearing the stroke restores the original tessellation
//
// Drives painting through paintAirbrush (same code path as the UI airbrush)
// rather than simulating a raycast mouse drag.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`);
  });
}

test.describe('airbrush', () => {
  test('airbrush is a selectable tool with strength + softness controls', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    await page.locator('#paint-picker-panel button:has-text("Airbrush")').dispatchEvent('click');

    // The airbrush-specific controls become visible.
    await expect(page.locator('#paint-picker-panel input[type="range"][title*="spray cone"]')).toBeVisible();
    await expect(page.locator('#paint-picker-panel input[type="range"][title*="core"]')).toBeVisible();    // strength
    await expect(page.locator('#paint-picker-panel input[type="range"][title*="feathered"]')).toBeVisible(); // softness

    // Defaults exposed on the window API.
    const cfg = await page.evaluate(() => (window as any).partwright.getAirbrush()); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(cfg).toMatchObject({ radius: 2, strength: 0.85, softness: 0.5 });
  });

  test('airbrush has a smooth-edges control (toggle + detail) wired to the API', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Airbrush")').dispatchEvent('click');

    // Smooth edges is on by default, with a detail slider (range 4..1024) visible.
    const smoothBtn = page.locator('#airbrush-smooth-toggle');
    await expect(smoothBtn).toBeVisible();
    await expect(smoothBtn).toContainText('On');
    const detail = page.locator('#airbrush-smooth-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toHaveAttribute('min', '4');
    await expect(detail).toHaveAttribute('max', '1024');

    // Defaults exposed on the window API.
    const cfg = await page.evaluate(() => (window as any).partwright.getAirbrush()); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(cfg).toMatchObject({ smooth: true, smoothDivisor: 24 });

    // Turning it off hides the detail slider.
    await smoothBtn.dispatchEvent('click');
    await expect(smoothBtn).toContainText('Off');
    await expect(detail).toBeHidden();

    // Setters validate, clamp, and round-trip.
    const api = await page.evaluate(() => {
      const pw = (window as any).partwright; // eslint-disable-line @typescript-eslint/no-explicit-any
      return {
        badBool: pw.setAirbrushSmooth('yes'),
        okBool: pw.setAirbrushSmooth(true),
        badNum: pw.setAirbrushSmoothDivisor('lots'),
        clampHi: pw.setAirbrushSmoothDivisor(99999),
        clampLo: pw.setAirbrushSmoothDivisor(0),
        ok: pw.setAirbrushSmoothDivisor(40),
        cfg: pw.getAirbrush(),
      };
    });
    expect(api.badBool.error).toBeTruthy();
    expect(api.okBool.smooth).toBe(true);
    expect(api.badNum.error).toBeTruthy();
    expect(api.clampHi.divisor).toBe(1024); // clamped to max
    expect(api.clampLo.divisor).toBe(4);  // clamped to min
    expect(api.ok.divisor).toBe(40);
    expect(api.cfg).toMatchObject({ smooth: true, smoothDivisor: 40 });
  });

  test('paintAirbrush paints a region and subdivides the mesh', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh().numTri;
      const r = pw.paintAirbrush({ points: [[0, 0, 5]], radius: 4, strength: 0.9, softness: 0.5, seed: 1, color: [0.9, 0.2, 0.2] });
      return { r, before, after: pw.getMesh().numTri, regions: pw.listRegions().length };
    });
    expect(out.r.error).toBeFalsy();
    expect(out.r.triangles).toBeGreaterThan(0);
    expect(out.after).toBeGreaterThan(out.before); // interior was refined for fine speckle
    expect(out.regions).toBe(1);
  });

  test('strength and softness change coverage monotonically (fixed seed)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const spray = (strength: number, softness: number) => {
        pw.clearColors();
        return pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, strength, softness, seed: 42, color: [0.2, 0.6, 1] }).triangles;
      };
      // Same seed ⇒ the dither is a strict superset as the threshold rises, so
      // these comparisons are deterministic, not statistical.
      const strongCount = spray(0.95, 0.5);
      const weakCount = spray(0.3, 0.5);
      const hardCount = spray(0.9, 0.0); // hard disc — solid out to the rim
      const softCount = spray(0.9, 1.0); // fades from the centre
      return { strongCount, weakCount, hardCount, softCount };
    });
    expect(out.strongCount).toBeGreaterThan(out.weakCount);
    expect(out.hardCount).toBeGreaterThan(out.softCount);
  });

  test('the same seed reproduces the same speckle; clearing restores the base mesh', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const base = pw.getMesh().numTri;

      const first = pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, seed: 7, color: [1, 0, 0] }).triangles;
      const paintedTri = pw.getMesh().numTri;
      pw.clearColors();
      const clearedTri = pw.getMesh().numTri;
      const second = pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, seed: 7, color: [1, 0, 0] }).triangles;

      return { base, first, second, paintedTri, clearedTri };
    });
    expect(out.first).toBe(out.second);     // deterministic for a fixed seed
    expect(out.paintedTri).toBeGreaterThan(out.base);
    expect(out.clearedTri).toBe(out.base);  // clearing returns to the base tessellation
  });

  test('an airbrush stroke survives save + reload', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('airbrush-persist');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      pw.paintAirbrush({ points: [[0, 0, 2]], radius: 5, seed: 99, strength: 0.8, softness: 0.6, color: [0.2, 0.7, 1] });
      const paintedTri = pw.getMesh().numTri;
      const paintedColored = pw.listRegions()[0].triangles;

      const sv = await pw.runAndSave(pw.getCode(), 'airbrush-v');
      // Re-run the bare code so the refined mesh is gone, then reload the version.
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      const baseTri = pw.getMesh().numTri;
      await pw.loadVersion({ index: sv.version.index });
      return {
        paintedTri,
        paintedColored,
        baseTri,
        reloadedTri: pw.getMesh().numTri,
        reloadedColored: pw.listRegions()[0]?.triangles ?? 0,
        reloadedRegions: pw.listRegions().length,
      };
    });
    expect(out.baseTri).toBe(12);                          // bare cube, no refinement
    expect(out.paintedTri).toBeGreaterThan(12);
    expect(out.reloadedTri).toBe(out.paintedTri);          // refined mesh reconstructed deterministically
    expect(out.reloadedColored).toBe(out.paintedColored);  // same painted triangle count (stable speckle)
    expect(out.reloadedRegions).toBe(1);
  });

  test('paintAirbrush + config setters validate bad input', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return {
        noPoints: pw.paintAirbrush({ radius: 2, color: [1, 0, 0] }),
        badRadius: pw.paintAirbrush({ points: [[0, 0, 5]], radius: 0, color: [1, 0, 0] }),
        badStrength: pw.paintAirbrush({ points: [[0, 0, 5]], radius: 2, strength: 2, color: [1, 0, 0] }),
        offModel: pw.paintAirbrush({ points: [[100, 100, 100]], radius: 1, color: [1, 0, 0] }),
        badSize: pw.setAirbrushSize(-1),
        okSize: pw.setAirbrushSize(3),
        badSoft: pw.setAirbrushSoftness(5),
        okSoft: pw.setAirbrushSoftness(0.25),
      };
    });
    expect(out.noPoints.error).toBeTruthy();
    expect(out.badRadius.error).toBeTruthy();
    expect(out.badStrength.error).toBeTruthy();
    expect(out.offModel.error).toBeTruthy();   // nothing within the footprint
    expect(out.badSize.error).toBeTruthy();
    expect(out.okSize.radius).toBe(3);
    expect(out.badSoft.error).toBeTruthy();
    expect(out.okSoft.softness).toBe(0.25);
  });
});
