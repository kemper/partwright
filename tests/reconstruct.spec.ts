import { test, expect } from 'playwright/test';

// Mesh → code reconstruction golden path: build a model, round-trip it
// through STL export/import (so the session holds a real imported mesh),
// convert the import to smooth section-interpolated code, and check the
// faithfulness report. Exercises the reconstruct Worker, the generated
// code's levelSet run, and both new console APIs.
test.describe('convert to code (reconstruction)', () => {
  test('rebuilds an STL import as faithful levelSet code and reports metrics', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.runAndSave);

    const result = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      // WASM warmup (same loop as the other API-driven specs).
      let warmed = false;
      for (let i = 0; i < 60; i++) {
        const p = await pw.runAndSave('return api.Manifold.cube([1, 1, 1], true);', 'probe', {});
        if (p && !p.error && p.version) { warmed = true; break; }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!warmed) return { error: 'engine warmup timeout' };

      // A distinctive solid: sphere fused with an offset box (asymmetric, has
      // both smooth and flat regions).
      const src = await pw.runAndSave(
        'return api.Manifold.sphere(8, 48).add(api.Manifold.cube([10, 10, 10], true).translate([6, 0, 0]));',
        'source solid', {},
      );
      if (src?.error) return { error: 'source build failed: ' + src.error };

      const stl = await pw.exportSTLData();
      if (stl?.error) return { error: 'exportSTLData failed: ' + stl.error };
      const imp = await pw.importMeshData(stl.base64, 'probe.stl', { sessionName: 'reconstruct spec' });
      if (imp?.error) return { error: 'importMeshData failed: ' + imp.error };

      const t0 = performance.now();
      const conv = await pw.convertToCode({ quality: 'draft' });
      const convertMs = Math.round(performance.now() - t0);
      if (conv?.error) return { error: 'convertToCode failed: ' + conv.error };

      const evalRes = await pw.evalAgainstImport();
      if (evalRes?.error) return { error: 'evalAgainstImport failed: ' + evalRes.error };

      const code: string = pw.getCode();
      return {
        convertMs,
        stats: conv.stats,
        chamfer: conv.metrics.chamfer,
        hausdorff: conv.metrics.hausdorff,
        noiseFloor: conv.metrics.sampleSpacing,
        evalChamfer: evalRes.chamfer,
        codeHasLevelSet: code.includes('Manifold.levelSet'),
        codeHasImports: code.includes('api.imports'),
        versionLabel: conv.version?.label,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as {
      convertMs: number;
      stats: { components: number; sections: number };
      chamfer: number; hausdorff: number; noiseFloor: number; evalChamfer: number;
      codeHasLevelSet: boolean; codeHasImports: boolean; versionLabel?: string;
    };
    // The remake must be levelSet code, self-contained (no import references).
    expect(r.codeHasLevelSet).toBe(true);
    expect(r.codeHasImports).toBe(false);
    expect(r.stats.components).toBe(1);
    expect(r.stats.sections).toBeGreaterThan(5);
    expect(r.versionLabel).toContain('convert to code');
    // Faithfulness: mean deviation within a few noise floors of the sampled
    // metric, worst point well under the model's ~18-unit size. Draft quality
    // on a 16-unit solid — loose bounds, this is a smoke gate not a QC gate.
    expect(r.chamfer).toBeLessThan(r.noiseFloor * 4);
    expect(r.hausdorff).toBeLessThan(2);
    expect(r.evalChamfer).toBeLessThan(r.noiseFloor * 4);

    await page.screenshot({ path: 'test-results/reconstruct-golden.png' });
  });
});
