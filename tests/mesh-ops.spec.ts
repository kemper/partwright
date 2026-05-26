// E2E coverage for the meshOps sandbox helpers (predicates, alignment,
// patterns, expectUnion/heal) and their partwright window-API siblings
// (renderSection, componentBounds, pointInside, healCurrent).
//
// These exercise the real manifold-3d WASM via the running engine, so they
// live in the playwright tier; the pure-math validation/alignment math is
// covered separately in tests/unit/meshOps.test.ts.
//
// The sandbox helpers run in an isolated worker context, so we can't leak data
// back via globals. Instead each "assertion" inside model code throws a
// descriptive error if it fails; the test passes iff `runIsolated` reports no
// error.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page): Promise<void> {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('meshOps sandbox helpers', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('predicates: intersects, contains, pointInside, bbox, componentBounds, volumeDelta', async ({ page }) => {
    const errMessage = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runIsolated: (code: string) => Promise<{ geometryData: { status: string; error?: string } }> } }).partwright;
      // Each `expect(cond, msg)` throws if cond is falsy, so the first failing
      // predicate surfaces as an isolated-run error.
      const code = `
        const { Manifold } = api;
        function check(cond, msg) { if (!cond) throw new Error('PRED FAIL: ' + msg); }

        const a = Manifold.cube([10, 10, 10], true);
        const b = Manifold.cube([10, 10, 10], true).translate([5, 0, 0]); // overlaps a
        const c = Manifold.cube([10, 10, 10], true).translate([50, 0, 0]); // disjoint
        const small = Manifold.cube([2, 2, 2], true); // inside a

        check(api.intersects(a, b) === true, 'a intersects b');
        check(api.intersects(a, c) === false, 'a does NOT intersect c');
        check(api.contains(a, small) === true, 'a contains small');
        check(api.contains(small, a) === false, 'small does NOT contain a');
        check(api.pointInside(a, [0, 0, 0]) === true, 'origin is inside a');
        check(api.pointInside(a, [100, 100, 100]) === false, 'far point is outside a');

        const bb = api.bbox(a);
        check(bb.size[0] === 10 && bb.size[1] === 10 && bb.size[2] === 10, 'bbox.size is [10,10,10]');
        check(bb.center[0] === 0 && bb.center[1] === 0 && bb.center[2] === 0, 'bbox.center is origin');

        const delta = api.volumeDelta(small, a);
        check(Math.abs(delta - (1000 - 8)) < 0.5, 'volumeDelta(small, a) ≈ 992 (got ' + delta + ')');

        // componentBounds — build a two-piece compose and check sort order.
        const twoPieces = Manifold.compose([
          Manifold.cube([10, 10, 10], true),
          Manifold.cube([3, 3, 3], true).translate([50, 0, 0]),
        ]);
        const comps = api.componentBounds(twoPieces);
        check(comps.length === 2, 'componentBounds returns 2 entries');
        check(comps[0].volume > comps[1].volume, 'largest-first sort');
        check(comps[0].bbox.size[0] === 10, 'big piece bbox size is 10');
        check(comps[1].bbox.size[0] === 3, 'small piece bbox size is 3');

        return a;
      `;
      const res = await pw.runIsolated(code);
      return res.geometryData.error ?? null;
    });
    expect(errMessage, errMessage ?? 'all predicates returned expected values').toBeNull();
  });

  test('alignment + patterns build the expected geometry shape', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (code: string, label?: string) => Promise<{ geometry: { status: string; isManifold: boolean; triangleCount: number } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        const table = Manifold.cube([20, 20, 4], true);
        // placeOn: cylinder sits on table top.
        const cup = Manifold.cylinder(6, 2, 2, 24);
        const placed = api.placeOn(cup, table, { gap: 0.6 });

        // alignTo: small block in the top-right-back-top corner of the table bbox.
        const corner = api.alignTo(Manifold.cube([2, 2, 2], true), table, { x: 'max', y: 'min', z: 'max' });

        // linearPattern: 5 pegs in a row.
        const fence = api.linearPattern(Manifold.cube([2, 2, 8], true), 5, [4, 0, 0]).translate([-8, -12, 4]);

        // circularPattern: 6 cubes spaced 60° apart around Z.
        const ring = api.circularPattern(
          Manifold.cube([2, 2, 2], true).translate([8, 0, 0]),
          6,
          { axis: 'z' },
        );

        return Manifold.compose([table, placed, corner, fence, ring]);
      `;
      return await pw.runAndSave(code, 'meshops-alignment');
    });
    expect(res.geometry).toBeTruthy();
    expect(res.geometry.status).toBe('ok');
    expect(res.geometry.isManifold).toBe(true);
    expect(res.geometry.triangleCount).toBeGreaterThan(0);
  });

  test('expectUnion throws a useful error when components mismatch', async ({ page }) => {
    const errMessage = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runIsolated: (code: string) => Promise<{ geometryData: { status: string; error?: string } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        const a = Manifold.cube([5, 5, 5], true);
        const b = Manifold.cube([5, 5, 5], true).translate([20, 0, 0]); // disjoint
        // expectComponents: 1 should fail — a + b are 2 islands.
        return api.expectUnion([a, b], { expectComponents: 1 });
      `;
      const res = await pw.runIsolated(code);
      return res.geometryData.error ?? '';
    });
    expect(errMessage).toMatch(/expected 1 component/);
  });

  test('expectUnion passes when components match', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (code: string, label?: string) => Promise<{ geometry: { status: string; componentCount: number } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        const a = Manifold.cube([5, 5, 5], true);
        const b = Manifold.cube([5, 5, 5], true).translate([3, 0, 0]); // overlaps a — one piece
        return api.expectUnion([a, b], { expectComponents: 1 });
      `;
      return await pw.runAndSave(code, 'expectunion-ok');
    });
    expect(res.geometry.status).toBe('ok');
    expect(res.geometry.componentCount).toBe(1);
  });

  test('circularPattern with a non-axis-aligned axis produces a valid manifold', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (code: string, label?: string) => Promise<{ geometry: { isManifold: boolean; triangleCount: number } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        // Rotate around [1,1,1]. Exercises the general-axis Rodrigues path.
        const blob = Manifold.sphere(3, 16).translate([6, 0, 0]);
        return api.circularPattern(blob, 5, { axis: [1, 1, 1] });
      `;
      return await pw.runAndSave(code, 'circular-arbitrary-axis');
    });
    expect(res.geometry.isManifold).toBe(true);
    expect(res.geometry.triangleCount).toBeGreaterThan(0);
  });
});

test.describe('partwright window API: renderSection + componentBounds + pointInside + healCurrent', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('renderSection slices on all three axes and returns an SVG data URL', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (code: string, label?: string) => Promise<unknown>; renderSection: (opts: { axis: 'x' | 'y' | 'z'; offset?: number; size?: number }) => unknown } }).partwright;
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([20, 14, 10], true);', 'base');
      const z = pw.renderSection({ axis: 'z' });
      const x = pw.renderSection({ axis: 'x', offset: 0 });
      const y = pw.renderSection({ axis: 'y', size: 256 });
      return { z, x, y };
    });
    const { z, x, y } = result as { z: { dataUrl: string; axis: string; area: number; contours: number }; x: { dataUrl: string; axis: string; area: number }; y: { dataUrl: string; axis: string; area: number } };
    // 20×14×10 cube: cross-section at Z=0 is 20×14 = 280; at X=0 is 14×10 = 140; at Y=midpoint is 20×10 = 200.
    expect(z.area).toBeCloseTo(280, 1);
    expect(z.contours).toBe(1);
    expect(z.dataUrl).toMatch(/^data:image\/svg\+xml/);
    expect(x.area).toBeCloseTo(140, 1);
    expect(y.area).toBeCloseTo(200, 1);
  });

  test('componentBounds returns per-piece bboxes sorted largest-first', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (c: string, l?: string) => Promise<unknown>; componentBounds: () => unknown } }).partwright;
      await pw.runAndSave(
        'const { Manifold } = api; return Manifold.compose([Manifold.cube([10, 10, 10], true), Manifold.cube([3, 3, 3], true).translate([50, 0, 0])]);',
        'two-pieces',
      );
      return pw.componentBounds();
    });
    const comps = result as Array<{ index: number; volume: number; bbox: { size: number[] } }>;
    expect(comps).toHaveLength(2);
    expect(comps[0].volume).toBeGreaterThan(comps[1].volume);
    expect(comps[0].bbox.size).toEqual([10, 10, 10]);
    expect(comps[1].bbox.size).toEqual([3, 3, 3]);
    expect(comps[0].index).toBe(0);
    expect(comps[1].index).toBe(1);
  });

  test('pointInside agrees with intuition for a centered cube', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (c: string, l?: string) => Promise<unknown>; pointInside: (p: [number, number, number]) => boolean | null } }).partwright;
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'cube');
      return {
        center: pw.pointInside([0, 0, 0]),
        outsidePositive: pw.pointInside([100, 0, 0]),
        outsideNegative: pw.pointInside([-100, 0, 0]),
      };
    });
    expect(result).toEqual({ center: true, outsidePositive: false, outsideNegative: false });
  });

  test('healCurrent returns ok=true on an already-clean cube and reports zero deltas', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (c: string, l?: string) => Promise<unknown>; healCurrent: () => unknown } }).partwright;
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'cube');
      return pw.healCurrent();
    });
    const r = result as { ok: boolean; volumeDelta: number; componentCountBefore: number; componentCountAfter: number };
    expect(r.ok).toBe(true);
    expect(Math.abs(r.volumeDelta)).toBeLessThan(0.01);
    expect(r.componentCountBefore).toBe(1);
    expect(r.componentCountAfter).toBe(1);
  });
});
