// Smooth paintbrush: subdivides the mesh under a brush stroke so the painted
// region's edge is rounded instead of following the existing tessellation.
//
// Covers the UI controls (smooth toggle + detail slider), the
// window.partwright config + paintStroke API, and the core invariants:
//   - a stroke grows the triangle count (subdivision happened)
//   - refinement is rim-only (lean), with intentional hairline T-junctions
//   - finer detail yields more triangles
//   - clearing the stroke restores the original tessellation
//   - a stroke overlapping another region resolves the same live and on reload
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
  test('brush is the default tool with smoothing on and a detail slider', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // Brush is the default tool, so the smooth toggle shows immediately and
    // smoothing is on by default. Scope to the brush's own toggle (the slab and
    // shape panels carry their own "Smooth edges" toggles too).
    const smoothBtn = page.locator('#paint-picker-panel button[title*="under the brush"]');
    await expect(smoothBtn).toBeVisible();
    await expect(smoothBtn).toContainText('On');

    // The detail control is a typeable slider (range 2..1024), visible while on.
    const detailSlider = page.locator('#paint-picker-panel input[type="range"][title*="brush radius"]');
    await expect(detailSlider).toBeVisible();
    await expect(detailSlider).toHaveAttribute('max', '1024');
    await expect(detailSlider).toHaveAttribute('min', '2');

    // Defaults: smooth on, divisor 256.
    const cfg = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).partwright.getBrushSmooth();
    });
    expect(cfg).toMatchObject({ smooth: true, divisor: 256 });

    // Turning smoothing off hides the detail slider.
    await smoothBtn.dispatchEvent('click');
    await expect(smoothBtn).toContainText('Off');
    await expect(detailSlider).toBeHidden();
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
      pw.setBrushSmoothDivisor(64);
    });
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
    // Let the viewport auto-frame the new mesh so the centre ray reliably hits
    // it (otherwise a synthetic mousedown can miss before the camera settles).
    await page.waitForTimeout(150);

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

  test('setBrushSmooth / setBrushSmoothDivisor validate, clamp, and round-trip', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const badBool = pw.setBrushSmooth('yes');
      const okBool = pw.setBrushSmooth(true);
      const badNum = pw.setBrushSmoothDivisor('lots');
      const clampHi = pw.setBrushSmoothDivisor(99999);
      const clampLo = pw.setBrushSmoothDivisor(0);
      const ok = pw.setBrushSmoothDivisor(300);
      return { badBool, okBool, badNum, clampHi, clampLo, ok, cfg: pw.getBrushSmooth() };
    });
    expect(result.badBool.error).toBeTruthy();
    expect(result.okBool.smooth).toBe(true);
    expect(result.badNum.error).toBeTruthy();
    expect(result.clampHi.divisor).toBe(1024); // clamped to max
    expect(result.clampLo.divisor).toBe(2);     // clamped to min
    expect(result.ok.divisor).toBe(300);
    expect(result.cfg).toMatchObject({ smooth: true, divisor: 300 });
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

  test('paintStroke resolution defaults to 256, is settable, and maxEdge overrides', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 4], true);`);
      pw.clearColors();
      const def = pw.paintStroke({ points: [[0, 0, 2]], radius: 8, color: [1, 0, 0] });
      const defTri = pw.getMesh().numTri;
      pw.clearColors();
      const coarse = pw.paintStroke({ points: [[0, 0, 2]], radius: 8, resolution: 32, color: [1, 0, 0] });
      const coarseTri = pw.getMesh().numTri;
      pw.clearColors();
      const abs = pw.paintStroke({ points: [[0, 0, 2]], radius: 8, maxEdge: 0.5, color: [1, 0, 0] });
      return { def, defTri, coarse, coarseTri, abs };
    });
    expect(out.def.resolution).toBe(256);          // default
    expect(out.def.maxEdge).toBeCloseTo(8 / 256, 5);
    expect(out.coarse.resolution).toBe(32);        // settable
    expect(out.defTri).toBeGreaterThan(out.coarseTri); // 256 is finer than 32
    expect(out.abs.maxEdge).toBe(0.5);             // maxEdge override wins
  });

  test('triangle-count readout updates on run, paint, and clear (no hard cap)', async ({ page }) => {
    await openEditor(page); // runs a 10mm cube (12 triangles)
    const counter = page.locator('#triangle-count');
    await expect(counter).toBeVisible();
    const num = async () => parseInt((await counter.textContent() ?? '').replace(/[^0-9]/g, ''), 10);
    const base = await num();
    expect(base).toBe(12);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).partwright.paintStroke({ points: [[0, 0, 5]], radius: 2, resolution: 64, color: [1, 0, 0] });
    });
    await expect.poll(num).toBeGreaterThan(base); // count rose with the stroke

    await page.evaluate(() => (window as unknown as { partwright: { clearColors(): void } }).partwright.clearColors());
    await expect.poll(num).toBe(base); // back to base after clear
  });

  test('a region overlapping a smooth stroke resolves the same live and on reload', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('overlap-determinism');
      await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 6], true);`);
      // A box region over the top half, then a smooth stroke straddling its edge
      // (subdivides triangles the box's centroid test treats as in/out).
      const boxRegion = pw.paintInBox({ box: { min: [-20, -20, 2.9], max: [20, 20, 3.1] }, color: [0, 0, 1], name: 'Top' });
      pw.paintStroke({ points: [[0, 0, 3]], radius: 8, resolution: 64, color: [1, 0, 0] });
      const liveBoxTris = pw.listRegions().find((r: { id: number }) => r.id === boxRegion.id).triangles;
      const liveMeshTris = pw.getMesh().numTri;

      const sv = await pw.runAndSave(pw.getCode(), 'overlap-v');
      await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 6], true);`);
      await pw.loadVersion({ index: sv.version.index });
      const reloaded = pw.listRegions();
      const reloadBox = reloaded.find((r: { name: string }) => r.name === 'Top');
      return { liveBoxTris, liveMeshTris, reloadBoxTris: reloadBox?.triangles ?? -1, reloadMeshTris: pw.getMesh().numTri };
    });

    // Incremental (live) append must match the full re-resolve on reload.
    expect(out.reloadMeshTris).toBe(out.liveMeshTris);
    expect(out.reloadBoxTris).toBe(out.liveBoxTris);
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
      // Re-run the same code. A refining region that persists across the re-run
      // deterministically rebuilds the refined mesh — it does NOT reset to the
      // coarse base, otherwise the region's refined-mesh triangle indices would
      // be stamped onto coarse triangles ("shattered shards"). loadVersion then
      // independently reconstructs the same refined mesh from the descriptor.
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

    expect(out.paintedTri).toBeGreaterThan(12);
    expect(out.baseTri).toBe(out.paintedTri);             // re-run rebuilds the refined mesh deterministically
    expect(out.reloadedTri).toBe(out.paintedTri);         // refined mesh reconstructed deterministically
    expect(out.reloadedColored).toBe(out.paintedColored); // same painted triangle set
    expect(out.reloadedRegions).toBe(1);
  });
});

// Slab and oriented-shape painting reuse the same rim-subdivision pipeline as the
// brush: their analytic boundary is smoothed by subdividing the coarse triangles
// it crosses. Smoothing is on by default and controllable (UI toggle/slider; API
// smooth/resolution/maxEdge params).
test.describe('smooth slab & shape painting', () => {
  test('paintSlab smooths its edges by default and smooth:false keeps the base mesh', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const base = pw.getMesh().numTri; // 10mm cube: 12 triangles
      // Slab z ∈ [0,5] covers the top face + upper walls (so the coarse centroid
      // test finds something), and its lower edge z=0 crosses the wall triangles.
      const smooth = pw.paintSlab({ axis: 'z', offset: 0, thickness: 5, color: [0, 0.6, 1] });
      const smoothTri = pw.getMesh().numTri;
      pw.clearColors();
      const cleared = pw.getMesh().numTri;
      const blocky = pw.paintSlab({ axis: 'z', offset: 0, thickness: 5, color: [0, 0.6, 1], smooth: false });
      const blockyTri = pw.getMesh().numTri;
      return { base, smooth, smoothTri, cleared, blocky, blockyTri };
    });

    expect(out.smooth.error).toBeFalsy();
    expect(out.smooth.smooth).toBe(true);
    expect(out.smooth.maxEdge).toBeGreaterThan(0);
    expect(out.smoothTri).toBeGreaterThan(out.base);  // boundary subdivided
    expect(out.cleared).toBe(out.base);               // clear restores the base mesh
    expect(out.blocky.smooth).toBe(false);
    expect(out.blockyTri).toBe(out.base);             // smooth:false leaves tessellation untouched
  });

  test('slab resolution controls smoothness (finer → more triangles)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([60, 60, 60], true);`);
      pw.paintSlab({ axis: 'z', offset: 0, thickness: 20, color: [1, 0, 0], resolution: 16 });
      const coarse = pw.getMesh().numTri;
      pw.clearColors();
      pw.paintSlab({ axis: 'z', offset: 0, thickness: 20, color: [1, 0, 0], resolution: 128 });
      const fine = pw.getMesh().numTri;
      return { coarse, fine };
    });
    expect(out.fine).toBeGreaterThan(out.coarse);
  });

  test('paintInOrientedBox smooths by default; smooth:false keeps the base mesh', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const base = pw.getMesh().numTri;
      // A box that pokes through the top face (z=5) — its faces cut across the
      // two big top-face triangles, so smoothing has coarse triangles to refine.
      const smooth = pw.paintInOrientedBox({ box: { center: [0, 0, 5], size: [6, 6, 6] }, color: [0.2, 0.9, 0.4] });
      const smoothTri = pw.getMesh().numTri;
      pw.clearColors();
      const blocky = pw.paintInOrientedBox({ box: { center: [0, 0, 5], size: [6, 6, 6] }, color: [0.2, 0.9, 0.4], smooth: false });
      const blockyTri = pw.getMesh().numTri;
      return { base, smooth, smoothTri, blocky, blockyTri };
    });

    expect(out.smooth.error).toBeFalsy();
    expect(out.smooth.smooth).toBe(true);
    expect(out.smoothTri).toBeGreaterThan(out.base);
    expect(out.blocky.smooth).toBe(false);
    expect(out.blockyTri).toBe(out.base);
  });

  test('a smooth slab resolves the same live and on reload (determinism)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('smooth-slab-persist');
      await pw.run(`const { Manifold } = api; return Manifold.cube([30, 30, 30], true);`);
      const region = pw.paintSlab({ axis: 'z', offset: 0, thickness: 10, color: [1, 0.4, 0], resolution: 48 });
      const liveTri = pw.getMesh().numTri;
      const liveColored = pw.listRegions().find((r: { id: number }) => r.id === region.id).triangles;

      const sv = await pw.runAndSave(pw.getCode(), 'slab-v');
      // Re-run the same code: the persisting smooth-slab region rebuilds the
      // refined mesh deterministically (matching the brush path) rather than
      // leaving the coarse base with stale refined indices.
      await pw.run(`const { Manifold } = api; return Manifold.cube([30, 30, 30], true);`);
      const baseTri = pw.getMesh().numTri;
      await pw.loadVersion({ index: sv.version.index });
      const reloaded = pw.listRegions()[0];
      return { liveTri, liveColored, baseTri, reloadTri: pw.getMesh().numTri, reloadColored: reloaded?.triangles ?? -1 };
    });

    expect(out.liveTri).toBeGreaterThan(12);         // smoothing subdivided
    expect(out.baseTri).toBe(out.liveTri);           // re-run rebuilds the refined mesh deterministically
    expect(out.reloadTri).toBe(out.liveTri);         // refined mesh reconstructed deterministically
    expect(out.reloadColored).toBe(out.liveColored); // same painted set
  });

  test('a stroke appended over a smooth slab matches a full reload (determinism)', async ({ page }) => {
    await openEditor(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('slab-then-stroke');
      await pw.run(`const { Manifold } = api; return Manifold.cube([30, 30, 30], true);`);
      // Smooth slab first (full rebuild), then a stroke straddling its band
      // (incremental append onto the slab-refined mesh).
      const slab = pw.paintSlab({ axis: 'z', offset: 0, thickness: 10, color: [0, 0.5, 1], resolution: 48 });
      pw.paintStroke({ points: [[15, 0, 5]], radius: 6, resolution: 48, color: [1, 0, 0] });
      const liveMeshTris = pw.getMesh().numTri;
      const liveSlabTris = pw.listRegions().find((r: { id: number }) => r.id === slab.id).triangles;

      const sv = await pw.runAndSave(pw.getCode(), 'slab-stroke-v');
      await pw.run(`const { Manifold } = api; return Manifold.cube([30, 30, 30], true);`);
      await pw.loadVersion({ index: sv.version.index });
      const reloadSlab = pw.listRegions().find((r: { name: string }) => r.name === slab.name);
      return { liveMeshTris, liveSlabTris, reloadMeshTris: pw.getMesh().numTri, reloadSlabTris: reloadSlab?.triangles ?? -1 };
    });

    expect(out.reloadMeshTris).toBe(out.liveMeshTris);   // incremental append == full reload
    expect(out.reloadSlabTris).toBe(out.liveSlabTris);
  });

  test('the slab and shape panels show an edge-smoothing toggle, on by default', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    for (const tool of ['Slab', 'Shape']) {
      await page.locator(`#paint-picker-panel button:has-text("${tool}")`).first().dispatchEvent('click');
      const smoothBtn = page.locator('#paint-picker-panel button:visible:has-text("Smooth edges")');
      await expect(smoothBtn).toBeVisible();
      await expect(smoothBtn).toContainText('On');
    }
  });
});
