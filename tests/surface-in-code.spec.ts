// api.surface.* — surface textures declared in code. The op chain is recorded
// during the run but applied (and memoized) on the MAIN thread. Because the
// textures are expensive, a run with an uncached chain renders the BASE mesh and
// raises a "Re-apply" pill; pressing it computes the texture on demand and the
// next render serves the cached, textured mesh. See src/surface/surfaceOps.ts.

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

  test('sticky gating: base mesh + Re-apply pill, then textured on demand', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const baseTris = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-in-code');
      const code = [
        'const { Manifold } = api;',
        'api.surface.knit({ stitchWidth: 1.4, amplitude: 0.6 });',
        'return Manifold.sphere(10, 48);',
      ].join('\n');
      const r = await pw.run(code) as { triangleCount?: number };
      return r.triangleCount ?? 0;
    });
    expect(baseTris).toBeGreaterThan(0);

    // First run leaves the texture uncached → the pill is shown over the base mesh.
    const pill = page.getByRole('button', { name: /Re-apply/ });
    await expect(pill).toBeVisible();
    await page.screenshot({ path: 'test-results/surface-in-code-stale.png' });

    // Press it: compute the texture, then the re-run serves the cached textured
    // mesh (more triangles — knit subdivides + displaces) and the pill clears.
    await pill.click();
    await expect(pill).toBeHidden({ timeout: 30_000 });

    const texturedTris = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.getGeometryData().triangleCount ?? 0;
    });
    expect(texturedTris).toBeGreaterThan(baseTris);
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
