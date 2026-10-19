// "Paint within part" (#1025): paint selectors take `withinPart` and are
// clipped to that part, the Paint panel's "Paint within" picker scopes the UI
// tools, and api.paint.* in code honours the same key.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => Promise<Record<string, unknown>> | Record<string, unknown>>;

// Two labelled blocks fused into one solid: left x∈[0,10], right x∈[10,20].
const CODE = `
  const { Manifold } = api;
  const left = api.label(Manifold.cube([10, 10, 10]).refine(4), 'left');
  const right = api.label(Manifold.cube([10, 10, 10]).refine(4).translate([10, 0, 0]), 'right');
  return left.add(right);
`;

async function open(page: Page, code = CODE): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.evaluate(async (src) => {
    await (window as unknown as { partwright: PW }).partwright.run(src);
  }, code);
}

test.describe('paint within part', () => {
  test('withinPart clips API paint to one part and validates the name', async ({ page }) => {
    await open(page);
    const r = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const labels = (pw.listLabels() as { labels: { name: string; triangleCount: number }[] }).labels;
      const rightCount = labels.find((l) => l.name === 'right')!.triangleCount;
      // A slab through both blocks, scoped to the right one.
      const slab = pw.paintSlab({ axis: 'z', offset: -5, thickness: 30, color: [1, 0, 0], withinPart: 'right', smooth: false }) as { triangles: number; error?: string };
      // A sphere centred on the left block reaches the right one — the clip keeps it out.
      const near = pw.paintNear({ point: [9, 5, 10], radius: 4, color: [0, 0, 1], withinPart: 'left' }) as { bbox: { max: number[] }; error?: string };
      const unknown = pw.paintNear({ point: [5, 5, 10], radius: 2, color: [0, 0, 1], withinPart: 'middle' }) as { error?: string };
      const outside = pw.paintNear({ point: [2, 5, 10], radius: 1, color: [0, 0, 1], withinPart: 'right' }) as { error?: string };
      return { rightCount, slab, near, unknown, outside, regions: (pw.listRegions() as unknown[]).length };
    });
    expect(r.slab.error).toBeUndefined();
    expect(r.slab.triangles).toBe(r.rightCount);
    expect(r.near.error).toBeUndefined();
    expect(r.near.bbox.max[0]).toBeLessThanOrEqual(10.001);
    expect(r.unknown.error).toMatch(/no part "middle".*"left"/);
    expect(r.outside.error).toMatch(/nothing inside part "right"/);
    // The empty scoped selection left no region behind.
    expect(r.regions).toBe(2);
  });

  test('api.paint.* in code honours withinPart', async ({ page }) => {
    await open(page, `${CODE.replace('return left.add(right);', '')}
      api.paint.slab({ axis: 'z', offset: -5, thickness: 30, color: '#ff0000', withinPart: 'left' });
      return left.add(right);`);
    const colors = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const labels = (pw.listLabels() as { labels: { name: string; triangleCount: number }[] }).labels;
      const model = (pw.getModelColors() as { colors: { triangleCount: number }[] }).colors;
      return { left: labels.find((l) => l.name === 'left')!.triangleCount, painted: model[0]?.triangleCount };
    });
    expect(colors.painted).toBe(colors.left);
  });

  test('the Paint panel picker scopes UI paint', async ({ page }) => {
    await open(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    const picker = page.getByLabel('Paint within part');
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveText(['Whole model', 'left', 'right']);
    await picker.selectOption('left');

    // Commit a whole-mesh region the way a UI tool does (scope stamped from the
    // picker), through the same module instances the app uses.
    const res = await page.evaluate(async () => {
      const { withPaintScope } = await import('/src/color/paintScope.ts');
      const { addRegion } = await import('/src/color/regions.ts');
      const pw = (window as unknown as { partwright: PW }).partwright;
      const mesh = pw.getMesh() as { numTri: number };
      const all = new Set<number>(Array.from({ length: mesh.numTri }, (_, i) => i));
      const region = addRegion('ui', [0, 1, 0], 'paintbrush', withPaintScope({ kind: 'triangles', ids: [...all] }), all);
      const labels = (pw.listLabels() as { labels: { name: string; triangleCount: number }[] }).labels;
      return { painted: region.triangles.size, scope: region.descriptor.withinPart, left: labels.find((l) => l.name === 'left')!.triangleCount };
    });
    expect(res.scope).toBe('left');
    expect(res.painted).toBe(res.left);

    // Back to the whole model.
    await picker.selectOption('');
    const unscoped = await page.evaluate(async () => (await import('/src/color/paintScope.ts')).getPaintScope());
    expect(unscoped).toBeNull();

    // A scope whose part disappears (code re-run with no labels) is dropped,
    // not left hidden and clipping every stroke to nothing.
    await picker.selectOption('right');
    const after = await page.evaluate(async () => {
      await (window as unknown as { partwright: PW }).partwright.run('return api.Manifold.cube([10, 10, 10]);');
      return (await import('/src/color/paintScope.ts')).getPaintScope();
    });
    expect(after).toBeNull();
    await expect(picker).toBeHidden();
  });
});
