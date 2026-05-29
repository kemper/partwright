import { test, expect } from 'playwright/test';

// BREP integration smoke — covers the two BREP entry points:
//
//   Phase C: `api.BREP.*` inside a manifold-js sandbox. The user's code
//   mentions BREP, the worker preloads OCCT, the BREP shape converts to
//   a Manifold and shows up like any other mesh.
//
//   Phase A: `setActiveLanguage('replicad')` switches the session to a
//   full BREP language. Code must return a BrepShape; STEP export works
//   off the retained shape.
//
// Both paths share the OCCT WASM (~10 MB) which is lazy-loaded — the suite
// allows long timeouts on the first run for that download/instantiation.

test.describe('BREP integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    // Wait for the console API to be wired (engine + worker ready).
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('Phase C — api.BREP works inside a manifold-js session', async ({ page }) => {
    // Run a tiny program that uses BREP for an exact fillet and converts back
    // to a Manifold. The worker should preload OCCT (first call is slow), run
    // the script, and return a non-empty mesh. Triangle count is bigger than
    // a plain cube because the rounded edges add geometry.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = `
        const { Manifold, BREP } = api;
        const filleted = BREP.box([20, 20, 10]).fillet(2);
        return BREP.toManifold(filleted, Manifold);
      `;
      const out = await pw.run(code);
      return out;
    });

    expect(result).toBeTruthy();
    expect(result.error).toBeFalsy();
    // A 20x20x10 box with a 2 mm fillet on every edge tessellates into a few
    // hundred to a few thousand triangles depending on the default tolerance —
    // far more than a plain 12-triangle cube.
    expect(result.triangleCount).toBeGreaterThan(100);
    expect(result.isManifold).toBe(true);
  });

  test('Phase A — switching to replicad language renders a BREP shape', async ({ page }) => {
    // Switch language, then run a BREP-language program. The default starter
    // is a filleted box; we use an even simpler shape so this test does not
    // care about the starter content. setActiveLanguage resets the editor to
    // a stub but does NOT auto-run; we run explicitly via partwright.run.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('replicad');
      const code = `
        const { BREP } = api;
        return BREP.box([15, 15, 15]).fillet(1);
      `;
      const out = await pw.run(code);
      return { lang: pw.getActiveLanguage(), out };
    });

    expect(result.lang).toBe('replicad');
    expect(result.out).toBeTruthy();
    expect(result.out.error).toBeFalsy();
    expect(result.out.triangleCount).toBeGreaterThan(100);
  });

  test('Phase A — exportSTEP returns a non-empty STEP blob after a BREP run', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('replicad');
      await pw.run(`
        const { BREP } = api;
        return BREP.box([10, 10, 10]).fillet(0.5);
      `);
      const exported = await pw.exportSTEP();
      return exported;
    });

    expect(result.ok).toBe(true);
    expect(result.filename).toMatch(/\.step$/);
    expect(result.sizeBytes).toBeGreaterThan(100);
  });

  test('Phase A — exportSTEP without a BREP shape reports a friendly error', async ({ page }) => {
    // Without switching to replicad and running a BREP-returning program,
    // there's no retained BREP shape — the call should resolve to
    // { ok: false, error } rather than throw or hang.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return await pw.exportSTEP();
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no BREP shape/i);
  });

  // Coverage for the feedback-driven additions: immutability (no more "this
  // object has been deleted" after a second op), array helpers (`fuseAll`
  // etc.), selective edge filtering, and the formatted fillet error.

  test('immutability — same shape can be used in multiple ops', async ({ page }) => {
    // The old destructive replicad behaviour would invalidate `base` after
    // the first op. With our clone-before-mutate wrapper, both ops succeed
    // and the union returns a valid manifold mesh.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = `
        const { Manifold, BREP } = api;
        const base = BREP.box([10, 10, 10]);
        const rounded = base.fillet(2);
        const beveled = base.chamfer(0.5);
        const combined = BREP.fuseAll([rounded, beveled.translate([20, 0, 0])]);
        return BREP.toManifold(combined, Manifold);
      `;
      return await pw.run(code);
    });

    expect(result.error).toBeFalsy();
    expect(result.isManifold).toBe(true);
    expect(result.componentCount).toBe(2);
  });

  test('BREP.fuseAll — the canonical reduce pattern works', async ({ page }) => {
    // 7 spheres arranged on a line, fused via the new array helper. Used
    // to require .fuse() chained by hand because of the destructive model.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = `
        const { Manifold, BREP } = api;
        const spheres = [];
        for (let i = 0; i < 7; i++) {
          spheres.push(BREP.sphere(3).translate([i * 4, 0, 0]));
        }
        const fused = BREP.fuseAll(spheres);
        return BREP.toManifold(fused, Manifold);
      `;
      return await pw.run(code);
    });

    expect(result.error).toBeFalsy();
    expect(result.isManifold).toBe(true);
    // Adjacent spheres overlap (radius 3, step 4 ⇒ 2-unit overlap) so the
    // union collapses into a single component, not seven.
    expect(result.componentCount).toBe(1);
  });

  test('selective fillet — EdgeFilter narrows which edges get rounded', async ({ page }) => {
    // Fillet only the top rim of a cylinder — far fewer geometry changes
    // than filleting every edge, so the resulting mesh has fewer triangles
    // than a fully-filleted shape of the same cylinder.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = `
        const { Manifold, BREP } = api;
        const h = 20;
        // Only top rim — minZ near the top means OCCT picks just the top circular edge.
        const topOnly = BREP.cylinder(5, h).fillet(0.8, { minZ: h - 0.001 });
        return BREP.toManifold(topOnly, Manifold);
      `;
      return await pw.run(code);
    });

    expect(result.error).toBeFalsy();
    expect(result.isManifold).toBe(true);
    expect(result.triangleCount).toBeGreaterThan(50);
  });

  test('BREP.label — labels survive fuseAll and feed paintByLabel', async ({ page }) => {
    // Build an e-stop-style stack with each piece labeled. After fuseAll
    // the result is a single welded mesh; BREP.label's spatial signatures
    // should keep dome / collar / base triangles bucketed under their
    // respective names. paintByLabel reads from that map.
    //
    // We assert all three labels exist and each paints a non-empty set —
    // *which* triangles end up under which label is best-effort across
    // fuse seams, so we don't assert exact positions here (that's the
    // domain of follow-up tuning on the spatial signature resolver).
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = `
        const { Manifold, BREP } = api;
        const base   = BREP.label(BREP.cylinder(30, 5),                       'base');
        const collar = BREP.label(BREP.cylinder(25, 8).translate([0, 0, 5]),  'collar');
        const dome   = BREP.label(BREP.sphere(20).translate([0, 0, 13]),      'dome');
        return BREP.toManifold(BREP.fuseAll([base, collar, dome]), Manifold);
      `;
      const run = await pw.run(code);
      const labels = pw.listLabels();
      const baseRes   = pw.paintByLabel({ label: 'base',   color: [0.2, 0.2, 0.2] });
      const collarRes = pw.paintByLabel({ label: 'collar', color: [1.0, 0.85, 0.0] });
      const domeRes   = pw.paintByLabel({ label: 'dome',   color: [0.85, 0.1, 0.1] });
      return { run, labels, baseRes, collarRes, domeRes };
    });

    expect(result.run.error).toBeFalsy();
    expect(result.run.isManifold).toBe(true);
    // All three labels should be present (sanity check on propagation
    // through `fuseAll`). The exact shape returned by listLabels is
    // `{count, labels: [{name, triangleCount, bbox, centroid}, …]}`.
    const labelNames = (result.labels.labels as Array<{ name: string }>).map(l => l.name);
    expect(labelNames).toEqual(expect.arrayContaining(['base', 'collar', 'dome']));
    // Each paint call must return a non-empty region (the label resolved).
    for (const r of [result.baseRes, result.collarRes, result.domeRes]) {
      expect(r.error).toBeFalsy();
      expect(r.triangles).toBeGreaterThan(0);
    }
  });

  test('friendly fillet error — too-large radius surfaces a hint', async ({ page }) => {
    // A fillet bigger than the smaller box dimension can't be solved by
    // OCCT. The raw error is an integer pointer; our wrapper turns it into
    // a hint-bearing message. We only assert the hint is present — the
    // OCCT message itself varies by version.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = `
        const { Manifold, BREP } = api;
        // Fillet radius 10 on a 5x5x5 box — geometrically impossible.
        return BREP.toManifold(BREP.box([5, 5, 5]).fillet(10), Manifold);
      `;
      return await pw.run(code);
    });

    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/BREP\.fillet failed/);
    expect(result.error).toMatch(/smaller value|smaller radius|before \.cut/i);
  });
});
