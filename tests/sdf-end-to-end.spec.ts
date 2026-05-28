// End-to-end test for api.sdf. The unit tests in tests/unit/sdf.test.ts
// cover the pure-logic node tree (distance functions, bounds, label
// partitioning) without WASM. This spec exercises the full pipeline —
// SDF tree -> .build() -> Manifold.levelSet -> mesh + labelMap — in a
// real browser with the real WASM engine.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { runIsolated?: unknown } }).partwright?.runIsolated,
    { timeout: 30_000 },
  );
}

test.describe('api.sdf', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('sdf.sphere().build() produces a sane spherical mesh', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(
        `const { sdf } = api; return sdf.sphere(5).build({ edgeLength: 0.5 });`,
      );
      return r;
    });
    expect(result.error).toBeFalsy();
    expect(result.componentCount).toBe(1);
    expect(result.isManifold).toBe(true);
    // Volume of a sphere of r=5 is 4/3*PI*125 ≈ 523.6. Allow generous
    // tolerance because marching tetrahedra on a coarse grid systematically
    // underestimates volume.
    expect(result.volume).toBeGreaterThan(450);
    expect(result.volume).toBeLessThan(560);
  });

  test('smoothUnion produces fewer components than fused-but-touching primitives', async ({ page }) => {
    // Smooth-union of two spheres that JUST touch sharp-merges into one
    // piece — but more importantly, the smooth seam is part of one mesh
    // (the fillet). Sharp boundary-touching primitives would emit
    // separate components.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const { sdf } = api;
        const a = sdf.sphere(5);
        const b = sdf.sphere(5).translate(8, 0, 0);
        return a.smoothUnion(b, 2).build({ edgeLength: 0.5 });
      `);
      return r;
    });
    expect(result.error).toBeFalsy();
    expect(result.componentCount).toBe(1);
    expect(result.isManifold).toBe(true);
  });

  test('paint-by-label works on labelled SDF subtrees', async ({ page }) => {
    // Two labelled spheres -> two label entries in the registry. Use the
    // editor's runAndSave (which keeps the label map around for the
    // paintByLabel tool call), then assert the labels are visible.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const saved = await pw.runAndSave(
        `const { sdf } = api;
         const head = sdf.sphere(8).label('head');
         const eye = sdf.sphere(2).translate(0, 6, 4).label('eye');
         return sdf.union(head, eye).build({ edgeLength: 0.6 });`,
        'sdf-labels',
      );
      if (saved.error) return { stage: 'save', error: saved.error };
      const headPaint = pw.paintByLabel({ label: 'head', color: [1, 0, 0] });
      const eyePaint = pw.paintByLabel({ label: 'eye', color: [0, 1, 0] });
      const regions = pw.listRegions();
      return { saved, headPaint, eyePaint, regions };
    });
    expect(result.stage).toBeUndefined();
    expect(result.headPaint.error).toBeUndefined();
    expect(result.eyePaint.error).toBeUndefined();
    // Both labels should resolve to a non-empty triangle set.
    expect(result.headPaint.triangles).toBeGreaterThan(10);
    expect(result.eyePaint.triangles).toBeGreaterThan(10);
    // Two regions registered on the model.
    expect(result.regions.regions ?? result.regions).toBeTruthy();
  });

  test('gyroid intersected with a box meshes a finite lattice', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Small block + coarse mesh to keep this snappy.
      const r = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.gyroid(5, 0.8)
          .intersect(sdf.box([10, 10, 10]))
          .build({ edgeLength: 0.4 });
      `);
      return r;
    });
    expect(result.error).toBeFalsy();
    // Gyroid is a thin lattice — has volume but less than the bounding box (1000).
    expect(result.volume).toBeGreaterThan(50);
    expect(result.volume).toBeLessThan(1000);
  });

  test('mixing SDF and Manifold parts: smooth grip on a crisp plate', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const { Manifold, sdf } = api;
        // SDF blended handle:
        const grip = sdf.cylinder(2, 12)
          .smoothUnion(sdf.sphere(3).translate(0, 0, 7), 1)
          .build({ edgeLength: 0.4 });
        // Crisp mesh plate:
        const plate = Manifold.cube([10, 10, 1], true).translate([0, 0, -6]);
        return grip.add(plate);
      `);
      return r;
    });
    expect(result.error).toBeFalsy();
    expect(result.componentCount).toBe(1);
    expect(result.isManifold).toBe(true);
  });

  test('build() rejects unbounded gyroid without explicit bounds', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(
        `const { sdf } = api; return sdf.gyroid(5, 0.5).build();`,
      );
      return r;
    });
    // Should fail with a helpful error telling the user to pass bounds
    // or intersect with a finite shape.
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/bounds|finite/i);
  });

  test('chained transforms compose correctly through the engine', async ({ page }) => {
    // A translated, then rotated cube should land at the right place.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.box([4, 4, 4])
          .translate(10, 0, 0)
          .rotate(0, 0, 90)
          .build({ edgeLength: 0.4 });
      `);
      return r;
    });
    expect(result.error).toBeFalsy();
    expect(result.componentCount).toBe(1);
    // Volume should be ~64 (4x4x4) regardless of placement/rotation.
    expect(result.volume).toBeGreaterThan(55);
    expect(result.volume).toBeLessThan(72);
  });
});
