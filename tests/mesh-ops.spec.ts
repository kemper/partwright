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

  test('circularPattern.radius shortcut + alignTo("origin") + placeOn("preserve")', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (code: string, label?: string) => Promise<{ geometry: { isManifold: boolean; componentCount: number } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        // Six studs around a hub — the radius shortcut pushes each stud out
        // by 8 before rotation, so we don't have to pre-translate.
        const hub = Manifold.cylinder(4, 10, 10, 48);
        const studProto = Manifold.cylinder(6, 1.5, 1.5, 16);
        const studs = api.circularPattern(studProto, 6, { radius: 8 });
        const hubWithStuds = api.expectUnion([hub, studs], { expectComponents: 1 });

        // alignTo('origin') — center an off-origin shape on the world axis.
        const drifted = Manifold.cube([4, 4, 4], true).translate([50, 50, 50]);
        const centered = api.alignTo(drifted, 'origin', { x: 'center', y: 'center', z: 'center' });
        const cb = api.bbox(centered);
        if (Math.abs(cb.center[0]) > 0.01 || Math.abs(cb.center[1]) > 0.01 || Math.abs(cb.center[2]) > 0.01) {
          throw new Error('alignTo origin did not center: ' + JSON.stringify(cb.center));
        }

        // placeOn({ at: 'preserve' }) — Z-lift only, no XY re-centering.
        // Block at (15, 0) — placeOn would normally drag it to (0, 0); 'preserve'
        // keeps its X position.
        const offBlock = Manifold.cube([3, 3, 3], true).translate([15, 0, 0]);
        const placed = api.placeOn(offBlock, hub, { at: 'preserve' });
        const pb = api.bbox(placed);
        if (Math.abs(pb.center[0] - 15) > 0.01) {
          throw new Error('placeOn preserve dragged X: ' + pb.center[0]);
        }

        return hubWithStuds;
      `;
      return await pw.runAndSave(code, 'circular-radius-and-origin-align');
    });
    expect(res.geometry.isManifold).toBe(true);
    expect(res.geometry.componentCount).toBe(1);
  });

  test('spiralPattern builds a helical stack', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runAndSave: (code: string, label?: string) => Promise<{ geometry: { isManifold: boolean; triangleCount: number } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        // 12 wedges rising 2mm and rotating 30° per copy — the classic
        // "spiral step" pattern that no helper expressed before.
        const step = Manifold.cube([20, 4, 4], true).translate([10, 0, 0]);
        const helix = api.spiralPattern(step, 12, { anglePerCopy: 30, risePerCopy: 2 });
        // Spine: a tall column so all 12 wedges share material with it.
        const spine = Manifold.cylinder(24, 1.2, 1.2, 24).translate([0, 0, -2]);
        return api.expectUnion([spine, helix], { expectComponents: 1 });
      `;
      return await pw.runAndSave(code, 'spiral-pattern-stack');
    });
    expect(res.geometry.isManifold).toBe(true);
    expect(res.geometry.triangleCount).toBeGreaterThan(0);
  });

  test('expectComponents standalone predicate throws with bbox detail on mismatch', async ({ page }) => {
    const errMessage = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runIsolated: (c: string) => Promise<{ geometryData: { error?: string } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        // Disjoint cubes — 2 components, but we'll claim 1 to trigger the throw.
        const a = Manifold.cube([4, 4, 4], true);
        const b = Manifold.cube([4, 4, 4], true).translate([20, 0, 0]);
        const both = Manifold.compose([a, b]);
        api.expectComponents(both, 1);
        return a;
      `;
      const res = await pw.runIsolated(code);
      return res.geometryData.error ?? '';
    });
    expect(errMessage).toMatch(/expected 1 component\(s\) but got 2/);
    expect(errMessage).toMatch(/bbox=/); // bbox-per-piece dump present
  });

  test('expectUnion error message includes per-piece bbox dump', async ({ page }) => {
    const errMessage = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runIsolated: (c: string) => Promise<{ geometryData: { error?: string } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        const a = Manifold.cube([5, 5, 5], true);
        const b = Manifold.cube([3, 3, 3], true).translate([20, 0, 0]);
        return api.expectUnion([a, b], { expectComponents: 1 });
      `;
      const res = await pw.runIsolated(code);
      return res.geometryData.error ?? '';
    });
    expect(errMessage).toMatch(/expected 1 component\(s\) but got 2/);
    // Largest first — the 5×5×5 cube should show up before the 3×3×3.
    expect(errMessage).toMatch(/\[0\] vol=125\.00/);
    expect(errMessage).toMatch(/\[1\] vol=27\.00/);
  });

  test('circularPattern with a non-axis-aligned axis produces a geometrically-correct rotation', async ({ page }) => {
    // The previous version only checked "didn't crash". This one verifies the
    // Rodrigues rotation matrix actually rotates the input into the expected
    // positions — a regression here would silently produce wrong geometry,
    // which `isManifold` won't catch. The trick: rotating an asymmetric
    // off-axis blob N times around an axis through the origin must produce a
    // bbox that's symmetric about that axis. We check that explicitly.
    const errMessage = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { runIsolated: (c: string) => Promise<{ geometryData: { error?: string } }> } }).partwright;
      const code = `
        const { Manifold } = api;
        function check(cond, msg) { if (!cond) throw new Error('ROT FAIL: ' + msg); }

        // 1. Axis-aligned Z rotation: 4 copies of a box at +X should produce a
        //    bbox centered at origin with size 2R in X and Y, equal.
        const box = Manifold.cube([2, 2, 2], true).translate([10, 0, 0]);
        const ring = api.circularPattern(box, 4, { axis: 'z' });
        const rb = api.bbox(ring);
        check(Math.abs(rb.center[0]) < 0.1, 'Z-axis ring center X near 0 (got ' + rb.center[0] + ')');
        check(Math.abs(rb.center[1]) < 0.1, 'Z-axis ring center Y near 0 (got ' + rb.center[1] + ')');
        check(Math.abs(rb.size[0] - rb.size[1]) < 0.1, 'Z-axis ring symmetric in X and Y (got ' + rb.size[0] + ' vs ' + rb.size[1] + ')');

        // 2. Y-axis rotation of the same +X box: 4 copies should form a ring
        //    in the XZ plane, centered at origin, size in X == size in Z.
        const ringY = api.circularPattern(box, 4, { axis: 'y' });
        const rby = api.bbox(ringY);
        check(Math.abs(rby.center[0]) < 0.1, 'Y-axis ring center X near 0 (got ' + rby.center[0] + ')');
        check(Math.abs(rby.center[2]) < 0.1, 'Y-axis ring center Z near 0 (got ' + rby.center[2] + ')');
        check(Math.abs(rby.size[0] - rby.size[2]) < 0.1, 'Y-axis ring symmetric in X and Z (got ' + rby.size[0] + ' vs ' + rby.size[2] + ')');

        // 3. Arbitrary axis [1,1,1]/sqrt(3): 3 copies of a box at +X should be
        //    invariant under 120° rotation about [1,1,1]. The unioned bbox must
        //    be symmetric under (x,y,z)→(y,z,x), i.e. size[0]≈size[1]≈size[2].
        const ringD = api.circularPattern(box, 3, { axis: [1, 1, 1] });
        const rbd = api.bbox(ringD);
        const s0 = rbd.size[0], s1 = rbd.size[1], s2 = rbd.size[2];
        check(Math.abs(s0 - s1) < 0.5, 'diag axis ring size[0] ≈ size[1] (got ' + s0 + ' vs ' + s1 + ')');
        check(Math.abs(s1 - s2) < 0.5, 'diag axis ring size[1] ≈ size[2] (got ' + s1 + ' vs ' + s2 + ')');

        return box;
      `;
      const res = await pw.runIsolated(code);
      return res.geometryData.error ?? null;
    });
    expect(errMessage, errMessage ?? 'all rotations produced symmetric bboxes').toBeNull();
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

  // Engine-agnostic check — the window-level helpers (renderSection,
  // componentBounds, pointInside) should behave the same whether the model
  // came from manifold-js or OpenSCAD, since they operate on the rendered
  // Manifold rather than the source code.
  test('window helpers work on a SCAD-engine model too', async ({ page }) => {
    page.on('dialog', d => d.accept());
    // Switch to SCAD via the language toggle; the test session has no
    // versions yet so the switch should be silent.
    await page.locator('#lang-toggle button:has-text("SCAD")').click();
    // SCAD WASM is heavy (~10MB) and the language switch tears down + rebuilds
    // the partwright surface. Re-wait until it's back, then give SCAD a moment
    // for its first compile.
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(3_000);

    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: { run: (c: string) => Promise<unknown>; renderSection: (o: { axis: 'x' | 'y' | 'z' }) => unknown; componentBounds: () => unknown; pointInside: (p: [number, number, number]) => boolean | null } }).partwright;
      // Tiny sphere — coarse polyhedron, but a real solid.
      await pw.run('sphere(r=8, $fn=24);');
      return {
        section: pw.renderSection({ axis: 'z' }),
        comps: pw.componentBounds(),
        insideCenter: pw.pointInside([0, 0, 0]),
        outside: pw.pointInside([100, 0, 0]),
      };
    });
    const r = result as {
      section: { dataUrl: string; area: number; contours: number };
      comps: Array<{ volume: number; bbox: { size: number[] } }>;
      insideCenter: boolean;
      outside: boolean;
    };
    expect(r.section).toBeTruthy();
    // Sphere r=8 cut at the midpoint should give a single ~circular contour.
    // The exact area depends on OpenSCAD's $fn discretization and where the
    // section plane lands relative to a latitude band; just check it's a
    // plausible solid (greater than zero, less than the bbox cap).
    expect(r.section.area).toBeGreaterThan(50);
    expect(r.section.area).toBeLessThan(300);
    expect(r.section.contours).toBe(1);
    expect(r.section.dataUrl).toMatch(/^data:image\/svg\+xml/);
    expect(r.comps).toHaveLength(1);
    expect(r.insideCenter).toBe(true);
    expect(r.outside).toBe(false);
  });
});
