// Smoke tests for the extended paint UI:
//  - brush size controls (slider + number input) appear when the brush tool is selected
//  - bucket tolerance has a typeable degree input
//  - per-region eye + trash icons appear in the region list and drive the API
//  - partwright API exposes setBrushSize / setBucketTolerance / hideRegion / showRegion
//
// Uses `dispatchEvent('click')` instead of `.click()` to dodge the onboarding
// tour backdrop that intercepts pointer events on first paint of the editor.

import { test, expect } from 'playwright/test';

async function openEditor(page: import('playwright/test').Page) {
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
  test('brush size controls appear when brush tool is selected', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    // Brush controls should be hidden initially (bucket is default).
    const brushHelp = page.locator('#paint-picker-panel >> text=Single triangle');
    await expect(brushHelp).toBeHidden();

    // Switch to brush tool.
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    // Now the brush slider + number input should be visible.
    await expect(brushHelp).toBeVisible();
    const numberInput = page.locator('#paint-picker-panel input[type="number"][title*="mesh units"]');
    await expect(numberInput).toBeVisible();
    await expect(numberInput).toHaveValue('0.0');
  });

  test('typing a bucket tolerance angle updates the underlying value', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    const angleInput = page.locator('#paint-picker-panel input[type="number"][title*="Bend angle"]');
    await expect(angleInput).toBeVisible();

    await angleInput.fill('45');
    await angleInput.press('Enter');

    const tol = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { getBucketTolerance(): { tolerance: number } } }).partwright;
      return pw.getBucketTolerance().tolerance;
    });
    expect(tol).toBeCloseTo(Math.cos(45 * Math.PI / 180), 3);
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

    // Box controls panel should be visible with non-zero default size.
    const sizeInput = page.locator('#paint-picker-panel input[type="number"]').nth(5);
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

  test('mesh-edge toggle sits left of the grid toggle and defaults off', async ({ page }) => {
    await openEditor(page);
    const wireBtn = page.locator('#wireframe-toggle');
    await expect(wireBtn).toBeVisible();
    await expect(page.locator('#grid-toggle')).toBeVisible();
    // Default: edges hidden, so the button invites showing them.
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');
    // DOM order places the wireframe button before the grid button (i.e. to its left).
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

  test('paint mode forces mesh edges on and restores the prior state on exit', async ({ page }) => {
    await openEditor(page);
    const wireBtn = page.locator('#wireframe-toggle');
    await expect(wireBtn).toHaveAttribute('title', 'Show mesh edges');

    // Entering paint mode turns edges on (they matter for aiming paint).
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await expect(wireBtn).toHaveAttribute('title', 'Hide mesh edges');

    // Leaving paint mode restores the previous (off) state.
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
});
