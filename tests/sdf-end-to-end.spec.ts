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
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(
        `const { sdf } = api; return sdf.sphere(5).build({ edgeLength: 0.5 });`,
      );
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    expect(stats.componentCount).toBe(1);
    expect(stats.isManifold).toBe(true);
    // Volume of a sphere of r=5 is 4/3*PI*125 ≈ 523.6. Allow generous
    // tolerance because marching tetrahedra on a coarse grid systematically
    // underestimates volume.
    expect(stats.volume).toBeGreaterThan(450);
    expect(stats.volume).toBeLessThan(560);
  });

  test('smoothUnion of two spheres meshes as one connected piece', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const { sdf } = api;
        const a = sdf.sphere(5);
        const b = sdf.sphere(5).translate(8, 0, 0);
        return a.smoothUnion(b, 2).build({ edgeLength: 0.5 });
      `);
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    expect(stats.componentCount).toBe(1);
    expect(stats.isManifold).toBe(true);
  });

  test('paint-by-label works on labelled SDF subtrees', async ({ page }) => {
    // Two labelled spheres -> two label entries in the registry. Use
    // runAndSave (which keeps the label map around for paintByLabel),
    // then assert both labels resolve.
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
      const headPaint = pw.paintByLabel({ label: 'head', color: [1, 0, 0] });
      const eyePaint = pw.paintByLabel({ label: 'eye', color: [0, 1, 0] });
      return {
        saveError: saved.failures ?? saved.error,
        geometry: saved.geometry,
        headPaint,
        eyePaint,
      };
    });
    expect(result.saveError).toBeFalsy();
    expect(result.geometry?.status).toBe('ok');
    expect(result.headPaint.error).toBeUndefined();
    expect(result.eyePaint.error).toBeUndefined();
    // Both labels should resolve to a non-empty triangle set.
    expect(result.headPaint.triangles).toBeGreaterThan(10);
    expect(result.eyePaint.triangles).toBeGreaterThan(10);
  });

  test('gyroid intersected with a box meshes a finite lattice', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Small block + coarse mesh to keep this snappy.
      const r = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.gyroid(5, 0.8)
          .intersect(sdf.box([10, 10, 10]))
          .build({ edgeLength: 0.4 });
      `);
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    // Gyroid is a thin lattice — volume is well under the bounding box (1000).
    expect(stats.volume).toBeGreaterThan(50);
    expect(stats.volume).toBeLessThan(1000);
  });

  test('mixing SDF and Manifold parts: smooth grip on a crisp plate', async ({ page }) => {
    const stats = await page.evaluate(async () => {
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
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    expect(stats.componentCount).toBe(1);
    expect(stats.isManifold).toBe(true);
  });

  test('build() rejects unbounded gyroid without explicit bounds', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(
        `const { sdf } = api; return sdf.gyroid(5, 0.5).build();`,
      );
      return r.geometryData;
    });
    // Should fail with a helpful error telling the user to pass bounds
    // or intersect with a finite shape.
    expect(stats.status).toBe('error');
    expect(String(stats.error)).toMatch(/bounds|finite/i);
  });

  test('chained transforms compose correctly through the engine', async ({ page }) => {
    // A translated, then rotated box should land at the right place
    // and keep its volume (rotation+translation are isometries).
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.box([4, 4, 4])
          .translate(10, 0, 0)
          .rotate(0, 0, 90)
          .build({ edgeLength: 0.4 });
      `);
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    expect(stats.componentCount).toBe(1);
    // Volume should be ~64 (4x4x4) regardless of placement/rotation.
    // Allow generous tolerance for marching-tetrahedra approximation.
    expect(stats.volume).toBeGreaterThan(55);
    expect(stats.volume).toBeLessThan(75);
  });

  // --- Follow-up features: new primitives + combinators ----------------

  test('ellipsoid meshes with the right bounding box and volume', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(
        `const { sdf } = api; return sdf.ellipsoid(8, 4, 6).build({ edgeLength: 0.4 });`,
      );
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    expect(stats.componentCount).toBe(1);
    // bbox dims ≈ 2*[8,4,6] = [16, 8, 12].
    expect(stats.boundingBox.dimensions[0]).toBeGreaterThan(15.4);
    expect(stats.boundingBox.dimensions[0]).toBeLessThan(16.6);
    expect(stats.boundingBox.dimensions[1]).toBeGreaterThan(7.4);
    expect(stats.boundingBox.dimensions[1]).toBeLessThan(8.6);
    // Volume of an ellipsoid = 4/3·π·rx·ry·rz = 4/3·π·192 ≈ 804.
    expect(stats.volume).toBeGreaterThan(700);
    expect(stats.volume).toBeLessThan(840);
  });

  test('roundedBox and roundedCylinder preserve their OUTER dimensions', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const box = await pw.runIsolated(
        `const { sdf } = api; return sdf.roundedBox([20, 20, 20], 3).build({ edgeLength: 0.5 });`,
      );
      const cyl = await pw.runIsolated(
        `const { sdf } = api; return sdf.roundedCylinder(10, 30, 2).build({ edgeLength: 0.5 });`,
      );
      return { box: box.geometryData, cyl: cyl.geometryData };
    });
    expect(out.box.status).toBe('ok');
    // OUTER box must stay ~20 on every axis (NOT 20 + 2*radius = 26).
    for (let i = 0; i < 3; i++) {
      expect(out.box.boundingBox.dimensions[i]).toBeGreaterThan(19.4);
      expect(out.box.boundingBox.dimensions[i]).toBeLessThan(20.6);
    }
    expect(out.cyl.status).toBe('ok');
    // Radius 10 → X/Y dims ~20; height 30 → Z dim ~30 (not 32).
    expect(out.cyl.boundingBox.dimensions[0]).toBeGreaterThan(19.2);
    expect(out.cyl.boundingBox.dimensions[0]).toBeLessThan(20.8);
    expect(out.cyl.boundingBox.dimensions[2]).toBeGreaterThan(29.2);
    expect(out.cyl.boundingBox.dimensions[2]).toBeLessThan(30.8);
  });

  test('TPMS family (schwarzP, diamond, lidinoid) all mesh inside a box', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const run = (kind: string) => pw.runIsolated(`
        const { sdf } = api;
        return sdf.${kind}(6, 0.8).intersect(sdf.box([14, 14, 14])).build({ edgeLength: 0.5 });
      `);
      const p = await run('schwarzP');
      const d = await run('diamond');
      const l = await run('lidinoid');
      return { p: p.geometryData, d: d.geometryData, l: l.geometryData };
    });
    for (const stats of [out.p, out.d, out.l]) {
      expect(stats.status).toBe('ok');
      // A thin TPMS shell clipped to a 14³ box: real volume, well under solid (2744).
      expect(stats.volume).toBeGreaterThan(30);
      expect(stats.volume).toBeLessThan(2744);
    }
  });

  test('combinators: polarArray ring, mirrorPair, repeat-in-box', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // 6-arm polar ring of capsules around Z.
      const ring = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.capsule([4,0,0],[9,0,0],1.2).polarArray(6, { axis: 'z' }).build({ edgeLength: 0.4 });
      `);
      // mirrorPair: an off-centre sphere should produce TWO lobes.
      const pair = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.sphere(3).translate(8,0,0).mirrorPair('x').build({ edgeLength: 0.4 });
      `);
      // repeat must be clipped to a finite box.
      const grid = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.sphere(1.5).repeat([6,6,0]).intersect(sdf.box([20,20,4])).build({ edgeLength: 0.4 });
      `);
      return { ring: ring.geometryData, pair: pair.geometryData, grid: grid.geometryData };
    });
    expect(out.ring.status).toBe('ok');
    expect(out.ring.volume).toBeGreaterThan(0);
    // mirrorPair makes two separated lobes (centres at ±8, radius 3 → a gap).
    expect(out.pair.status).toBe('ok');
    expect(out.pair.componentCount).toBe(2);
    // repeat tiled spheres clipped to a box → many components.
    expect(out.grid.status).toBe('ok');
    expect(out.grid.componentCount).toBeGreaterThan(1);
  });

  test('taper narrows a column; gradedGyroid meshes', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Negative taper narrows toward +z: result volume < the un-tapered box.
      const tapered = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.box([10,10,30]).taper(-0.02, 'z').build({ edgeLength: 0.5 });
      `);
      const graded = await pw.runIsolated(`
        const { sdf } = api;
        // Thicker walls toward the top.
        return sdf.gradedGyroid(6, (x,y,z) => 0.4 + 0.04*(z+10))
          .intersect(sdf.box([18,18,18]))
          .build({ edgeLength: 0.5 });
      `);
      return { tapered: tapered.geometryData, graded: graded.geometryData };
    });
    expect(out.tapered.status).toBe('ok');
    // The taper scales cross-sections by 1 + rate*z about the origin, so
    // with a negative rate the shape is WIDER at the bottom than the top.
    // Verify directly via the quartile cross-section areas (z25 < z75 in
    // height; bottom area must exceed top area).
    expect(out.tapered.crossSections.z25.area).toBeGreaterThan(out.tapered.crossSections.z75.area);
    expect(out.graded.status).toBe('ok');
    expect(out.graded.volume).toBeGreaterThan(0);
  });

  // --- Follow-up #2: graded TPMS variants, repeatN, polarRepeat -------

  test('gradedSchwarzP / gradedDiamond / gradedLidinoid all mesh in a box', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const run = (kind: string) => pw.runIsolated(`
        const { sdf } = api;
        return sdf.${kind}(6, (x, y, z) => 0.4 + 0.04 * (z + 7))
          .intersect(sdf.box([14, 14, 14]))
          .build({ edgeLength: 0.5 });
      `);
      return {
        p: (await run('gradedSchwarzP')).geometryData,
        d: (await run('gradedDiamond')).geometryData,
        l: (await run('gradedLidinoid')).geometryData,
      };
    });
    for (const stats of [out.p, out.d, out.l]) {
      expect(stats.status).toBe('ok');
      expect(stats.volume).toBeGreaterThan(20);
      expect(stats.volume).toBeLessThan(2744);
    }
  });

  test('repeatN produces a finite array without needing intersect', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const { sdf } = api;
        // 3x3 grid of spheres, centred on origin, NO intersect — bounds
        // are finite already because repeatN limits the tiling.
        return sdf.sphere(1).repeatN([3, 3, 0], [4, 4, 0]).build({ edgeLength: 0.4 });
      `);
      return r.geometryData;
    });
    expect(stats.status).toBe('ok');
    // 9 spheres, separated by 4 with radius 1 → 9 disconnected components.
    expect(stats.componentCount).toBe(9);
    // bbox X+Y extents should be ~[-5, 5] each (cells at ±4 + sphere extent 1).
    expect(stats.boundingBox.dimensions[0]).toBeGreaterThan(9.6);
    expect(stats.boundingBox.dimensions[0]).toBeLessThan(10.4);
    expect(stats.boundingBox.dimensions[1]).toBeGreaterThan(9.6);
    expect(stats.boundingBox.dimensions[1]).toBeLessThan(10.4);
  });

  test('polarRepeat tiles a unit cell around an axis', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // 12-fold ring of capsules around Z via polarRepeat — gear-like.
      const ring = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.capsule([4, 0, 0], [8, 0, 0], 0.8).polarRepeat(12, { axis: 'z' }).build({ edgeLength: 0.4 });
      `);
      // Same logical geometry via polarArray — should produce the same
      // component count + comparable volume (the two paths emit
      // identical iso-surfaces for matched parameters).
      const array = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.capsule([4, 0, 0], [8, 0, 0], 0.8).polarArray(12, { axis: 'z' }).build({ edgeLength: 0.4 });
      `);
      return { ring: ring.geometryData, array: array.geometryData };
    });
    expect(out.ring.status).toBe('ok');
    expect(out.array.status).toBe('ok');
    // Both should produce one connected ring of teeth.
    expect(out.ring.componentCount).toBe(out.array.componentCount);
    // Volumes should agree to within ~5% (same iso-surface, slightly
    // different boundary cell sampling).
    const vDiff = Math.abs(out.ring.volume - out.array.volume) / out.array.volume;
    expect(vDiff).toBeLessThan(0.05);
  });

  test('repeatN stagger produces a brick-bonded grid (different from straight grid)', async ({ page }) => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const straight = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.box([3, 1.5, 1.5]).repeatN([5, 4, 0], [3.4, 1.8, 0]).build({ edgeLength: 0.3 });
      `);
      const brick = await pw.runIsolated(`
        const { sdf } = api;
        return sdf.box([3, 1.5, 1.5]).repeatN([5, 4, 0], [3.4, 1.8, 0], {
          stagger: { along: 'x', by: 'y' }
        }).build({ edgeLength: 0.3 });
      `);
      return { straight: straight.geometryData, brick: brick.geometryData };
    });
    expect(out.straight.status).toBe('ok');
    expect(out.brick.status).toBe('ok');
    // Both have 20 bricks; volumes should match within marching-tetra noise.
    const vRatio = out.brick.volume / out.straight.volume;
    expect(vRatio).toBeGreaterThan(0.95);
    expect(vRatio).toBeLessThan(1.05);
    // The stagger expands the X bbox by amount*period (0.5 * 3.4 = 1.7).
    const xDiff = out.brick.boundingBox.dimensions[0] - out.straight.boundingBox.dimensions[0];
    expect(xDiff).toBeGreaterThan(1.4);
    expect(xDiff).toBeLessThan(2.0);
  });
});
