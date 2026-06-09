// api.surface.* — surface textures declared in code. The op chain is recorded
// during the run but applied (and memoized) on the MAIN thread.
//
// Explicit/console runs (partwright.run / runAndSave, the Run button, version
// loads) FORCE the memoized compute and return the textured mesh — so an
// AI/console caller gets the real result with no extra step (it can't press the
// in-UI pill). Only the editor's live-typing auto-run is gated behind the
// "Re-apply" pill. See src/surface/surfaceOps.ts + applySurfaceTextures.

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
  run: (code: string) => Promise<{ error?: string | null; triangleCount?: number } | unknown>;
  getGeometryData: () => { triangleCount?: number };
};

test.describe('api.surface.* (textures declared in code)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('a console run force-applies the texture and returns the textured mesh', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code');
      // Base sphere triangle count, no texture.
      const plain = await pw.run([
        'const { Manifold } = api;',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };
      // Same geometry + a cable texture: the console run must compute it inline
      // (not gate) so the returned stats reflect the textured, subdivided mesh.
      const textured = await pw.run([
        'const { Manifold } = api;',
        'api.surface.cable({ cableWidth: 1.6, amplitude: 0.5 });',
        'return Manifold.sphere(10, 48);',
      ].join('\n')) as { triangleCount?: number };
      return { plainTris: plain.triangleCount ?? 0, texturedTris: textured.triangleCount ?? 0 };
    });

    expect(out.plainTris).toBeGreaterThan(0);
    // The texture subdivides + displaces, so triangle count grows substantially.
    expect(out.texturedTris).toBeGreaterThan(out.plainTris);

    // No "Re-apply" pill on a console/explicit run — the texture was applied.
    await expect(page.getByRole('button', { name: /Re-apply/ })).toBeHidden();
    await page.screenshot({ path: 'test-results/surface-in-code-textured.png' });
  });

  test('rejects unknown surface options with an actionable error', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const err = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code-errors');
      const r = await pw.run([
        'const { Manifold } = api;',
        'api.surface.knit({ stitchWidth: 1, nope: 2 });',
        'return Manifold.cube([10, 10, 10]);',
      ].join('\n')) as { error?: string | null };
      return r?.error ?? '';
    });
    expect(err).toContain('nope');
  });
});
