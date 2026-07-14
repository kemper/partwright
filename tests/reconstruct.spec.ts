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

  test('STL import offers the convert-to-code panel with threshold controls', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.runAndSave);

    // Build a small solid and export its STL bytes to feed the file input.
    const stlB64 = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      for (let i = 0; i < 60; i++) {
        const p = await pw.runAndSave('return api.Manifold.cube([1,1,1], true);', 'probe', {});
        if (p && !p.error && p.version) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      await pw.runAndSave('return api.Manifold.sphere(7, 32);', 'stl source', {});
      const stl = await pw.exportSTLData();
      return stl.base64 as string;
    });

    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'ask-probe.stl',
      mimeType: 'model/stl',
      buffer: Buffer.from(stlB64, 'base64'),
    });
    // Real work exists in the session → the import-target modal appears first.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: /new part/i }).click();

    // The post-import ask is the same settings panel the Tools pill opens:
    // context line, quality presets, derived threshold placeholders.
    await expect(page.getByText('Imported ask-probe.stl as a mesh')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Keep mesh only' })).toBeVisible();
    await page.getByText('Advanced thresholds').click();
    await expect(page.locator('[data-convert-field="step"]')).toHaveAttribute('placeholder', /\d/);
    await expect(page.getByText(/levelSet samples — build ~/)).toBeVisible();

    // Convert at draft — the part's code becomes the self-contained remake.
    await page.getByRole('button', { name: 'Draft' }).click();
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(page.getByText(/Converted to code — mean deviation/)).toBeVisible({ timeout: 120_000 });
    const code = await page.evaluate(() => (window as any).partwright.getCode() as string);
    expect(code).toContain('Manifold.levelSet');
    expect(code).not.toContain('api.imports');
  });

  test('measurement tools: profileModel finds primitives, compareToImport locates a dropped feature', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.runAndSave);

    const result = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      for (let i = 0; i < 60; i++) {
        const p = await pw.runAndSave('return api.Manifold.cube([1,1,1], true);', 'probe', {});
        if (p && !p.error && p.version) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      // Box pedestal (20×20×10) with a cylinder r=4 (z 10..24) on top.
      const src = await pw.runAndSave(
        `const { Manifold } = api;
         return Manifold.cube([20, 20, 10], true).translate([0, 0, 5])
           .add(Manifold.cylinder(14, 4, 4, 64).translate([0, 0, 10]));`,
        'profiled solid', {},
      );
      if (src?.error) return { error: 'source failed: ' + src.error };
      const stl = await pw.exportSTLData();
      const imp = await pw.importMeshData(stl.base64, 'profile-probe.stl', { sessionName: 'measure spec' });
      if (imp?.error) return { error: 'import failed: ' + imp.error };

      // 1. Profile the import: expect a measured cylinder run + a rect run on Z.
      const profile = await pw.profileModel();
      if (profile?.error) return { error: 'profileModel failed: ' + profile.error };
      const zAxis = profile.axes.find((a: { axis: string }) => a.axis === 'z');
      const cylRun = zAxis?.runs.find((r: { kind: string }) => r.kind === 'circle');
      const rectRun = zAxis?.runs.find((r: { kind: string }) => r.kind === 'rect');

      // 2. Inscribed primitive on the import.
      const inscribed = await pw.fitInscribed({ kind: 'box' });
      if (inscribed?.error) return { error: 'fitInscribed failed: ' + inscribed.error };

      // 3. Compare: the current model (identical to the import) → IoU ≈ 1.
      const same = await pw.compareToImport();
      if (same?.error) return { error: 'compareToImport failed: ' + same.error };

      // 4. Drop the cylinder and re-compare: a located 'missing' finding.
      const dropped = await pw.runAndSave(
        'return api.Manifold.cube([20, 20, 10], true).translate([0, 0, 5]);',
        'cylinder dropped', {},
      );
      if (dropped?.error) return { error: 'dropped-model run failed: ' + dropped.error };
      const diff = await pw.compareToImport();
      if (diff?.error) return { error: 'second compareToImport failed: ' + diff.error };

      return {
        cylRun, rectRun,
        inscribedFraction: inscribed.volumeFraction,
        inscribedKind: inscribed.kind,
        sameIoU: same.volumeIoU,
        sameFindings: same.findings.length,
        diffIoU: diff.volumeIoU,
        missing: diff.findings.find((f: { sign: string }) => f.sign === 'missing') ?? null,
      };
    });

    expect((result as { error?: string }).error).toBeUndefined();
    const r = result as {
      cylRun: { circle: { r: number }; from: number; to: number } | undefined;
      rectRun: { rect: { w: number; h: number } } | undefined;
      inscribedFraction: number; inscribedKind: string;
      sameIoU: number; sameFindings: number;
      diffIoU: number;
      missing: { centroid: number[]; extent: number[]; classification: string } | null;
    };
    // The profiler measured the cylinder (r≈4, spanning z≈10..24) and the box.
    expect(r.cylRun).toBeDefined();
    expect(r.cylRun!.circle.r).toBeGreaterThan(3.6);
    expect(r.cylRun!.circle.r).toBeLessThan(4.4);
    expect(r.cylRun!.to).toBeGreaterThan(22);
    expect(r.rectRun).toBeDefined();
    expect(r.rectRun!.rect.w).toBeGreaterThan(18);
    // Inscribed box covers a solid share of the volume.
    expect(r.inscribedKind).toBe('box');
    expect(r.inscribedFraction).toBeGreaterThan(0.4);
    // Identical model vs import: near-perfect IoU, no findings.
    expect(r.sameIoU).toBeGreaterThan(0.98);
    expect(r.sameFindings).toBe(0);
    // Dropped cylinder: IoU falls, and the missing blob sits where the
    // cylinder was (z centroid ≈ 17, roughly 8-unit diameter).
    expect(r.diffIoU).toBeLessThan(0.95);
    expect(r.missing).not.toBeNull();
    expect(r.missing!.centroid[2]).toBeGreaterThan(12);
    expect(r.missing!.classification).toBe('compact-feature');

    await page.screenshot({ path: 'test-results/reconstruct-measure.png' });
  });
});
