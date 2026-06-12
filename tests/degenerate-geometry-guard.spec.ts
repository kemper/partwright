import { test, expect } from 'playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Regression coverage for the "typing `return Manifold.sphere()` freezes the
// app" bug. Two independent guards:
//   1. The manifold-js sandbox rejects a missing/NaN required dimension up
//      front (so the kernel never builds a silent zero-size solid).
//   2. The viewport's frameModel() refuses to frame a zero-size / non-finite
//      bounding box (which otherwise drove OrbitControls into a non-converging
//      NaN damping loop — the actual freeze).

const VALID_SPHERE = 'const { Manifold } = api; return Manifold.sphere(15);';

test.describe('degenerate-geometry guards', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120000);
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.run, null, { timeout: 30000 });
    await page.waitForTimeout(3000); // WASM + viewport settle
  });

  test('primitive constructors reject a missing required dimension', async ({ page }) => {
    // sphere(): radius is required and has no default.
    const sphere = await page.evaluate((c) => (window as any).partwright.run(c), 'const { Manifold } = api; return Manifold.sphere();');
    expect(String(sphere.error ?? '')).toContain('Manifold.sphere(radius)');

    // cylinder(): height + radiusLow are both required.
    const cyl = await page.evaluate((c) => (window as any).partwright.run(c), 'const { Manifold } = api; return Manifold.cylinder();');
    expect(String(cyl.error ?? '')).toContain('Manifold.cylinder(height)');

    // circle(): radius is required.
    const circle = await page.evaluate((c) => (window as any).partwright.run(c), 'const { CrossSection } = api; return CrossSection.circle().extrude(5);');
    expect(String(circle.error ?? '')).toContain('CrossSection.circle(radius)');

    // The main thread stays responsive throughout (no freeze).
    expect(await page.evaluate(() => 2 + 2)).toBe(4);
  });

  test('cube() / square() with no args still build their default unit shape', async ({ page }) => {
    // These have a documented default, so omitting the size must remain valid.
    const cube = await page.evaluate((c) => (window as any).partwright.run(c), 'const { Manifold } = api; return Manifold.cube();');
    expect(cube.isManifold).toBe(true);
    expect(cube.error ?? null).toBeNull();
  });

  test('a valid-but-degenerate zero-size mesh does not push the camera to NaN', async ({ page }) => {
    // Baseline frame.
    await page.evaluate((c) => (window as any).partwright.run(c), VALID_SPHERE);
    const before = await page.evaluate(() => (window as any).partwright.getViewState().camera);
    expect(Number.isFinite(before.distance)).toBe(true);

    // sphere(15).scale(0): a real Manifold whose vertices are all coincident.
    // This bypasses guard #1 (radius 15 is valid) and exercises frameModel's
    // degenerate-bounds bail-out.
    await page.evaluate((c) => (window as any).partwright.run(c), 'const { Manifold } = api; return Manifold.sphere(15).scale(0);');
    const after = await page.evaluate(() => (window as any).partwright.getViewState().camera);
    expect(Number.isFinite(after.distance)).toBe(true);
    expect(Number.isFinite(after.azimuth)).toBe(true);
    expect(Number.isFinite(after.elevation)).toBe(true);
    expect(after.target.every((n: number) => Number.isFinite(n))).toBe(true);

    // A fresh valid model re-frames normally afterwards.
    await page.evaluate((c) => (window as any).partwright.run(c), 'const { Manifold } = api; return Manifold.sphere(40);');
    const recovered = await page.evaluate(() => (window as any).partwright.getViewState().camera);
    expect(Number.isFinite(recovered.distance) && recovered.distance > 0).toBe(true);
  });
});
