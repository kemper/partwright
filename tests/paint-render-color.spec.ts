// Visual smoke test: build a mesh, paint a region, render via the same
// path the AI uses, and confirm the PNG actually shows the painted
// color. Exists specifically to refute / confirm the AI feedback that
// "renderViews shows black for painted regions on imported meshes."

import { test, expect } from 'playwright/test';

test('renderViews shows painted colors on the resulting PNG', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });

  const result = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run('return api.Manifold.cube([20, 20, 20]);');
    const painted = pw.paintInBox({
      box: { min: [-1, -1, 19], max: [21, 21, 21] },
      color: [1, 0, 0],
    });
    if (painted.error) return { stage: 'paint', error: painted.error };
    // Render the top view via renderViews — this is the same path the
    // AI tool exercises.
    const composite = await pw.renderViews({ views: 'tri', size: 200 });
    return { stage: 'render', dataUrl: composite, painted };
  });

  expect(result.error).toBeUndefined();
  expect(typeof result.dataUrl).toBe('string');
  expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);

  // Decode the PNG in the test page, sample pixels, and look for red.
  // If the renderer were dropping vertex colors, no pixel would be
  // dominantly red — every visible mesh pixel would be white-ish.
  const stats = await page.evaluate(async (dataUrl: string) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let redDominant = 0;
    let total = 0;
    let darkSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++;
      // Heuristic: a pixel is "red-dominant" when r is meaningfully
      // higher than both g and b. Anti-aliasing + lighting tint mean
      // pure (255,0,0) is rare; require a 40-point margin.
      if (r > 100 && r - g > 40 && r - b > 40) redDominant++;
      darkSum += (r + g + b) / 3;
    }
    return { total, redDominant, meanBrightness: darkSum / total, width: img.width, height: img.height };
  }, result.dataUrl);

  // The composite contains 3 angles in a grid (front, top, iso). The
  // top face was painted red on a 20×20×20 cube, so the top and iso
  // tiles should each show a red region. Expect at least ~1% of pixels
  // to be red-dominant — a generous lower bound that proves the
  // renderer IS emitting colors.
  expect(stats.redDominant / stats.total, `mean brightness ${stats.meanBrightness.toFixed(1)} / ${stats.total} pixels, ${stats.redDominant} red-dominant`).toBeGreaterThan(0.01);
});
