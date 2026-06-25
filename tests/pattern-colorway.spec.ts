import { test, expect } from 'playwright/test';
import sharp from 'sharp';

// Golden path for api.paint.pattern: a striped colourway must render with at
// least two distinct coat colours in the editor viewport. Guards the live-run
// perTriColors path (a regression there renders the whole coat one flat colour —
// the headless preview can't catch it because it resolves perTriColors directly).
test('api.paint.pattern renders multiple coat colors in-app', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForFunction(() => (window as any).partwright?.runAndSave, null, { timeout: 60000 });

  const code = `
    const body = api.label(api.Manifold.sphere(12, 64).refine(3), 'body', { color: '#D6913E' });
    api.paint.pattern({ pattern: 'stripes', colors: ['#D6913E', '#5A3A1F'], scope: 'body', axis: 'z', scale: 5, warp: 0.45 });
    return body;
  `;
  const run = await page.evaluate(async (src) => {
    const r = await (window as any).partwright.runAndSave(src, 'pattern-spec', { isManifold: true });
    return { passed: r?.passed, colorCount: (window as any).partwright.getModelColors?.()?.count ?? 0 };
  }, code);
  expect(run.passed).toBe(true);
  expect(run.colorCount).toBeGreaterThanOrEqual(2); // base + pattern region both present

  // dismiss onboarding so the viewport is unobstructed, let it settle
  const skip = page.getByText('Skip', { exact: true });
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(2500);

  // Screenshot the viewport canvas (Playwright captures the composited frame
  // reliably, unlike readPixels on a non-preserved WebGL buffer), then count
  // distinct WARM coat colours. The light base (#D6913E) and the dark stripe
  // (#5A3A1F) must BOTH appear — with the bug they'd collapse to one.
  const canvas = page.locator('canvas').first();
  const png = await canvas.screenshot();
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const seen = new Set<string>();
  for (let i = 0; i < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r < 45 && g < 45 && b < 45) continue;   // dark background
    if (!(r > g && g >= b)) continue;            // keep warm coat tones only
    seen.add(`${r >> 5}-${g >> 5}-${b >> 5}`);   // quantize to 8 levels/channel
  }
  expect(seen.size).toBeGreaterThanOrEqual(2);
});
