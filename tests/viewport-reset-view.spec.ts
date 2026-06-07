// Golden-path tests for the viewport "Reset View" button and the zoom-out limit:
//  - the Reset View button lives in the clip-controls overlay
//  - zooming out past the limit clamps the camera distance (it can't shrink the
//    model to a speck) — maxDistance = model's largest dim × maxZoomOutFactor
//  - clicking Reset View re-frames the camera to the default 3/4 view
//
// Uses dispatchEvent('click') instead of .click() to dodge the onboarding tour
// backdrop that can intercept pointer events on first load of the editor.

import { test, expect, type Page } from 'playwright/test';

// A 10×10×10 cube → largest dimension 10, so with the default maxZoomOutFactor
// of 12 the camera can dolly out to at most distance 120.
const CUBE = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';

function cameraDistance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pw = (window as unknown as { partwright: { getViewState(): { camera: { distance: number } } } }).partwright;
    return pw.getViewState().camera.distance;
  });
}

async function openEditorWithCube(page: Page): Promise<void> {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async (code) => {
    const pw = (window as unknown as { partwright: { run(code: string): Promise<unknown> } }).partwright;
    await pw.run(code);
  }, CUBE);
  await page.waitForTimeout(1000); // let the viewport auto-frame the new mesh
}

test('zoom-out is clamped to the max-distance limit', async ({ page }) => {
  await openEditorWithCube(page);

  const framed = await cameraDistance(page);
  expect(framed).toBeGreaterThan(0);

  // Wheel out hard — without the limit this would push the camera arbitrarily
  // far back. Dispatch real wheel events on the canvas (OrbitControls' input).
  await page.evaluate(async () => {
    const canvas = document.querySelector('#viewport') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 80; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 400, clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
      await new Promise(res => requestAnimationFrame(() => res(null)));
    }
  });
  await page.waitForTimeout(600);

  const zoomedOut = await cameraDistance(page);
  expect(zoomedOut).toBeGreaterThan(framed);   // it did zoom out
  expect(zoomedOut).toBeLessThanOrEqual(121);   // ...but no further than the cap
});

test('Reset View re-frames the camera to the default view', async ({ page }) => {
  await openEditorWithCube(page);

  const resetBtn = page.locator('#reset-view');
  await expect(resetBtn).toBeVisible();

  const framed = await cameraDistance(page);

  // Zoom out so the view is no longer at the default framing.
  await page.evaluate(async () => {
    const canvas = document.querySelector('#viewport') as HTMLCanvasElement;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < 40; i++) {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 400, clientX: cx, clientY: cy, bubbles: true, cancelable: true,
      }));
      await new Promise(res => requestAnimationFrame(() => res(null)));
    }
  });
  await page.waitForTimeout(400);
  expect(await cameraDistance(page)).toBeGreaterThan(framed + 1);

  // Reset returns to the default framing distance.
  await resetBtn.dispatchEvent('click');
  await page.waitForTimeout(600);
  expect(Math.abs(await cameraDistance(page) - framed)).toBeLessThan(1);
});
