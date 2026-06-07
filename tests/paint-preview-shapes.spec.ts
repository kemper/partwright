// Golden path for the analytic-shape selectors on paintPreview: the
// `cylinder` and `slab` dry-run forms added so paintInCylinder / paintSlab
// can be validated without the commit -> render -> undo round-trip. A
// preview must return the same (unsmoothed) selection the real paint op
// would seed, and must reject malformed shells.

import { test, expect } from 'playwright/test';

test.describe('paintPreview analytic shapes', () => {
  test('cylinder and slab previews select triangles and match the paint op', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // A hollow tube: outer R=10, inner R=6, height 20. Its inner wall is the
    // canonical paintInCylinder target.
    const ran = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.run(
        'const outer = api.Manifold.cylinder(20, 10, 10, 64);' +
        'const inner = api.Manifold.cylinder(22, 6, 6, 64).translate([0, 0, -1]);' +
        'return outer.subtract(inner);',
      );
    });
    expect(ran.error).toBeUndefined();

    // Dry-run the inner wall via the new cylinder selector.
    const cyl = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({ cylinder: { rMin: 5.5, rMax: 6.5, zMin: 1, zMax: 19 } });
    });
    expect(cyl.error).toBeUndefined();
    expect(cyl.triangleCount).toBeGreaterThan(0);
    // The inner wall sits at radius ~6, so the bbox must stay inside the outer skin.
    expect(cyl.bbox.max[0]).toBeLessThanOrEqual(6.6);

    // The preview's count must equal what paintInCylinder seeds with smoothing
    // OFF (preview never subdivides, so compare against smooth:false).
    const committed = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintInCylinder({ rMin: 5.5, rMax: 6.5, zMin: 1, zMax: 19, smooth: false, color: [0.2, 0.6, 1] });
    });
    expect(committed.error).toBeUndefined();
    expect(committed.triangles).toBe(cyl.triangleCount);

    // Dry-run a Z slab band across the bottom of the tube.
    const slab = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({ slab: { axis: 'z', offset: 0, thickness: 4 } });
    });
    expect(slab.error).toBeUndefined();
    expect(slab.triangleCount).toBeGreaterThan(0);
    expect(slab.bbox.min[2]).toBeGreaterThanOrEqual(-0.01);

    // Malformed shells are rejected, not silently empty.
    const bad = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({ cylinder: { rMin: 8, rMax: 4, zMin: 0, zMax: 10 } });
    });
    expect(bad.error).toMatch(/rMin >= 0 and rMax > rMin/);

    // Visual sanity check for the manual-verification screenshot.
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({
        cylinder: { rMin: 5.5, rMax: 6.5, zMin: 1, zMax: 19 },
        withImage: true,
        view: { elevation: 25, azimuth: 35, size: 360 },
      });
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/paint-preview-shapes.png' });
  });
});
