// Golden path for api.lowPoly — the in-code low-poly crystallizer. Builds a
// smooth SDF body, then decimates it to a triangle budget and asserts the mesh
// actually shrank, that facetSize is an alternative knob, and that bad args are
// rejected with a clear error (the sandbox surfaces a throw as run().error).

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
  run: (code: string) => Promise<{ error?: string | null; triangleCount?: number }>;
};

const BODY = [
  'const b = api.sdf.capsule([0,0,0],[0,0,20],6)',
  '  .smoothUnion(api.sdf.sphere(7).translate([0,0,24]),3);',
  'const mesh = b.build({ edgeLength: 0.6 });',
].join('\n');

test.describe('api.lowPoly', () => {
  test('crystallizes a smooth SDF body to a triangle budget', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async (body) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('lowpoly');
      const smooth = await pw.run(`${body}\nreturn mesh;`);
      const low = await pw.run(`${body}\nreturn api.lowPoly(mesh, { targetTriangles: 400 });`);
      const facet = await pw.run(`${body}\nreturn api.lowPoly(mesh, { facetSize: 3 });`);
      return {
        smooth: smooth.triangleCount ?? 0,
        low: low.triangleCount ?? 0,
        facet: facet.triangleCount ?? 0,
        lowErr: low.error ?? null,
        facetErr: facet.error ?? null,
      };
    }, BODY);

    expect(out.lowErr).toBeNull();
    expect(out.facetErr).toBeNull();
    expect(out.smooth).toBeGreaterThan(1000);
    // Triangle-budget path lands at or under the requested budget.
    expect(out.low).toBeGreaterThan(0);
    expect(out.low).toBeLessThanOrEqual(400);
    // facetSize path also coarsens the mesh (fewer triangles than the source).
    expect(out.facet).toBeGreaterThan(0);
    expect(out.facet).toBeLessThan(out.smooth);
  });

  test('rejects invalid arguments with a clear error', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const errs = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('lowpoly-validation');
      const notManifold = await pw.run(`return api.lowPoly('nope', { targetTriangles: 100 });`);
      const bothKnobs = await pw.run(
        `const m = api.sdf.sphere(8).build({ edgeLength: 1 });\nreturn api.lowPoly(m, { targetTriangles: 100, facetSize: 2 });`,
      );
      const badKey = await pw.run(
        `const m = api.sdf.sphere(8).build({ edgeLength: 1 });\nreturn api.lowPoly(m, { nope: 1 });`,
      );
      return {
        notManifold: notManifold.error ?? '',
        bothKnobs: bothKnobs.error ?? '',
        badKey: badKey.error ?? '',
      };
    });

    expect(errs.notManifold).toContain('must be a Manifold');
    expect(errs.bothKnobs).toContain('either targetTriangles OR facetSize');
    expect(errs.badKey).toContain('unknown option');
  });
});
