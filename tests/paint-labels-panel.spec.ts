// Verifies the labels list in the paint panel:
//   1. After running code that calls api.label(...), the labels section in the
//      open paint panel lists each label with its triangle count.
//   2. Clicking a label row paints it — the resulting region uses a byLabel
//      descriptor and the same triangle set the AI's paintByLabel produces,
//      so re-hydration goes through the same code path.
//   3. Unlabeled code surfaces the empty-state hint instead of a blank section.
//
// Uses `dispatchEvent('click')` to dodge the first-paint onboarding backdrop.

import { test, expect } from 'playwright/test';

async function openEditorWithCode(page: import('playwright/test').Page, code: string) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async (src) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(src);
  }, code);
}

test.describe('paint labels panel', () => {
  test('lists labels from the current run and paints on click', async ({ page }) => {
    // Eye sticks out of the head by ~2 units so it has visible surface
    // triangles after boolean union — `paintByLabel` returns 0 triangles if
    // the labelled feature is fully buried.
    await openEditorWithCode(page, `
      const { Manifold } = api;
      const head = api.label(Manifold.sphere(20, 32), 'head');
      const eye = api.label(Manifold.sphere(5, 16).translate([-8, 14, 5]), 'eye');
      return head.add(eye);
    `);

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    const labelList = page.locator('#paint-label-list');
    await expect(labelList).toBeVisible();
    // Header + row for each label
    await expect(labelList.locator('text=Labels')).toBeVisible();
    const rows = labelList.locator('[data-label-name]');
    await expect(rows).toHaveCount(2);
    await expect(labelList.locator('[data-label-name="head"]')).toBeVisible();
    await expect(labelList.locator('[data-label-name="eye"]')).toBeVisible();

    // Click the eye label — should create a byLabel region with the eye's
    // triangle set. The triangle count must match what listLabels reports
    // for that name (the snapshot is the source of truth for both).
    const expectedTris = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const labels: { name: string; triangleCount: number }[] = pw.listLabels().labels;
      return labels.find(l => l.name === 'eye')?.triangleCount ?? 0;
    });
    expect(expectedTris).toBeGreaterThan(0);

    await labelList.locator('[data-label-name="eye"]').dispatchEvent('click');

    // Wait for the new region to land in #paint-region-list (one row).
    const regionRows = page.locator('#paint-region-list [data-region-id]');
    await expect(regionRows).toHaveCount(1);
    // Region name matches the label.
    await expect(regionRows.first()).toContainText('eye');

    // The new region is named after the label and covers the same triangle set
    // (so it matches what `partwright.paintByLabel('eye', ...)` would produce).
    const region = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const regions = pw.listRegions() as { name: string; triangles: number }[];
      return regions[0];
    });
    expect(region.name).toBe('eye');
    expect(region.triangles).toBe(expectedTris);

    // The label row now shows the ✓ already-painted hint.
    await expect(labelList.locator('[data-label-name="eye"]')).toContainText('✓');
  });

  test('per-part colour swatch sets a whole label colour and recolours in place', async ({ page }) => {
    await openEditorWithCode(page, `
      const { Manifold } = api;
      const head = api.label(Manifold.sphere(20, 32), 'head');
      const eye = api.label(Manifold.sphere(5, 16).translate([-8, 14, 5]), 'eye');
      return head.add(eye);
    `);

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    const labelList = page.locator('#paint-label-list');
    const swatch = labelList.locator('[data-label-name="eye"] button[data-action="set-label-color"]');
    await expect(swatch).toHaveCount(1);

    // The swatch opens the shared palette picker; choose a freeform colour and
    // Apply. Picking on the unpainted "eye" part commits a byLabel region with
    // that exact colour — no need to select the active colour first.
    const pickColor = async (hex: string) => {
      await swatch.dispatchEvent('click');
      await page.waitForSelector('[data-testid="color-picker"]');
      await page.evaluate((h) => {
        const ov = document.querySelector('[data-testid="color-picker"]')!;
        const ci = ov.querySelector('input[data-action="custom-color"]') as HTMLInputElement;
        ci.value = h;
        ci.dispatchEvent(new Event('input', { bubbles: true }));
      }, hex);
      await page.locator('[data-testid="color-picker"] button:has-text("Apply")').dispatchEvent('click');
      await page.waitForSelector('[data-testid="color-picker"]', { state: 'detached' });
    };

    await pickColor('#00ff00');

    let region = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regions = (window as any).partwright.listRegions() as { name: string; color: [number, number, number] }[];
      return regions.find(r => r.name === 'eye');
    });
    expect(region).toBeTruthy();
    expect(region!.color.map(c => Math.round(c * 255))).toEqual([0, 255, 0]);

    // Only one region for the part — re-picking recolours in place rather than
    // stacking a duplicate byLabel region.
    await pickColor('#0000ff');

    const eyeRegions = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const regions = (window as any).partwright.listRegions() as { name: string; color: [number, number, number] }[];
      return regions.filter(r => r.name === 'eye');
    });
    expect(eyeRegions).toHaveLength(1);
    expect(eyeRegions[0].color.map(c => Math.round(c * 255))).toEqual([0, 0, 255]);
  });

  test('empty state hints at api.label when no labels in the run', async ({ page }) => {
    await openEditorWithCode(page, `return api.Manifold.cube([10, 10, 10], true);`);

    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');

    const labelList = page.locator('#paint-label-list');
    await expect(labelList).toBeVisible();
    await expect(labelList).toContainText('No labels in this run');
    await expect(labelList).toContainText('api.label');
    // No row elements when empty.
    await expect(labelList.locator('[data-label-name]')).toHaveCount(0);
  });
});
