// Pins the two render-readability fixes against regression:
//
//  1. Unpainted triangles render as light gray (not pure white) so the
//     mesh silhouette is visible against the white background.
//  2. When the mesh carries paint, the wireframe overlay is skipped —
//     dense organic meshes otherwise compound 30%-black wireframe into
//     a dark mass that washes painted regions out.
//
// Both were diagnosed from agent feedback that "renderViews shows
// black for painted regions on imported meshes." The rendering
// pipeline always honored vertex colors; the actual problem was
// readability of the resulting PNG.

import { test, expect } from 'playwright/test';

interface PixelStats {
  total: number;
  meanBrightness: number;
  meanRed: number;
  meanGreen: number;
  meanBlue: number;
  redDominant: number;
  greenDominant: number;
  blueDominant: number;
  nearBlack: number;       // pixels with mean brightness < 0.15
  pureWhite: number;       // pixels with all channels > 0.97
}

async function decodeAndSample(page: import('playwright/test').Page, dataUrl: string): Promise<PixelStats> {
  return page.evaluate(async (url: string) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let total = 0, rSum = 0, gSum = 0, bSum = 0;
    let redDominant = 0, greenDominant = 0, blueDominant = 0;
    let nearBlack = 0, pureWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      total++;
      rSum += r; gSum += g; bSum += b;
      const mean = (r + g + b) / 3;
      if (mean < 0.15) nearBlack++;
      if (r > 0.97 && g > 0.97 && b > 0.97) pureWhite++;
      if (r > 0.4 && r - g > 0.15 && r - b > 0.15) redDominant++;
      if (g > 0.4 && g - r > 0.10 && g - b > 0.10) greenDominant++;
      if (b > 0.4 && b - r > 0.15 && b - g > 0.15) blueDominant++;
    }
    return {
      total,
      meanBrightness: (rSum + gSum + bSum) / (3 * total),
      meanRed: rSum / total,
      meanGreen: gSum / total,
      meanBlue: bSum / total,
      redDominant, greenDominant, blueDominant,
      nearBlack, pureWhite,
    };
  }, dataUrl);
}

test.describe('render-color readability', () => {
  test('unpainted mesh silhouette is visible against the white background', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const dataUrl = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.sphere(10, 32);');
      return pw.renderView({ elevation: 30, azimuth: 0, ortho: false, size: 240 });
    });
    expect(typeof dataUrl).toBe('string');

    const stats = await decodeAndSample(page, dataUrl);
    // The sphere covers a meaningful portion of the frame; if it
    // rendered as pure white against a white background, almost every
    // pixel would be (255,255,255). With the UNPAINTED_BASE = 0.85
    // fix, the sphere reads as a lighter gray with shaded sides — far
    // fewer pixels are pure white.
    const pureWhiteFraction = stats.pureWhite / stats.total;
    expect(pureWhiteFraction, `pure-white fraction ${pureWhiteFraction.toFixed(3)} — silhouette should NOT be invisible against the background`).toBeLessThan(0.7);
  });

  test('painted-region color reads cleanly above 5% of the composite', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Paint the top face of a cube red. Render the top view ortho —
    // the painted face fills the entire tile, so most pixels in that
    // tile should be red-dominant. Without the wireframe-suppression
    // fix, the 30%-black wireframe would crosshatch the red surface
    // and drag the red-dominant pixel count way down.
    const dataUrl = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      pw.paintInBox({ box: { min: [-12, -12, 9], max: [12, 12, 11] }, color: [1, 0, 0] });
      return pw.renderView({ elevation: 90, azimuth: 0, ortho: true, size: 240 });
    });
    expect(typeof dataUrl).toBe('string');

    const stats = await decodeAndSample(page, dataUrl);
    const redFraction = stats.redDominant / stats.total;
    expect(redFraction, `red-dominant pixels ${redFraction.toFixed(3)} of ${stats.total}; mean brightness ${stats.meanBrightness.toFixed(2)}; near-black ${stats.nearBlack}`).toBeGreaterThan(0.05);

    // And the render should NOT be dominated by near-black — that
    // would mean wireframe is still bleeding over the painted face.
    const nearBlackFraction = stats.nearBlack / stats.total;
    expect(nearBlackFraction, `near-black pixel fraction ${nearBlackFraction.toFixed(3)} — wireframe overlay should be suppressed on colored renders`).toBeLessThan(0.05);
  });

  test('renderViews on a multi-color paint job preserves each color distinctly', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const dataUrl = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      pw.paintInBox({ box: { min: [-12, -12, 9], max: [12, 12, 11] }, color: [1, 0, 0] }); // top: red
      pw.paintInBox({ box: { min: [9, -12, -12], max: [11, 12, 12] }, color: [0, 0.7, 0] }); // +X: green
      pw.paintInBox({ box: { min: [-12, -12, -11], max: [12, 12, -9] }, color: [0, 0, 1] }); // bottom: blue
      return pw.renderViews({ views: 'all', size: 200 });
    });
    expect(typeof dataUrl).toBe('string');

    const stats = await decodeAndSample(page, dataUrl);
    // Each painted face should show up in at least one tile of the
    // composite. Don't enforce per-tile counts (the auto-angle picker
    // could vary), just require each color to be visibly present.
    expect(stats.redDominant, `red ${stats.redDominant}/${stats.total}`).toBeGreaterThan(50);
    expect(stats.greenDominant, `green ${stats.greenDominant}/${stats.total}`).toBeGreaterThan(50);
    expect(stats.blueDominant, `blue ${stats.blueDominant}/${stats.total}`).toBeGreaterThan(50);
  });
});
