// The fast (coarse) SDF preview pass paints an ESTIMATE of the model's
// in-code colours onto the rough mesh — api.label({color}) and api.paint.*
// both resolve against the coarse mesh — so the user sees roughly the right
// colours immediately instead of bare grey, then it sharpens to the full
// render. This guards that the preview frame is actually coloured.
//
// See src/main.ts colorMeshFromModel() + the onEnginePreview callback, and the
// engineWorker.ts / engine.ts plumbing that carries label/paint data on the
// execute_preview message.

import { test, expect } from 'playwright/test';
import sharp from 'sharp';

// Fine edgeLength => slow full pass, so the coarse preview is up for seconds —
// wide enough to screenshot deterministically. Red top half, blue bottom half.
const MODEL = `
const sdf = api.sdf;
const body = sdf.sphere(16);
const arm = sdf.box([42, 9, 9]);
const shape = body.smoothUnion(arm, 3).build({ edgeLength: 0.07 });
api.paint.box({ min: [-45, -45, 0],   max: [45, 45, 45], color: '#e23b3b' });
api.paint.box({ min: [-45, -45, -45], max: [45, 45, 0],  color: '#2f6fe0' });
return shape;
`;

test.describe('fast preview colour estimate', () => {
  test('coarse SDF preview shows the model\'s in-code paint colours', async ({ page }) => {
    test.setTimeout(90_000);
    // Skip the onboarding tour so its popup doesn't occlude the viewport.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as { partwright?: { run?: unknown } }).partwright?.run, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);

    // Fire the run without awaiting so the transient coarse-preview frame is on
    // screen while we screenshot it. The full render replaces it afterwards.
    await page.evaluate((code) => {
      (window as unknown as { partwright: { run: (c: string) => Promise<unknown> } }).partwright.run(code);
    }, MODEL);

    // The "⚡ Fast preview" pill is up exactly while the coarse mesh is shown.
    const pill = page.getByText('⚡ Fast preview');
    await pill.waitFor({ state: 'visible', timeout: 30_000 });

    // Screenshot the viewport canvas while the coarse preview is displayed.
    const shot = await page.locator('#viewport').screenshot();

    // Count strongly red- vs blue-dominant pixels. Shading darkens the colours
    // but never inverts the dominant channel, so a hue test is robust to lights.
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    // Scene lighting darkens the surface, so the colours read as dim — but the
    // dominant channel never inverts (red stays r>g,b; blue stays b>r,g), which
    // a grey/unpainted surface (r≈g≈b) can never satisfy.
    const ch = info.channels;
    let red = 0, blue = 0;
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 45 && r - g > 22 && r - b > 18) red++;
      if (b > 45 && b - r > 18 && b - g > 10) blue++;
    }

    // Both halves' colours must be visible on the coarse preview — proving the
    // estimate is painted, not bare grey.
    expect(red, 'red (top half) pixels on the preview').toBeGreaterThan(300);
    expect(blue, 'blue (bottom half) pixels on the preview').toBeGreaterThan(300);
  });

  // The real-world case: a painted CATALOG figure. Its colours live in saved
  // `byLabel` paint regions (not in code), staged into the store before the run
  // so the coarse preview can re-resolve them against the rough mesh. Without
  // this the figure renders bare grey for the tens of seconds it takes to fully
  // mesh. (Guards the colorCoarsePreview + stage-before-run wiring.)
  test('a painted catalog figure shows its colours on the coarse preview', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor?catalog=superhero.partwright.json');

    const pill = page.getByText('⚡ Fast preview');
    await pill.waitFor({ state: 'visible', timeout: 40_000 });
    await page.waitForTimeout(300);
    const shot = await page.locator('#viewport').screenshot();

    // Sample the centre region (where the figure is), ignoring the toolbar UI.
    // A coloured figure has substantial chroma; a grey/unpainted one has almost
    // none (skin/cloth all collapse to r≈g≈b).
    const { data, info } = await sharp(shot)
      .extract({ left: 120, top: 150, width: 320, height: 320 })
      .raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let chroma = 0;
    for (let i = 0; i < data.length; i += ch) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 18 && g < 18 && b < 18) continue; // background
      if (Math.max(r, g, b) - Math.min(r, g, b) > 18) chroma++;
    }
    expect(chroma, 'chroma (coloured) pixels on the figure preview').toBeGreaterThan(1500);
  });
});
