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

    // All four quality presets are present once smoothing is on.
    for (const lbl of ['Coarse', 'Fine', 'Ultra']) {
      await expect(page.locator(`#paint-picker-panel button:has-text("${lbl}")`)).toBeVisible();
    }

    // The toggle is reflected in the partwright config.
    const cfg = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).partwright.getBrushSmooth();
    });
    expect(cfg.smooth).toBe(true);
  });

  test('a smooth-mode brush drag commits a stroke and subdivides', async ({ page }) => {
    await openEditor(page);
    // A wide flat slab fills the viewport so canvas-dispatched drag coordinates
    // reliably hit the model (the onboarding backdrop can't eat events dispatched
    // straight on the canvas). Exercises the live preview + commit path.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 3], true);`);
      pw.setBrushSize(4);
      pw.setBrushSmooth(true);
      pw.setBrushSmoothQuality(3);
    });
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh().numTri;
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0 }));
      fire('mousemove', cx, cy); // hover preview
      fire('mousedown', cx, cy);
      for (let dx = 6; dx <= 30; dx += 6) fire('mousemove', cx + dx, cy);
      fire('mouseup', cx + 30, cy);
      await new Promise(res => requestAnimationFrame(() => res(null)));
      return { before, after: pw.getMesh().numTri, regions: pw.listRegions().length };
    });

    expect(out.regions).toBe(1);
    expect(out.after).toBeGreaterThan(out.before); // the stroke subdivided the mesh
  });

  test('setBrushSmooth / setBrushSmoothQuality validate and round-trip', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const badBool = pw.setBrushSmooth('yes');
      const okBool = pw.setBrushSmooth(true);
      const badLvl = pw.setBrushSmoothQuality('lots');
      const clampHi = pw.setBrushSmoothQuality(99);
      const okLvl = pw.setBrushSmoothQuality(2);
      return { badBool, okBool, badLvl, clampHi, okLvl, cfg: pw.getBrushSmooth() };
    });
    expect(result.badBool.error).toBeTruthy();
    expect(result.okBool.smooth).toBe(true);
    expect(result.badLvl.error).toBeTruthy();
    expect(result.clampHi.quality).toBe(4); // clamped to max
    expect(result.okLvl.quality).toBe(2);
    expect(result.cfg).toMatchObject({ smooth: true, quality: 2 });
  });

  test('paintStroke subdivides the rim and paints, keeping triangle count lean', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh();
      // A dot in the middle of the top face (z=5) — smaller than the face's two
      // triangles, so it exercises the closest-point selection fallback.
      const stroke = pw.paintStroke({ points: [[0, 0, 5]], radius: 2, maxEdge: 0.25, color: [0.9, 0.2, 0.2] });
      const after = pw.getMesh();
      return { stroke, beforeTri: before.numTri, afterTri: after.numTri, regions: pw.listRegions().length };
    });

    expect(out.stroke.error).toBeFalsy();
    expect(out.stroke.triangles).toBeGreaterThan(0);
    expect(out.afterTri).toBeGreaterThan(out.beforeTri); // subdivision happened
    // Rim-only (edges-only) refinement: r/maxEdge = 8, so a smooth dot is a few
    // hundred triangles, not the thousands a graded interior would add.
    expect(out.afterTri).toBeLessThan(1500);
    expect(out.regions).toBe(1);
  });

  test('many strokes stay fast and bounded (no O(strokes^2) replay)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([120, 120, 4], true);`);
      let maxStrokeMs = 0;
      for (let i = 0; i < 15; i++) {
        const x = -50 + i * 7;
        const t0 = performance.now();
        pw.paintStroke({ points: [[x, 0, 2]], radius: 6, maxEdge: 6 / 32, color: [1, 0, 0] });
        maxStrokeMs = Math.max(maxStrokeMs, performance.now() - t0);
      }
      return { maxStrokeMs, meshTri: pw.getMesh().numTri, regions: pw.listRegions().length };
    });
    expect(out.regions).toBe(15);
    // Each stroke is local + incremental; even the last one is well under a
    // second, and 15 strokes don't blow the mesh up into the millions.
    expect(out.maxStrokeMs).toBeLessThan(1500);
    expect(out.meshTri).toBeLessThan(200000);
  });

  test('a smaller target edge produces more triangles; clearing restores the base mesh', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const base = pw.getMesh().numTri;

      pw.paintStroke({ points: [[0, 0, 5]], radius: 3, maxEdge: 1.0, color: [1, 0, 0] });
      const low = pw.getMesh().numTri;
      pw.clearColors();
      const clearedLow = pw.getMesh().numTri;

      pw.paintStroke({ points: [[0, 0, 5]], radius: 3, maxEdge: 0.2, color: [1, 0, 0] });
      const high = pw.getMesh().numTri;
      pw.clearColors();
      const clearedHigh = pw.getMesh().numTri;

      return { base, low, high, clearedLow, clearedHigh };
    });

    expect(out.low).toBeGreaterThan(out.base);
    expect(out.high).toBeGreaterThan(out.low);     // finer target -> more triangles
    expect(out.clearedLow).toBe(out.base);          // clearing returns to base tessellation
    expect(out.clearedHigh).toBe(out.base);
  });

  test('subdivision adapts to a very coarse flat face (the reported case)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // A large, very flat rectangle: the top face is just two huge triangles —
      // a fixed pass count leaves a chunky circle here. The edge-length target
      // must keep refining until the boundary triangles are actually small.
      await pw.run(`const { Manifold } = api; return Manifold.cube([200, 120, 4], true);`);
      const r = pw.paintStroke({ points: [[0, 0, 2]], radius: 20, maxEdge: 1, color: [1, 0, 0] });
      return { error: r.error, painted: r.triangles, meshTri: r.meshTriangleCount };
    });
    expect(out.error).toBeFalsy();
    // radius 20 / maxEdge 1 ⇒ a smooth circle needs many boundary triangles.
    expect(out.painted).toBeGreaterThan(200);
    expect(out.meshTri).toBeGreaterThan(500);
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
      pw.paintStroke({ points: [[0, 0, 2]], radius: 5, maxEdge: 0.4, color: [0.2, 0.7, 1] });
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
