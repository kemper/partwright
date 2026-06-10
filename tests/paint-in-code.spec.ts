// api.paint.* — paint declared in code. The geometric/label paint selectors
// (the in-code counterparts of paintInBox / paintSlab / paintInCylinder /
// paintByLabel) are recorded during the run, resolved against the fresh mesh,
// and rendered as the model-color underlay. Because the code is the source of
// truth, these never become serialized user paint regions — so getModelRegions()
// picks them up while getRegions() (user paint) stays empty.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('api.paint.* (paint declared in code)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('records slab/box/cylinder/label paint into the model underlay, not user regions', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<unknown>;
      } }).partwright;
      await pw.createSession('paint-in-code');
      const code = [
        'const { Manifold } = api;',
        'const body = api.label(Manifold.cube([30, 30, 30], true).refine(16), "body");',
        "api.paint.slab({ axis: 'z', offset: 10, thickness: 10, color: '#e23b3b' });",
        'api.paint.box({ min: [-15, -15, -15], max: [0, 0, 0], color: [0.23, 0.51, 0.96] });',
        "api.paint.cylinder({ center: [0, 0], rMin: 0, rMax: 6, zMin: -15, zMax: 15, color: '#22c55e' });",
        "api.paint.label('body', '#888888');",
        'return body;',
      ].join('\n');
      await pw.run(code);

      const regions = await import('/src/color/regions.ts');
      const model = regions.getModelRegions().map(r => ({
        name: r.name,
        kind: r.descriptor.kind,
        tris: r.triangles.size,
        color: r.color.map(c => Math.round(c * 255)),
      }));
      return {
        userRegionCount: regions.getRegions().length,
        hasModel: regions.hasModelColorRegions(),
        model,
      };
    });

    // Paint declared in code is derived from the code, never a user paint region.
    expect(out.userRegionCount).toBe(0);
    expect(out.hasModel).toBe(true);

    // All four selectors resolved to a non-empty triangle set against the mesh.
    const byKind = new Map(out.model.map(m => [m.kind, m]));
    for (const kind of ['slab', 'box', 'cylinder', 'byLabel']) {
      const m = out.model.find(r => r.kind === kind);
      expect(m, `expected a code-paint region of kind ${kind}`).toBeTruthy();
      expect(m!.tris).toBeGreaterThan(0);
    }
    // Colors round-trip (hex and [r,g,b] forms both parse to the same RGB).
    expect(byKind.get('slab')!.color).toEqual([226, 59, 59]);
    expect(byKind.get('box')!.color).toEqual([59, 130, 245]);
    expect(byKind.get('cylinder')!.color).toEqual([34, 197, 94]);
  });

  test('rejects invalid arguments with actionable errors', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const errors = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        run: (code: string) => Promise<{ error?: string | null } | unknown>;
      } }).partwright;
      await pw.createSession('paint-in-code-errors');
      const runErr = async (line: string): Promise<string> => {
        const r = await pw.run(`const { Manifold } = api;\n${line}\nreturn Manifold.cube([10,10,10]);`) as { error?: string | null };
        return r?.error ?? '';
      };
      return {
        badColor: await runErr("api.paint.box({ min:[0,0,0], max:[1,1,1], color: 'not-a-color' });"),
        unknownKey: await runErr("api.paint.slab({ axis:'z', offset:0, thickness:1, color:'#fff', wat: 1 });"),
        missingAxis: await runErr("api.paint.slab({ offset:0, thickness:1, color:'#fff' });"),
      };
    });

    expect(errors.badColor).toContain('color');
    expect(errors.unknownKey).toContain('wat');
    expect(errors.missingAxis.toLowerCase()).toContain('axis');
  });
});
