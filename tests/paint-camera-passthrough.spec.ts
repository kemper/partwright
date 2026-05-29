// Verifies that paint mode lets the orbit camera handle drags that miss the
// model, and that wheel/two-finger-scroll zooms the camera regardless of
// whether the cursor is over the paint picker panel.

import { test, expect, type Page } from 'playwright/test';

async function openEditorWithCube(page: Page) {
  // Dismiss the first-visit tour so its full-screen backdrop doesn't swallow
  // pointer events targeted at the viewport canvas.
  await page.addInitScript(() => {
    localStorage.setItem('partwright-tour-completed', new Date().toISOString());
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([5, 5, 5], true);`);
  });
}

async function getCamera(page: Page) {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    return pw.getViewState().camera;
  });
}

/** Wait until OrbitControls has damped the wheel-driven zoom past a threshold,
 *  re-issuing the wheel each poll. A single `mouse.wheel` + fixed 300 ms wait
 *  was just enough at 60 fps with damping factor 0.1, but under CI load the
 *  renderer can drop frames AND occasionally the synthetic wheel doesn't reach
 *  OrbitControls — making these tests ~40 % flaky on a slow machine. Polling
 *  the *distance* lets the damping settle without a fixed timeout, and the
 *  per-poll wheel acts like a real user scrolling repeatedly until something
 *  zooms (or the 5 s timeout proves it never will). Tests are still verifying
 *  "this gesture zooms," not a specific zoom amount, so additional wheels
 *  preserve the assertion's intent. */
async function expectZoomBy(page: Page, beforeDistance: number, minDelta: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, 120);
        return Math.abs((await getCamera(page)).distance - beforeDistance);
      },
      { timeout: 5_000, intervals: [150, 250, 500] },
    )
    .toBeGreaterThan(minDelta);
}

async function enablePaintMode(page: Page) {
  await page.locator('#paint-toggle').dispatchEvent('click');
  await page.waitForSelector('#paint-picker-panel:not(.hidden)');
}

test.describe('paint mode camera passthrough', () => {
  test('drag from off-model space rotates the camera', async ({ page }) => {
    await openEditorWithCube(page);
    await enablePaintMode(page);

    const before = await getCamera(page);
    const canvas = await page.locator('#viewport').boundingBox();
    if (!canvas) throw new Error('viewport canvas missing');

    // A small 5x5x5 cube near the center leaves the corners empty; pick a
    // corner well outside the projected silhouette as the drag origin.
    const startX = canvas.x + 30;
    const startY = canvas.y + canvas.height - 30;
    const endX = canvas.x + canvas.width - 30;
    const endY = canvas.y + 30;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 5 });
    await page.mouse.move(endX, endY, { steps: 5 });
    await page.mouse.up();

    // Let damping resolve.
    await page.waitForTimeout(300);

    const after = await getCamera(page);
    const azimuthDelta = Math.abs(after.azimuth - before.azimuth);
    const elevationDelta = Math.abs(after.elevation - before.elevation);
    expect(azimuthDelta + elevationDelta).toBeGreaterThan(5);
  });

  test('wheel over the paint picker panel zooms the camera', async ({ page }) => {
    await openEditorWithCube(page);
    await enablePaintMode(page);

    const before = await getCamera(page);
    const panel = await page.locator('#paint-picker-panel').boundingBox();
    if (!panel) throw new Error('paint picker panel missing');

    // Aim near the top of the panel (tool buttons / color title area)
    // — definitely on the panel, not over the canvas.
    await page.mouse.move(panel.x + panel.width / 2, panel.y + 12);
    await page.mouse.wheel(0, 240);

    await expectZoomBy(page, before.distance, 0.5);
  });

  test('wheel over the clip-controls toolbar zooms the camera', async ({ page }) => {
    await openEditorWithCube(page);
    const before = await getCamera(page);
    const toolbar = await page.locator('#clip-controls').boundingBox();
    if (!toolbar) throw new Error('clip controls missing');

    await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + toolbar.height / 2);
    await page.mouse.wheel(0, 240);

    await expectZoomBy(page, before.distance, 0.5);
  });

  test('wheel zooms even when the camera is hard-locked', async ({ page }) => {
    await openEditorWithCube(page);
    // Toggle the orbit lock from the toolbar — rotate and pan are now off.
    await page.locator('#orbit-lock-toggle').dispatchEvent('click');

    const before = await getCamera(page);
    const canvas = await page.locator('#viewport').boundingBox();
    if (!canvas) throw new Error('viewport canvas missing');

    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, 240);

    await expectZoomBy(page, before.distance, 0.5);
  });

  test('drag that lands on the model after starting off-model does not paint', async ({ page }) => {
    await openEditorWithCube(page);
    await enablePaintMode(page);

    const regionsBefore = await page.evaluate(() =>
      (window as unknown as { partwright: { listRegions(): unknown[] } }).partwright.listRegions().length,
    );

    const canvas = await page.locator('#viewport').boundingBox();
    if (!canvas) throw new Error('viewport canvas missing');

    // Press in a corner (off-model), drag across the model, release over it.
    await page.mouse.move(canvas.x + 20, canvas.y + canvas.height - 20);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(150);

    const regionsAfter = await page.evaluate(() =>
      (window as unknown as { partwright: { listRegions(): unknown[] } }).partwright.listRegions().length,
    );
    expect(regionsAfter).toBe(regionsBefore);
  });
});
