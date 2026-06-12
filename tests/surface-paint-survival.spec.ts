// Brush-stroke paint must survive an in-code surface texture.
//
// api.label / byLabel colors are carried onto the denser textured mesh by the
// nearest-centroid remap (remapTriangleSets); geometric api.paint.* regions and
// manually brush-painted strokes instead re-resolve from their stored geometry
// descriptor against whatever mesh is current when the run resolves colors —
// which, for an in-code texture, is already the textured mesh. This spec pins
// that a freehand brush stroke (the index/sample-based sidecar region, the one
// that does NOT go through the label remap) is still visible after an
// `api.surface.*` texture applies on the next run.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

/** Fraction of red-dominant pixels in a renderViews composite — the same
 *  heuristic paint-render-color.spec uses to prove the renderer emits color. */
async function redFraction(page: Page, dataUrl: string): Promise<number> {
  return page.evaluate(async (url: string) => {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height).data;
    let red = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++;
      if (r > 100 && r - g > 40 && r - b > 40) red++;
    }
    return total ? red / total : 0;
  }, dataUrl);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('partwright-tour-completed', '1');
  });
});

test('a brush stroke survives an in-code surface texture', async ({ page }) => {
  await page.goto('/editor');
  await waitForEngine(page);

  const cubeCode = 'return api.Manifold.cube([20, 20, 20]);';
  const texturedCode = [
    "api.surface.knurl({ cellWidth: 2.2, amplitude: 0.6 });",
    cubeCode,
  ].join('\n');

  const out = await page.evaluate(async ({ cubeCode, texturedCode }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.createSession('paint-survival');
    await pw.run(cubeCode);
    // Freehand brush stroke on the top face (the sample/descriptor sidecar path).
    const stroke = pw.paintStroke({ points: [[10, 10, 20]], radius: 7, color: [1, 0, 0] });
    if (stroke?.error) return { error: stroke.error };
    const before = await pw.renderViews({ views: 'tri', size: 200 });
    // Re-run with an in-code texture: the textured mesh is denser/displaced, so
    // the stroke must re-resolve from its descriptor onto it.
    const run = await pw.run(texturedCode);
    if (run?.error) return { error: run.error };
    const after = await pw.renderViews({ views: 'tri', size: 200 });
    return { before, after, triangles: stroke?.triangles ?? 0 };
  }, { cubeCode, texturedCode });

  expect(out.error).toBeUndefined();
  const beforeRed = await redFraction(page, out.before as string);
  const afterRed = await redFraction(page, out.after as string);

  // The stroke painted red before the texture…
  expect(beforeRed, `red before = ${(beforeRed * 100).toFixed(2)}%`).toBeGreaterThan(0.01);
  // …and is still clearly visible after the texture applied (re-resolved onto the
  // denser mesh). Allow some erosion from the displaced silhouette, but it must
  // stay well above noise.
  expect(afterRed, `red after = ${(afterRed * 100).toFixed(2)}%`).toBeGreaterThan(0.005);

  await page.screenshot({ path: 'test-results/surface-paint-survival.png' });
});
