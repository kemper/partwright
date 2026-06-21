// Golden path for the view-based image-stamp placement (window.partwright.paintImage
// with `view` instead of explicit at+normal). Covers the resolver added in
// src/color/imagePaintPlacement.ts end-to-end against the real engine + mesh:
// build a box, project a transparent-background graphic onto the FRONT face, and
// assert the decal landed (triangles painted, the orange subject's avg colour).
// The unit tier (tests/unit/imagePaintPlacement.test.ts) covers the math; this
// proves the full console path wires up.

import { test, expect } from 'playwright/test';
import type { Page } from 'playwright/test';

async function openEditor(page: Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  const skip = page.locator('button:has-text("Skip")');
  if (await skip.count()) await skip.first().dispatchEvent('click').catch(() => {});
}

test('paintImage(view) projects a graphic onto the named view face', async ({ page }) => {
  await openEditor(page);

  // A 40×20×60 box: front face (the -Y side) is what `view: 'front'` projects onto.
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([40, 20, 60], true);`);
  });
  await page.waitForTimeout(800);

  // Transparent-background graphic: an orange disc (the only thing that should paint).
  const imageUrl = await page.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = '#e08a1e';
    ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
    return cv.toDataURL('image/png');
  });

  const res = await page.evaluate(async (url) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    return await pw.paintImage({ imageUrl: url, view: 'front', size: 30 });
  }, imageUrl) as { ok?: boolean; triangles?: number; avgColor?: [number, number, number]; error?: string };

  expect(res.error).toBeUndefined();
  expect(res.ok).toBe(true);
  expect(res.triangles ?? 0).toBeGreaterThan(0);
  // The painted subject is orange: red channel clearly dominates blue.
  const [r, , b] = res.avgColor ?? [0, 0, 0];
  expect(r).toBeGreaterThan(b);

  // An unknown view is rejected with an actionable error (not a silent miss).
  const bad = await page.evaluate(async (url) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    return await pw.paintImage({ imageUrl: url, view: 'sideways', size: 30 });
  }, imageUrl) as { error?: string };
  expect(bad.error).toBeTruthy();
});
