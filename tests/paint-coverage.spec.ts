// Verifies the new selector options (coverageMode, maxTriangleArea) on
// paintPreview actually change which triangles get selected. Uses a
// cylinder so the mesh has known fan topology — the top face's triangles
// each span from center to rim, so a small box around the center catches
// many by *centroid* but few by *fully_inside*.

import { test, expect } from 'playwright/test';

test.describe('paint coverage filters', () => {
  test('coverageMode and area stats defang fan-topology bleed', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Build a 12-segment cylinder of radius 10 centered at origin. The top
    // face at z=2 is a fan of 12 triangles, each one a thin wedge from
    // (0,0,2) out to two adjacent rim vertices ~10 units away.
    const ran = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.run('return api.Manifold.cylinder(2, 10, 10, 12);');
      return r;
    });
    expect(ran.error).toBeUndefined();

    // Box covering only the central column of the top face. With centroid
    // mode, the fan wedges whose centroid is inside (centroid is ~1/3 of
    // the way from center to rim — about 3.3 units out) get picked up,
    // even though their rim vertices extend to ~10 units. With
    // fully_inside the same box catches strictly fewer triangles.
    const centroid = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({ box: { min: [-4, -4, 1.9], max: [4, 4, 2.1] } });
    });
    const fullyInside = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({
        box: { min: [-4, -4, 1.9], max: [4, 4, 2.1] },
        coverageMode: 'fully_inside',
      });
    });

    expect(centroid.triangleCount, 'centroid mode catches fan wedges').toBeGreaterThan(0);
    expect(fullyInside.triangleCount, 'fully_inside strictly narrower than centroid').toBeLessThan(centroid.triangleCount);

    // The new area stats are present and the centroid-mode largest is
    // visibly bigger than the fully_inside one (because the long wedges
    // got filtered out).
    expect(centroid).toHaveProperty('totalArea');
    expect(centroid).toHaveProperty('largestTriangleArea');
    expect(centroid.largestTriangleArea).toBeGreaterThan(0);
    expect(centroid.totalArea).toBeGreaterThan(0);
    if (fullyInside.triangleCount > 0) {
      expect(centroid.largestTriangleArea).toBeGreaterThanOrEqual(fullyInside.largestTriangleArea);
    }

    // maxTriangleArea backstop: passing a value smaller than the fan
    // wedges' area should drop them entirely. The wedges in this
    // 12-segment cylinder have area ~13 sq units; capping at 1 drops them.
    const capped = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.paintPreview({
        box: { min: [-4, -4, 1.9], max: [4, 4, 2.1] },
        maxTriangleArea: 1,
      });
    });
    expect(capped.triangleCount, 'maxTriangleArea filters fan wedges').toBeLessThan(centroid.triangleCount);
  });

  test('paintExplain reports largestTriangleArea', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([10, 10, 10]);');
      const painted = pw.paintInBox({ box: { min: [-1, -1, -1], max: [11, 11, 11] }, color: [1, 0, 0] });
      return pw.paintExplain({ region: painted.id, withImage: false });
    });
    expect(result.error).toBeUndefined();
    expect(result).toHaveProperty('largestTriangleArea');
    expect(result.largestTriangleArea).toBeGreaterThan(0);
    expect(result.area).toBeGreaterThan(0);
    expect(result.normalHistogram).toBeDefined();
  });
});
