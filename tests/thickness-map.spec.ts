// partwright.thicknessMap: the exact per-triangle wall-thickness map — thin
// spots located and ranked, an optional heatmap image, argument validation.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('thickness map', () => {
  test('finds the thin floor of a pocketed plate and renders a heatmap', async () => {
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown>> }).partwright;
      await pw.createSession('thickness-map');
      // 40×40×3 plate; a 10×10 pocket leaves a 0.6 floor at x 25..35, y 5..15.
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([40, 40, 3]).subtract(Manifold.cube([10, 10, 3]).translate([25, 5, 0.6]));');
      const map = await pw.thicknessMap({ threshold: 1, render: true, views: 'tri', size: 128 }) as Record<string, unknown> & { spots: { thickness: number; center: number[] }[]; image?: string };
      const bad = await pw.thicknessMap({ threshold: 'thin' }) as { error?: string };
      return { ...map, image: typeof map.image === 'string' ? map.image.slice(0, 22) : null, bad };
    });
    expect(out.minThickness).toBeCloseTo(0.6, 3);
    expect(out.spotCount).toBe(1);
    expect(out.spots[0].thickness).toBeCloseTo(0.6, 3);
    expect(out.spots[0].center[0]).toBeCloseTo(30, 0);
    expect(out.spots[0].center[1]).toBeCloseTo(10, 0);
    expect(out.image).toBe('data:image/png;base64,');
    expect(out.bad.error).toMatch(/threshold/);
  });
});
