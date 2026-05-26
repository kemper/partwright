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
});
