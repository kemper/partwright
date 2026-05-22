// Verifies the "paint by visual reasoning" workflow:
//   render -> identify pixel -> probePixel -> paintConnected
//
// The agent uses this to autonomously translate "what I can see in the
// rendered image" into a world-space hit, then flood-fill from there
// gated by seed-normal deviation.

import { test, expect } from 'playwright/test';

test.describe('paint by vision', () => {
  test('probePixel round-trips a known top-face pixel back to a hit on +Z', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Cube centered at origin: top face at z=10, normal (0,0,1). Render
    // the top view orthographically — the cube's top face fills the
    // entire square. Center pixel projects onto the surface at z=10.
    const probe = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      const view = { elevation: 90, azimuth: 0, ortho: true, size: 200 };
      return pw.probePixel({ pixel: [100, 100], view });
    });

    expect(probe).not.toBeNull();
    expect(probe.error).toBeUndefined();
    expect(probe.point[2]).toBeCloseTo(10, 1);
    // Top-face normal is +Z (within numerical tolerance, and dependent on
    // which triangle of the top face split the ray hits).
    expect(probe.normal[2]).toBeGreaterThan(0.95);
    expect(probe.triangleId).toBeGreaterThanOrEqual(0);
  });

  test('probePixel returns a re-aim diagnostic (not bare null) for a background pixel', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Small sphere at origin rendered in a large viewport — the [5,5]
    // corner misses the mesh. The miss must now report where the model
    // actually projects so the caller can re-aim instead of giving up.
    // Use an ortho view so the projected AABB bounds are deterministic
    // (perspective near-corners overshoot the frame; ortho does not).
    const probe = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.sphere(2, 32);');
      const view = { elevation: 90, azimuth: 0, ortho: true, size: 200 };
      return pw.probePixel({ pixel: [5, 5], view });
    });

    expect(probe).not.toBeNull();
    expect(probe.hit).toBe(false);
    expect(probe.point).toBeUndefined();
    expect(typeof probe.hint).toBe('string');
    expect(probe.hint).toContain('pixels');
    const b = probe.modelPixelBounds;
    expect(b).toBeTruthy();
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
    // The sphere sits centered in the 200px frame, well clear of the
    // [5,5] corner we probed — the reported bounds prove that.
    expect(b.minX).toBeGreaterThan(5);
    expect(b.minY).toBeGreaterThan(5);
  });

  test('probePixel hits the center of a model NOT centered on the origin', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // The session that motivated this work painted an imported model whose
    // bbox was far from the origin. buildViewCamera frames the model's own
    // bbox, so the center pixel must still land on the surface — confirming
    // the "probePixel is broken on off-origin models" theory was a red
    // herring (the real cause was missed aim with no recovery signal).
    const probe = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20, 20, 20], true).translate([40, 29, 40]);');
      const view = { elevation: 90, azimuth: 0, ortho: true, size: 200 };
      return pw.probePixel({ pixel: [100, 100], view });
    });

    expect(probe.error).toBeUndefined();
    expect(probe.hit).toBeUndefined(); // a hit, not a miss
    expect(probe.point).toBeDefined();
    // Top face of the off-origin cube is at z = 40 + 10 = 50.
    expect(probe.point[2]).toBeCloseTo(50, 1);
    expect(probe.normal[2]).toBeGreaterThan(0.95);
    expect(typeof probe.nextStep).toBe('string');
  });

  test('paintConnected floods from a seed gated by deviation from the seed normal', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Cube: 6 flat faces each 90° from the next. paintConnected with
    // a 30° deviation from the top-face seed should pick up the entire
    // top face but NOT the side or bottom faces.
    const painted = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      return pw.paintConnected({
        seed: { point: [0, 0, 10], normal: [0, 0, 1] },
        maxDeviationDeg: 30,
        color: [1, 0, 0],
      });
    });

    expect(painted.error).toBeUndefined();
    expect(painted.triangles).toBeGreaterThan(0);

    // Top face on a cube is 2 triangles. paintConnected with a 30°
    // tolerance from the +Z seed should NOT cross to the sides (which
    // are at 90° from +Z) — so we should see exactly 2 triangles, the
    // top face. Don't enforce the exact count (manifold-3d may emit
    // more triangles per face on some configurations); just bound it.
    expect(painted.triangles).toBeLessThanOrEqual(8);

    // Verify the painted region's normal histogram is dominated by +Z.
    const explain = await page.evaluate(async (id: number) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const result = pw.paintExplain?.({ region: id, withImage: false });
      return result ?? null;
    }, painted.id);
    // paintExplain is in a separate PR; if not on this branch, skip.
    if (explain && explain.normalHistogram) {
      expect(explain.normalHistogram.zPos).toBeGreaterThan(0.9);
    }
  });

  test('probePixel + paintConnected: end-to-end visual paint workflow', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Centered cube. Top face faces +Z; render orthographically from
      // straight up so center-pixel hits the top.
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      const view = { elevation: 90, azimuth: 0, ortho: true, size: 200 };
      const hit = pw.probePixel({ pixel: [100, 100], view });
      if (!hit || hit.error) return { stage: 'probe', hit };
      return pw.paintConnected({
        seed: { point: hit.point, normal: hit.normal },
        maxDeviationDeg: 15,
        color: [0, 0, 1],
        name: 'top via probe',
      });
    });
    expect(result.error).toBeUndefined();
    expect(result.triangles).toBeGreaterThan(0);
    expect(result.name).toBe('top via probe');
  });
});
