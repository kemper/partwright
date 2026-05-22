// Smooth paintbrush: subdivides the mesh under a brush stroke so the painted
// region's edge is rounded instead of following the existing tessellation.
//
// Covers the UI controls (smooth toggle + fineness selector), the
// window.partwright config + paintStroke API, and the core invariants:
//   - a stroke grows the triangle count (subdivision happened)
//   - the refined mesh stays watertight (every edge shared by exactly 2 tris)
//   - finer subdivision yields more triangles
//   - clearing the stroke restores the original tessellation
//
// Uses dispatchEvent('click') to dodge the first-run onboarding backdrop, and
// drives painting through paintStroke (same code path as the UI smooth brush)
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

test.describe('smooth paintbrush', () => {
  test('smooth toggle and fineness selector appear with the brush tool', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    const smoothBtn = page.locator('#paint-picker-panel button:has-text("Smooth edges")');
    // Hidden until the brush tool is active (bucket is the default).
    await expect(smoothBtn).toBeHidden();

    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
    await expect(smoothBtn).toBeVisible();
    await expect(smoothBtn).toContainText('Off');

    // Fineness buttons are hidden until smoothing is turned on.
    const fineMed = page.locator('#paint-picker-panel button:has-text("Medium")');
    await expect(fineMed).toBeHidden();

    await smoothBtn.dispatchEvent('click');
    await expect(smoothBtn).toContainText('On');
    await expect(fineMed).toBeVisible();

    // The toggle is reflected in the partwright config.
    const cfg = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).partwright.getBrushSmooth();
    });
    expect(cfg.smooth).toBe(true);
  });

  test('setBrushSmooth / setBrushSubdivision validate and round-trip', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const badBool = pw.setBrushSmooth('yes');
      const okBool = pw.setBrushSmooth(true);
      const badLvl = pw.setBrushSubdivision('lots');
      const clampHi = pw.setBrushSubdivision(99);
      const okLvl = pw.setBrushSubdivision(3);
      return { badBool, okBool, badLvl, clampHi, okLvl, cfg: pw.getBrushSmooth() };
    });
    expect(result.badBool.error).toBeTruthy();
    expect(result.okBool.smooth).toBe(true);
    expect(result.badLvl.error).toBeTruthy();
    expect(result.clampHi.subdivision).toBe(5); // clamped to max
    expect(result.okLvl.subdivision).toBe(3);
    expect(result.cfg).toMatchObject({ smooth: true, subdivision: 3 });
  });

  test('paintStroke subdivides the mesh, paints, and stays watertight', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh();
      // A dot in the middle of the top face (z=5) — smaller than the face's two
      // triangles, so it exercises the closest-point selection fallback.
      const stroke = pw.paintStroke({ points: [[0, 0, 5]], radius: 2, subdivision: 2, color: [0.9, 0.2, 0.2] });
      const after = pw.getMesh();
      return {
        stroke,
        beforeTri: before.numTri,
        afterTri: after.numTri,
        afterWatertight: isWatertightInPage(Array.from(after.triangles)),
        regions: pw.listRegions().length,
      };
      function isWatertightInPage(tris: number[]): boolean {
        const counts = new Map<string, number>();
        for (let i = 0; i < tris.length; i += 3) {
          const v = [tris[i], tris[i + 1], tris[i + 2]];
          for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) {
            const k = a < b ? `${a},${b}` : `${b},${a}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
        for (const c of counts.values()) if (c !== 2) return false;
        return true;
      }
    });

    expect(out.stroke.error).toBeFalsy();
    expect(out.stroke.triangles).toBeGreaterThan(0);
    expect(out.afterTri).toBeGreaterThan(out.beforeTri); // subdivision happened
    expect(out.afterWatertight).toBe(true);
    expect(out.regions).toBe(1);
  });

  test('finer subdivision produces more triangles; clearing restores the base mesh', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const base = pw.getMesh().numTri;

      pw.paintStroke({ points: [[0, 0, 5]], radius: 3, subdivision: 1, color: [1, 0, 0] });
      const low = pw.getMesh().numTri;
      pw.clearColors();
      const clearedLow = pw.getMesh().numTri;

      pw.paintStroke({ points: [[0, 0, 5]], radius: 3, subdivision: 3, color: [1, 0, 0] });
      const high = pw.getMesh().numTri;
      pw.clearColors();
      const clearedHigh = pw.getMesh().numTri;

      return { base, low, high, clearedLow, clearedHigh };
    });

    expect(out.low).toBeGreaterThan(out.base);
    expect(out.high).toBeGreaterThan(out.low);     // more passes -> more triangles
    expect(out.clearedLow).toBe(out.base);          // clearing returns to base tessellation
    expect(out.clearedHigh).toBe(out.base);
  });

  test('paintStroke rejects bad input', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return {
        noPoints: pw.paintStroke({ radius: 2, color: [1, 0, 0] }),
        badRadius: pw.paintStroke({ points: [[0, 0, 5]], radius: 0, color: [1, 0, 0] }),
        badColor: pw.paintStroke({ points: [[0, 0, 5]], radius: 2, color: [1, 0] }),
        offModel: pw.paintStroke({ points: [[100, 100, 100]], radius: 1, color: [1, 0, 0] }),
      };
    });
    expect(out.noPoints.error).toBeTruthy();
    expect(out.badRadius.error).toBeTruthy();
    expect(out.badColor.error).toBeTruthy();
    expect(out.offModel.error).toBeTruthy(); // nothing within the footprint
  });

  test('a smooth stroke survives save + reload', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('smooth-persist');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      pw.paintStroke({ points: [[0, 0, 2]], radius: 5, subdivision: 3, color: [0.2, 0.7, 1] });
      const paintedTri = pw.getMesh().numTri;
      const paintedColored = pw.listRegions()[0].triangles;

      const sv = await pw.runAndSave(pw.getCode(), 'smooth-v');
      // Re-run the bare code so the refined mesh is gone, then reload the version:
      // loadVersion re-runs the code and replays the stroke descriptor.
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

    expect(out.baseTri).toBe(12);                         // bare cube, no refinement
    expect(out.paintedTri).toBeGreaterThan(12);
    expect(out.reloadedTri).toBe(out.paintedTri);         // refined mesh reconstructed deterministically
    expect(out.reloadedColored).toBe(out.paintedColored); // same painted triangle set
    expect(out.reloadedRegions).toBe(1);
  });
});
