// Golden path for the "Place on plate" tools (drop-to-floor / center on plate).
// Covers both write-back modes end to end through the console API, plus the
// viewport panel button, and the no-op short-circuit when already positioned.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A cube floating well above the bed and off the XY origin.
const FLOATING_CUBE = 'const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10]).translate([5, 5, 30]);';

// A chiral (left/right-asymmetric) part: a tall base with an arm that juts out
// toward +X, so mirroring across X visibly flips it. Two overlapping boxes union
// into one watertight manifold.
const CHIRAL = 'const { Manifold } = api;\n'
  + 'const base = Manifold.cube([10, 12, 30]);\n'
  + 'const arm = Manifold.cube([22, 8, 8]).translate([3, 2, 20]);\n'
  + 'return Manifold.union([base, arm]);';

test.describe('Place on plate', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('parametric drop + center grounds the model and keeps editable code', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-parametric');
      await pw.run(code);
      const before = pw.getGeometryData().boundingBox;
      const placed = await pw.placeModel({ dropToFloor: true, centerX: true, centerY: true, mode: 'parametric' });
      const after = pw.getGeometryData().boundingBox;
      return { before, placed, after, parametric: pw.canPlaceParametric(), src: pw.getCode() };
    }, [FLOATING_CUBE]);

    expect(result.before?.z?.[0]).toBeCloseTo(30, 1);
    expect(result.placed.error).toBeUndefined();
    expect(result.placed.mode).toBe('parametric');
    // Floor on Z=0, centered on XY.
    expect(result.after?.z?.[0]).toBeCloseTo(0, 2);
    const cx = ((result.after!.x![0] + result.after!.x![1]) / 2);
    const cy = ((result.after!.y![0] + result.after!.y![1]) / 2);
    expect(cx).toBeCloseTo(0, 2);
    expect(cy).toBeCloseTo(0, 2);
    // Code stayed parametric (wrapped + translated), not baked to a mesh.
    expect(result.src).toContain('@partwright-placement');
    expect(result.src).toContain('Manifold.cube([10, 10, 10])');
    expect(result.src).not.toContain('Manifold.ofMesh');
  });

  test('bake mode grounds the model and flattens to an imported mesh', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-bake');
      await pw.run(code);
      const placed = await pw.placeModel({ dropToFloor: true, mode: 'bake' });
      return { placed, after: pw.getGeometryData().boundingBox, src: pw.getCode() };
    }, [FLOATING_CUBE]);

    expect(result.placed.error).toBeUndefined();
    expect(result.after?.z?.[0]).toBeCloseTo(0, 2);
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('re-dropping an already-grounded model is a no-op', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-noop');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10]);'); // already on Z=0
      return pw.placeModel({ dropToFloor: true, mode: 'parametric' });
    });
    expect(result.error).toBeUndefined();
    expect(result.noop).toBe(true);
  });

  test('viewport Place panel drops the model to the floor', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('place-ui');
      await pw.run(code);
    }, [FLOATING_CUBE]);

    // Open the Tools popover, then the Place/Rotate panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#place-viewport-toggle').click();
    await expect(page.getByText('Place / Rotate')).toBeVisible();

    await page.getByRole('button', { name: /Drop to floor/i }).click();

    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getGeometryData().boundingBox?.z?.[0]),
    ).toBeCloseTo(0, 1);
  });

  test('parametric and bake rotation are geometrically identical', async ({ page }) => {
    // This is the parity check that proves eulerToMatrix (bake) matches the
    // engine's .rotate() (parametric): same input → same resulting bbox.
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      const rot = { x: 20, y: 35, z: 50 };
      await pw.createSession('rot-param');
      await pw.run(code);
      await pw.rotateModel({ ...rot, mode: 'parametric' });
      const param = pw.getGeometryData().boundingBox;
      await pw.createSession('rot-bake');
      await pw.run(code);
      await pw.rotateModel({ ...rot, mode: 'bake' });
      const bake = pw.getGeometryData().boundingBox;
      return { param, bake };
    }, ['const { Manifold } = api;\nreturn Manifold.cube([10, 20, 30]).translate([3, 4, 5]);']);

    for (const axis of ['x', 'y', 'z'] as const) {
      expect(result.param[axis][0]).toBeCloseTo(result.bake[axis][0], 2);
      expect(result.param[axis][1]).toBeCloseTo(result.bake[axis][1], 2);
    }
  });

  test('lay flat auto-orients a tilted slab onto the bed', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('lay-flat');
      // A thin slab (big 10x20 faces, 4 thick), tilted so it floats at an angle.
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([10, 20, 4]).rotate([0, 30, 0]).translate([0, 0, 15]);');
      const before = pw.getGeometryData().boundingBox;
      const res = await pw.layFlatModel({ mode: 'parametric' });
      const after = pw.getGeometryData().boundingBox;
      return { before, res, after };
    });

    expect(result.res.error).toBeUndefined();
    // The big face is now on the bed: floor at Z=0 and the height collapses to
    // the slab's thin dimension (~4).
    expect(result.after.z[0]).toBeCloseTo(0, 1);
    expect(result.after.z[1] - result.after.z[0]).toBeCloseTo(4, 0);
  });

  test('mirror X flips the model in place and keeps editable code + watertight', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('mirror-x');
      await pw.run(code);
      const before = pw.getGeometryData().boundingBox;
      const res = await pw.mirrorModel({ axis: 'x', mode: 'parametric' });
      const data = pw.getGeometryData();
      return { before, res, after: data.boundingBox, isManifold: data.isManifold, src: pw.getCode() };
    }, [CHIRAL]);

    expect(result.res.error).toBeUndefined();
    expect(result.res.mode).toBe('parametric');
    // Mirrored about its own center → the bounding box is unchanged (flips in place).
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(result.after[axis][0]).toBeCloseTo(result.before[axis][0], 2);
      expect(result.after[axis][1]).toBeCloseTo(result.before[axis][1], 2);
    }
    // Stayed editable code with a `.mirror()` in the chain, and still watertight
    // (winding handled by the engine's own mirror).
    expect(result.src).toContain('.mirror([1, 0, 0])');
    expect(result.isManifold).toBe(true);
  });

  test('mirror bake stays watertight (triangle winding flipped)', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('mirror-bake');
      await pw.run(code);
      const res = await pw.mirrorModel({ axis: 'y', mode: 'bake' });
      const data = pw.getGeometryData();
      return { res, isManifold: data.isManifold, components: data.componentCount, src: pw.getCode() };
    }, [CHIRAL]);

    expect(result.res.error).toBeUndefined();
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
    // The reflection inverts orientation; applySteps flips winding so the baked
    // mesh is still a single watertight solid rather than inside-out.
    expect(result.isManifold).toBe(true);
    expect(result.components).toBe(1);
  });

  test('voxel models drop parametrically (stay voxel) but rotate bakes with a warning', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('voxel-place');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([12, 12, 12]);');
      await pw.voxelizeModel({ resolution: 16 }); // switch the session into the voxel engine
      // Replace with an explicit voxel box floating off the floor (z 8..15).
      await pw.run('const v = api.voxels();\nv.fillBox([0, 0, 8], [7, 7, 15], "#88aaff");\nreturn v;');
      const langStart = pw.getActiveLanguage();
      // Drop: translate-only → stays a parametric voxel program.
      const drop = await pw.placeModel({ dropToFloor: true, mode: 'auto' });
      const afterDrop = { lang: pw.getActiveLanguage(), code: pw.getCode(), z0: pw.getGeometryData().boundingBox?.z?.[0] };
      // Rotate: voxel grid has no .rotate([x,y,z]) → bakes to a mesh, with a warning.
      const rot = await pw.rotateModel({ z: 90, mode: 'auto' });
      const afterRot = { lang: pw.getActiveLanguage() };
      return { langStart, drop, afterDrop, rot, afterRot };
    });

    expect(result.langStart).toBe('voxel');
    // Drop stayed a voxel program (not baked to a manifold-js mesh).
    expect(result.drop.error).toBeUndefined();
    expect(result.drop.mode).toBe('parametric');
    expect(result.afterDrop.lang).toBe('voxel');
    expect(result.afterDrop.code).toContain('api.voxels()'); // original voxel program preserved
    expect(result.afterDrop.code).toContain('.translate(');
    expect(result.afterDrop.code).not.toContain('Manifold.ofMesh');
    expect(result.afterDrop.z0).toBeCloseTo(0, 0);
    // Rotate baked to a mesh and said so.
    expect(result.rot.error).toBeUndefined();
    expect(Array.isArray(result.rot.warnings)).toBe(true);
    expect(result.rot.warnings.join(' ')).toMatch(/voxel/i);
    expect(result.afterRot.lang).toBe('manifold-js');
  });
});
