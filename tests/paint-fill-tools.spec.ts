// Bucket-fill tool surface the in-app AI drives: paintRegion's tolerance is
// exposed in DEGREES on the tool (converted to the API's cosine), the normal
// hint is optional, and paintConnected's spatial clamp (withinBox/zMin/zMax)
// reaches the tool schema so a fill can't leak across a crease-less join.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

/** Run an in-app AI tool exactly as the chat loop does. */
async function tool(name: string, input: Record<string, unknown>) {
  return page.evaluate(async ({ name, input }) => {
    const tools = await import('/src/ai/tools.ts');
    return tools.executeTool(name, input);
  }, { name, input });
}

test.describe('bucket-fill AI tools', () => {
  test('paintRegion toleranceDeg follows a faceted cylinder; default stays on one facet', async () => {
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      // 32 segments → ~11.25° bend between adjacent side facets.
      await pw.run('return api.Manifold.cylinder(20, 10, 10, 32);');
    });
    const seed = { point: [10, 0, 10], color: [1, 0, 0] };

    const strict = await tool('paintRegion', { ...seed });
    expect(strict.isError).toBe(false);
    const strictTris = JSON.parse(strict.content).triangles as number;

    const loose = await tool('paintRegion', { ...seed, toleranceDeg: 12 });
    expect(loose.isError).toBe(false);
    const looseTris = JSON.parse(loose.content).triangles as number;

    // Default ≈1.8° paints one facet strip; 12° walks the whole side wall
    // (and stops at the 90° rims).
    expect(strictTris).toBeLessThanOrEqual(4);
    expect(looseTris).toBeGreaterThanOrEqual(64);
    expect(looseTris).toBeLessThan(128);
  });

  test('paintRegion rejects a degree value passed as the cosine `tolerance`', async () => {
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
    });
    const res = await tool('paintRegion', { point: [0, 0, 10], color: [1, 0, 0], tolerance: 30 });
    expect(res.content).toContain('cosine');
    const out = await tool('paintRegion', { point: [0, 0, 10], color: [1, 0, 0], toleranceDeg: 400 });
    // Tool errors come back as an `{ error }` payload, like every API error.
    expect(JSON.parse(out.content).error).toContain('toleranceDeg');
  });

  test('paintRegion works without a normal hint (snaps to nearest face)', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      // Slightly off the top face — the old API required an exact normal.
      return pw.paintRegion({ point: [1, 2, 10.05], color: [0, 0, 1] });
    });
    expect(r.error).toBeUndefined();
    expect(r.triangles).toBe(2);
  });

  test('paintConnected zMax clamp keeps a full-sphere flood below the line', async () => {
    const res = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.sphere(10, 48);');
      return true;
    });
    expect(res).toBe(true);
    const out = await tool('paintConnected', {
      seed: { point: [0, 0, -10] },
      maxDeviationDeg: 180,
      zMax: 2,
      color: [0.2, 0.6, 1],
      name: 'clamped',
    });
    expect(out.isError).toBe(false);
    const bbox = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = pw.listRegions().find((x: { name: string }) => x.name === 'clamped');
      return r?.bbox;
    });
    // Unclamped, maxDeviationDeg 180 floods the whole sphere (top at z=10).
    // Clamped by centroid at z=2, only a triangle's height can poke above.
    expect(bbox.max[2]).toBeLessThan(3.5);
    expect(bbox.min[2]).toBeLessThan(-9);
  });
});
