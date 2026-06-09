// Phase 4 — applying a surface texture as parametric api.surface.* code instead
// of baking. The Surface panel's "Apply as editable code" path and the
// partwright.surfaceTexture(id, opts) console method / AI tool all route through
// commitSurfaceCode, which appends the call to the model source and re-runs.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<{ triangleCount?: number } | unknown>;
  surfaceTexture: (id: string, opts?: Record<string, unknown>) => Promise<{ ok?: boolean; mode?: string; error?: string }>;
  getCode: () => string;
  getGeometryData: () => { triangleCount?: number };
};

test.describe('surfaceTexture (apply as api.surface.* code)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('emits api.surface.* into the code and renders textured', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-code-emit');
      const plain = await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(10, 48);') as { triangleCount?: number };
      const res = await pw.surfaceTexture('knit', { stitchWidth: 1.4, amplitude: 0.6 });
      return {
        plainTris: plain.triangleCount ?? 0,
        res,
        code: pw.getCode(),
        tris: pw.getGeometryData().triangleCount ?? 0,
      };
    });

    expect(out.res.ok).toBe(true);
    expect(out.res.mode).toBe('code');
    // The texture now lives in the editor source as a parametric call.
    expect(out.code).toContain('api.surface.knit(');
    expect(out.code).toContain('stitchWidth: 1.4');
    // ...and the rendered model is textured (subdivided → more triangles).
    expect(out.tris).toBeGreaterThan(out.plainTris);
    await page.screenshot({ path: 'test-results/surface-code-emit.png' });
  });

  test('rejects an unknown texture id', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const err = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-code-emit-err');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([10,10,10]);');
      const r = await pw.surfaceTexture('bogus', {});
      return r.error ?? '';
    });
    expect(err).toContain('bogus');
  });
});
