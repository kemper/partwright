// Phase 5 — per-region surface textures: api.surface.<id>({ region }) textures
// only the triangles matching a selector (label / box / slab / cylinder) via the
// patch modifier variants, resolved against the mesh on the main thread.

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
  run: (code: string) => Promise<{ error?: string | null; triangleCount?: number; isManifold?: boolean } | unknown>;
};

const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(12, 48);';

test.describe('api.surface.* per-region textures', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('a box region textures only part of the mesh (patch, not whole-model)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-region');
      const base = await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(12, 48);') as { triangleCount?: number };
      const whole = await pw.run([
        'const { Manifold } = api;',
        'api.surface.knit({ stitchWidth: 1.6, amplitude: 0.6 });',
        'return Manifold.sphere(12, 48);',
      ].join('\n')) as { triangleCount?: number };
      const region = await pw.run([
        'const { Manifold } = api;',
        'api.surface.knit({ stitchWidth: 1.6, amplitude: 0.6, region: { box: { min: [-12, -12, 0], max: [12, 12, 12] } } });',
        'return Manifold.sphere(12, 48);',
      ].join('\n')) as { triangleCount?: number; isManifold?: boolean };
      return {
        base: base.triangleCount ?? 0,
        whole: whole.triangleCount ?? 0,
        region: region.triangleCount ?? 0,
        regionManifold: region.isManifold,
      };
    });

    // The region patch subdivides only its triangles: more than the base, but
    // fewer than texturing the whole sphere.
    expect(out.region).toBeGreaterThan(out.base);
    expect(out.region).toBeLessThan(out.whole);
    await page.screenshot({ path: 'test-results/surface-region-box.png' });
  });

  test('a labeled region textures by api.label name', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-region-label');
      const base = await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(12, 48);') as { triangleCount?: number };
      const r = await pw.run([
        'const { Manifold } = api;',
        "const body = api.label(Manifold.sphere(12, 48), 'body');",
        "api.surface.knit({ stitchWidth: 1.6, amplitude: 0.6, region: 'body' });",
        'return body;',
      ].join('\n')) as { triangleCount?: number; error?: string | null };
      return { base: base.triangleCount ?? 0, tris: r.triangleCount ?? 0, error: r.error ?? null };
    });
    expect(out.error).toBeNull();
    expect(out.tris).toBeGreaterThan(out.base); // body region got textured/subdivided
  });

  test('rejects a region with more than one selector', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const err = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('surface-region-err');
      const r = await pw.run([
        'const { Manifold } = api;',
        "api.surface.knit({ region: { label: 'a', box: { min: [0,0,0], max: [1,1,1] } } });",
        'return Manifold.cube([10, 10, 10]);',
      ].join('\n')) as { error?: string | null };
      return r?.error ?? '';
    });
    expect(err.toLowerCase()).toContain('exactly one');
  });
});
