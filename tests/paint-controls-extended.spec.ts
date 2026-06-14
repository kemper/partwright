// Smoke tests for the extended paint UI:
//  - brush size controls (slider + number input) appear when the brush tool is selected
//  - bucket color tolerance has a typeable percentage input
//  - per-region eye + trash icons appear in the region list and drive the API
//  - partwright API exposes setBrushSize / setBucketTolerance / hideRegion / showRegion
//
// Uses `dispatchEvent('click')` instead of `.click()` to dodge the onboarding
// tour backdrop that intercepts pointer events on first paint of the editor.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
  // Mark the first-run guided tour as already completed BEFORE any page script
  // runs. Otherwise tour.ts fires `setTimeout(startTour, 800)` and its
  // full-screen `.tour-backdrop` swallows the real page.mouse pointer events the
  // brush/bucket flows below rely on — the press lands on the backdrop, not the
  // canvas, so no region commits (the intermittent 0-/1-region flake). Setting
  // the flag here makes `maybeStartTour()` return early, so the backdrop never
  // appears and the synthetic mouse events always reach the viewport.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  // Run a tiny model so paint operations have a real mesh to operate on.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`);
  });
}

test.describe('extended paint controls', () => {
  test('brush size controls show by default (brush is the default tool)', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // Brush is the default tool, so its controls are visible immediately.
    const brushHelp = page.locator('#paint-picker-panel >> text=Single triangle');
    await expect(brushHelp).toBeVisible();
    const numberInput = page.locator('#paint-picker-panel input[type="number"][title*="mesh units"]');
    await expect(numberInput).toBeVisible();
    // Default brush size is 1mm.
    await expect(numberInput).toHaveValue('1.0');

    // Switching to bucket hides the brush controls.
    await page.locator('#paint-picker-panel button:has-text("Bucket")').dispatchEvent('click');
    await expect(brushHelp).toBeHidden();
  });

  test('typing a bucket color tolerance updates the underlying value', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    // Bucket is no longer the default tool — switch to it to reveal its controls.
    await page.locator('#paint-picker-panel button:has-text("Bucket")').dispatchEvent('click');

    // Bucket sensitivity is now color-distance based: the number input is a
    // 0–100 % tolerance, where the underlying value is the fraction (pct / 100).
    const tolInput = page.locator('#paint-picker-panel input[type="number"][title*="Color tolerance"]');
    await expect(tolInput).toBeVisible();

    await tolInput.fill('45');
    await tolInput.press('Enter');

    const tol = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { getBucketColorTolerance(): { tolerance: number } } }).partwright;
      return pw.getBucketColorTolerance().tolerance;
    });
    expect(tol).toBeCloseTo(0.45, 3);
  });

  test('setBrushSize partwright API rejects bad input and accepts good input', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: {
        setBrushSize(n: unknown): { error?: string; previous?: number; radius?: number };
        getBrushSize(): { radius: number };
      } }).partwright;
      const bad = pw.setBrushSize(-1 as unknown as number);
      const good = pw.setBrushSize(2.5);
      return { bad, good, current: pw.getBrushSize() };
    });
    expect(result.bad.error).toContain('non-negative');
    expect(result.good.radius).toBe(2.5);
    expect(result.current.radius).toBe(2.5);
  });

  test('per-region eye and trash buttons drive the regions store', async ({ page }) => {
    await openEditor(page);
    // Paint two regions via the API so the region list has content.
    const ids = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        getMesh(): { triangles: Uint32Array; numTri: number };
        paintFaces(opts: { triangleIds: number[]; color: [number, number, number]; name?: string }): { id: number };
      } }).partwright;
      const mesh = pw.getMesh();
      const a = pw.paintFaces({ triangleIds: [0, 1, 2], color: [1, 0, 0], name: 'A' });
      const b = pw.paintFaces({ triangleIds: [3, 4, 5], color: [0, 1, 0], name: 'B' });
      return [a.id, b.id];
    });
    expect(ids).toHaveLength(2);

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // Two region rows present, each with eye + trash buttons.
    const rows = page.locator('#paint-region-list > div');
    await expect(rows).toHaveCount(2);
    await expect(rows.first().locator('button[data-action="toggle-region-visibility"]')).toBeVisible();
    await expect(rows.first().locator('button[data-action="delete-region"]')).toBeVisible();

    // Click eye on the first row -> region becomes hidden.
    await rows.first().locator('button[data-action="toggle-region-visibility"]').dispatchEvent('click');
    const afterHide = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { listRegions(): { id: number; visible: boolean }[] } }).partwright;
      return pw.listRegions();
    });
    expect(afterHide[0].visible).toBe(false);
    expect(afterHide[1].visible).toBe(true);

    // Click trash on what is now the first row (region A is still there but hidden).
    await rows.first().locator('button[data-action="delete-region"]').dispatchEvent('click');
    const afterDelete = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { listRegions(): { id: number; visible: boolean }[] } }).partwright;
      return pw.listRegions();
    });
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].id).toBe(ids[1]);
  });

  test('box paint tool activates with a default box sized to the model and commits a region', async ({ page }) => {
    await openEditor(page);

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('button[title*="positionable, rotatable"]').dispatchEvent('click');

    // Box controls panel should be visible with non-zero default size. The Size
    // vector inputs are the only ones with min="0.001" (robust to control order).
    const sizeInput = page.locator('#paint-picker-panel input[type="number"][min="0.001"]').first();
    await expect(sizeInput).toBeVisible();
    const sizeValue = await sizeInput.inputValue();
    expect(parseFloat(sizeValue)).toBeGreaterThan(0);

    // Hit "Paint inside box" — default box wraps the model so all triangles get caught.
    await page.locator('button[title="Commit every triangle inside the box as a new color region"]').dispatchEvent('click');

    const regions = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.listRegions();
    });
    expect(regions.length).toBe(1);
    expect(regions[0].triangles).toBeGreaterThan(0);
    expect(regions[0].name).toContain('Box');
  });

  test('paintInOrientedBox API paints into a rotated box', async ({ page }) => {
    await openEditor(page);

    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Identity quaternion should match an AABB centered at origin.
      const identity = pw.paintInOrientedBox({
        box: { center: [0, 0, 0], size: [22, 22, 22] },
        color: [0.5, 0.2, 0.9],
        name: 'Identity OBB',
      });
      pw.clearColors();
      // 45° rotation around Z — same volume, same triangles caught for a centered cube.
      const rotated = pw.paintInOrientedBox({
        box: {
          center: [0, 0, 0],
          size: [22, 22, 22],
          quaternion: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
        },
        color: [0.5, 0.2, 0.9],
        name: 'Rotated OBB',
      });
      pw.clearColors();
      const bad = pw.paintInOrientedBox({ box: { center: [0, 0, 0], size: [0, 1, 1] }, color: [1, 0, 0] });
      return { identity, rotated, bad };
    });
    expect(result.identity.triangles).toBeGreaterThan(0);
    expect(result.rotated.triangles).toBeGreaterThan(0);
    expect(result.bad.error).toBeTruthy();
  });

  test('mesh-edge toggle sits above the grid toggle on the bar and defaults off', async ({ page }) => {
    await openEditor(page);
    // Edges/Grid are direct pills on the viewport bar — visible without a menu.
    const wireBtn = page.locator('#wireframe-toggle');
    await expect(wireBtn).toBeVisible();
    await expect(page.locator('#grid-toggle')).toBeVisible();
    // Default: edges hidden, so the button invites showing them.
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');
    // DOM order places the wireframe button before the grid button.
    const wireIsBeforeGrid = await page.evaluate(() => {
      const w = document.querySelector('#wireframe-toggle')!;
      const g = document.querySelector('#grid-toggle')!;
      return Boolean(w.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(wireIsBeforeGrid).toBe(true);
  });

  test('clicking the mesh-edge toggle flips it on and back off', async ({ page }) => {
    await openEditor(page);
    const wireBtn = page.locator('#wireframe-toggle');
    await wireBtn.dispatchEvent('click');
    await expect(wireBtn).toHaveAttribute('title', 'Hide mesh edges');
    await wireBtn.dispatchEvent('click');
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');
  });

  test('paint mode leaves mesh edges off by default (no auto-enable)', async ({ page }) => {
    await openEditor(page);
    const wireBtn = page.locator('#wireframe-toggle');
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');

    // Entering paint mode does NOT force edges on anymore.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');

    // Leaving paint mode leaves them off too.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');
  });

  test('edges left on before painting stay on after exiting paint', async ({ page }) => {
    await openEditor(page);
    const wireBtn = page.locator('#wireframe-toggle');
    // User turns edges on manually first.
    await wireBtn.dispatchEvent('click');
    await expect(wireBtn).toHaveAttribute('title', 'Hide mesh edges');

    // Paint then exit — edges should remain on, matching the pre-paint state.
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await expect(wireBtn).toHaveAttribute('title', 'Hide mesh edges');
    await page.locator('#paint-toggle').dispatchEvent('click');
    await expect(wireBtn).toHaveAttribute('title', 'Hide mesh edges');
  });

  test('hideRegion / showRegion partwright API toggles visibility flag', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: {
        paintFaces(opts: { triangleIds: number[]; color: [number, number, number] }): { id: number };
        hideRegion(id: number): unknown;
        showRegion(id: number): unknown;
        listRegions(): { id: number; visible: boolean }[];
      } }).partwright;
      const r = pw.paintFaces({ triangleIds: [0, 1, 2], color: [0, 0, 1] });
      pw.hideRegion(r.id);
      const hidden = pw.listRegions().find(x => x.id === r.id)?.visible;
      pw.showRegion(r.id);
      const shown = pw.listRegions().find(x => x.id === r.id)?.visible;
      return { hidden, shown };
    });
    expect(result.hidden).toBe(false);
    expect(result.shown).toBe(true);
  });

  test('bucket flood-fill preview tracks the tolerance slider live (no mouse move)', async ({ page }) => {
    await openEditor(page);
    // Replace the cube with a higher-tri sphere and paint its top hemisphere so
    // the bucket has a real two-color region to flood-fill.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.sphere(8, 64);`);
      pw.paintInBox({ box: { min: [-8, -8, 0], max: [8, 8, 8] }, color: [1, 0.2, 0.2] });
    });

    // Dismiss the onboarding tour so its backdrop doesn't eat the hover pointer.
    const skip = page.locator('button:has-text("Skip")');
    if (await skip.count()) await skip.first().click().catch(() => {});

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Bucket")').dispatchEvent('click');

    // Hover the painted (upper) hemisphere at a tight tolerance.
    const tolInput = page.locator('#paint-picker-panel input[type="number"][title*="Color tolerance"]');
    await tolInput.fill('5');
    await tolInput.press('Enter');
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('no canvas');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height * 0.35;
    await page.mouse.move(cx - 20, cy - 20);
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(300);

    const hoverTris = async () => page.evaluate(async () => {
      const vp = await import('/src/renderer/viewport.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let found: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vp.getMeshGroup().traverse((o: any) => { if (o.name === 'paint-hover') found = o; });
      const pos = found?.geometry?.attributes?.position;
      return pos ? pos.count / 3 : 0;
    });

    const tight = await hoverTris();
    expect(tight).toBeGreaterThan(0); // the red hemisphere region is previewed

    // Crank tolerance to 100 % WITHOUT moving the mouse — the preview must grow
    // to the whole connected sphere, proving it tracks the setting live.
    await tolInput.fill('100');
    await tolInput.press('Enter');
    await page.waitForTimeout(300);
    const loose = await hoverTris();
    expect(loose).toBeGreaterThan(tight);
  });

  test('color bucket fill over a brush-painted blob commits and survives reconcile', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 20], true);`);
    });

    const skip = page.locator('button:has-text("Skip")');
    if (await skip.count()) await skip.first().click().catch(() => {});

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    // Brush is the default tool — paint a red blob (the brush adaptively
    // subdivides the face, leaving the T-junctions the adjacency fix bridges).
    await page.evaluate(async () => {
      const pm = await import('/src/color/paintMode.ts');
      pm.setColor([1, 0.15, 0.15]);
    });
    const box = await page.locator('canvas').first().boundingBox();
    if (!box) throw new Error('no canvas');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx - 40, cy);
    await page.mouse.down();
    for (let i = -40; i <= 40; i += 8) await page.mouse.move(cx + i, cy + Math.sin(i / 10) * 8);
    await page.mouse.up();

    // The interactive brush commits through the async worker-backed pipeline, so
    // wait for the subdivision job to settle (deterministic) rather than a fixed
    // timeout that can expire mid-reconcile on a loaded CI shard.
    const afterBrush = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.waitForPaint();
      return pw.listRegions().map((r: any) => r.triangles);
    });
    expect(afterBrush.length).toBe(1);
    expect(afterBrush[0]).toBeGreaterThan(50); // the refined red blob

    // Switch to bucket / Color, pick a new color, and fill inside the blob.
    await page.locator('#paint-picker-panel button:has-text("Bucket")').dispatchEvent('click');
    await page.locator('#paint-picker-panel button:has-text("Color")').dispatchEvent('click');
    await page.evaluate(async () => {
      const pm = await import('/src/color/paintMode.ts');
      pm.setColor([1, 0.85, 0.1]); // yellow
    });
    const tolInput = page.locator('#paint-picker-panel input[type="number"][title*="Color tolerance"]');
    await tolInput.fill('20'); await tolInput.press('Enter');
    await page.mouse.move(cx - 100, cy - 100);
    await page.mouse.move(cx - 4, cy); await page.mouse.move(cx, cy);
    await page.waitForTimeout(250);
    await page.mouse.down(); await page.waitForTimeout(40); await page.mouse.up();

    // Wait for the async reconcile to re-resolve the regions before reading them.
    const afterBucket = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.waitForPaint();
      return pw.listRegions().map((r: any) => ({ tris: r.triangles, color: r.color }));
    });
    // Two regions; the bucket region must NOT collapse to zero after reconcile,
    // and it carries the new (yellow) color over the blob it matched.
    expect(afterBucket.length).toBe(2);
    expect(afterBucket[1].tris).toBeGreaterThan(50);
    expect(afterBucket[1].color[2]).toBeLessThan(0.5); // yellow, not the red it replaced
  });
});
