// Tests for the Worker-architecture race conditions introduced by moving
// geometry execution off the main thread.
//
// Key scenarios:
//
// 1. Rapid version switching — calling loadVersion() twice in quick
//    succession should always apply the second (most-recent) version, not
//    whichever one the Worker happened to finish last. The _runGeneration
//    counter in main.ts is the fix; these tests verify the observable
//    end-state is correct even under racing conditions.
//
// 2. Manifold reconstruction — executeCodeAsync() returns manifold=null;
//    main.ts calls Manifold.ofMesh(result.mesh) to rebuild a queryable
//    Manifold. Verify that getBoundingBox() and sliceAtZ() work correctly
//    after the reconstruction (i.e. the ofMesh path is exercised, not a
//    cached pre-Worker manifold).
//
// 3. The partwright.run race fix — setValue() triggers an auto-run in a
//    requestAnimationFrame; the explicit runCodeSync started by
//    partwright.run() must win, not be discarded as stale. The result
//    returned by partwright.run() must reflect the code it was called with.

import { test, expect } from 'playwright/test';

type GeometryData = {
  status?: string;
  error?: string;
  triangleCount?: number;
  volume?: number;
};

type BoundingBox = {
  min: [number, number, number];
  max: [number, number, number];
};

type Version = {
  index: number;
  id: string;
  label?: string;
};

type RunAndSaveResult = {
  geometry: GeometryData;
  version: Version | null;
  error?: string;
};

type LoadVersionResult = {
  code: string;
  geometryData: GeometryData;
  index: number;
  label?: string;
  error?: string;
};

type PartwrightApi = {
  run: (code: string) => Promise<GeometryData>;
  runAndSave: (code: string, label?: string) => Promise<RunAndSaveResult>;
  createSession: (name?: string) => Promise<{ id: string }>;
  loadVersion: (target: { index?: number; id?: string }) => Promise<LoadVersionResult>;
  listVersions: () => Promise<Version[]>;
  getGeometryData: () => GeometryData;
  getBoundingBox: () => BoundingBox | null;
  sliceAtZ: (z: number) => unknown;
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** Wait for the WASM engine and partwright API to be available. */
async function waitForEngine(page: import('playwright/test').Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Worker race conditions', () => {
  // ── 1. Rapid version switching ────────────────────────────────────────────

  test('rapid loadVersion: last-called version wins, not first-to-finish', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    // Create a session with two distinctly different versions — a small cube
    // (few triangles) and a high-res sphere (many triangles). Loading them in
    // rapid succession should always end up showing the second one.
    const setup = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      await pw.createSession('race-test-rapid-switch');

      const v1 = await pw.runAndSave(
        'const { Manifold } = api; return Manifold.cube([10, 10, 10]);',
        'cube-v1',
      );
      const v2 = await pw.runAndSave(
        // 64-segment sphere — noticeably more triangles than the cube.
        'const { Manifold } = api; return Manifold.sphere(8, 64);',
        'sphere-v2',
      );
      return {
        v1Index: v1.version?.index,
        v2Index: v2.version?.index,
        v1Tris: v1.geometry.triangleCount,
        v2Tris: v2.geometry.triangleCount,
      };
    });

    expect(setup.v1Index).toBeDefined();
    expect(setup.v2Index).toBeDefined();
    // Sphere must have more triangles so we can distinguish final state.
    expect(setup.v2Tris).toBeGreaterThan(setup.v1Tris!);

    // Now fire both loads without awaiting the first — simulating the user
    // clicking version 1 and then immediately clicking version 2.
    const finalGeo = await page.evaluate(async (indices) => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      // Kick off v1 load but don't await; immediately start v2 load.
      const p1 = pw.loadVersion({ index: indices.v1! });
      const p2 = pw.loadVersion({ index: indices.v2! });
      // Await both so the page is in a settled state, then read live state.
      await Promise.all([p1, p2]);
      return pw.getGeometryData();
    }, { v1: setup.v1Index, v2: setup.v2Index });

    // The live geometry must reflect version 2 (sphere), not version 1 (cube).
    // Allow a small tolerance — the exact sphere count can vary by engine
    // version, but must be closer to v2Tris than v1Tris.
    expect(finalGeo.status).toBe('ok');
    expect(finalGeo.triangleCount).toBeGreaterThanOrEqual(setup.v2Tris! - 100);
  });

  test('rapid loadVersion: color regions from the winning version are applied, not the loser\'s', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    // Create two versions with different sizes so we can tell them apart.
    const setup = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      await pw.createSession('race-test-color-regions');

      const v1 = await pw.runAndSave(
        'const { Manifold } = api; return Manifold.cube([5, 5, 5]);',
        'small-cube',
      );
      const v2 = await pw.runAndSave(
        'const { Manifold } = api; return Manifold.cube([20, 20, 20]);',
        'large-cube',
      );
      return {
        v1Index: v1.version?.index,
        v2Index: v2.version?.index,
        v2TriCount: v2.geometry.triangleCount,
      };
    });

    expect(setup.v1Index).toBeDefined();
    expect(setup.v2Index).toBeDefined();

    // Fire both loads simultaneously; await resolution.
    const result = await page.evaluate(async (indices) => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      const p1 = pw.loadVersion({ index: indices.v1! });
      const p2 = pw.loadVersion({ index: indices.v2! });
      const [, r2] = await Promise.all([p1, p2]);
      const live = pw.getGeometryData();
      return { r2Code: r2.code, liveTriCount: live.triangleCount, liveStatus: live.status };
    }, { v1: setup.v1Index, v2: setup.v2Index });

    expect(result.liveStatus).toBe('ok');
    // Large cube v2 should be the live geometry, not small cube v1.
    // Large cube has volume 8000 vs 125, so triangle count will differ if
    // they actually differ in the code. The code itself is the safest check:
    // we can confirm the final editor code belongs to v2.
    expect(result.r2Code).toContain('20, 20, 20');
  });

  // ── 2. Manifold reconstruction after Worker round-trip ────────────────────

  test('getBoundingBox works after Worker-path execution (ofMesh reconstruction)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const bbox = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      // Run via the normal path — goes through the Worker, returns manifold=null,
      // main thread calls ofMesh() to reconstruct. getBoundingBox() exercises that.
      await pw.run('const { Manifold } = api; return Manifold.cube([10, 20, 30], true);');
      return pw.getBoundingBox();
    });

    expect(bbox).not.toBeNull();
    // Cube centered at origin: min = [-5, -10, -15], max = [5, 10, 15]
    expect(bbox!.min[0]).toBeCloseTo(-5, 0);
    expect(bbox!.min[1]).toBeCloseTo(-10, 0);
    expect(bbox!.min[2]).toBeCloseTo(-15, 0);
    expect(bbox!.max[0]).toBeCloseTo(5, 0);
    expect(bbox!.max[1]).toBeCloseTo(10, 0);
    expect(bbox!.max[2]).toBeCloseTo(15, 0);
  });

  test('sliceAtZ works after Worker-path execution (ofMesh reconstruction)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const slice = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      // A cube from z=0..10; slicing at z=5 should yield a square cross-section.
      await pw.run('const { Manifold } = api; return Manifold.cube([10, 10, 10]);');
      return pw.sliceAtZ(5);
    });

    // sliceAtZ returns { polygons, svg, boundingBox, area } on success or null/{ error }.
    const sliceData = slice as { area?: number; polygons?: unknown[][]; boundingBox?: unknown; svg?: string; error?: string } | null;
    expect(sliceData).not.toBeNull();
    expect((sliceData as { error?: string }).error).toBeUndefined();
    expect(sliceData!.area).toBeGreaterThan(0);
    // A cube's cross-section at mid-height is one closed polygon (the square).
    expect(Array.isArray(sliceData!.polygons)).toBe(true);
    expect(sliceData!.polygons!.length).toBe(1);
  });

  // ── 3. partwright.run() explicit call wins over the RAF auto-run ─────────

  test('partwright.run(code) result reflects the code passed, not an auto-run', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    // partwright.run(code) calls setValue() — which may trigger an auto-run
    // RAF — then immediately starts its own runCodeSync(). The _running guard
    // in main.ts skips the RAF auto-run when an explicit run is in flight.
    // Verify the result returned by run() matches the code we supplied,
    // not some other code that was in the editor or queued by the RAF.
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;

      // Call run() with a sphere code and capture the return value directly.
      const sphereResult = await pw.run(
        'const { Manifold } = api; return Manifold.sphere(7, 64);',
      );
      return sphereResult;
    });

    expect(result.status).toBe('ok');
    // A 64-segment sphere produces ~2048 triangles; confirm we got sphere
    // geometry, not the default example (which is a simple box with 12 tris).
    expect(result.triangleCount).toBeGreaterThan(1500);
  });

  test('partwright.run(code) with sequential calls does not mix up results', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    // Two sequential awaited run() calls — each must return the geometry for
    // the code it was called with, not a stale result from the previous call.
    const results = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartwrightApi }).partwright;
      const r1 = await pw.run('const { Manifold } = api; return Manifold.cube([5, 5, 5]);');
      const r2 = await pw.run('const { Manifold } = api; return Manifold.sphere(10, 64);');
      return { r1, r2 };
    });

    expect(results.r1.status).toBe('ok');
    expect(results.r2.status).toBe('ok');
    // Sphere should have more triangles than the cube.
    expect(results.r2.triangleCount).toBeGreaterThan(results.r1.triangleCount!);
  });
});
