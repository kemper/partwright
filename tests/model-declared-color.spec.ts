// Model-declared per-region color: model code attaches a color to a label via
// api.label(shape, name, { color }). The color renders + exports automatically
// as a derived underlay — no manual paint step — while the editor stays
// editable, and manual paint composites on top as an optional override. This
// exercises the full sandbox → worker → render loop in a real browser (the
// compositing logic itself is unit-tested in tests/unit/regionsCompositing).

import { test, expect, type Page } from 'playwright/test';

const COLOR_MODEL = `const { Manifold } = api;
const body = api.label(Manifold.cube([20, 20, 20], true), 'body', { color: '#3b82f6' });
const knob = api.label(Manifold.cylinder(6, 4, 4, 32).translate([0, 0, 13]), 'knob', { color: [1, 0, 0] });
return body.add(knob);`;

const PARAM_COLOR_MODEL = `const { Manifold } = api;
const p = api.params({ accent: { type: 'color', default: '#00ff00', label: 'Accent' } });
return api.label(Manifold.cube([20, 20, 20], true), 'body', { color: p.accent });`;

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('Model-declared color', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('api.label({ color }) resolves to colored regions; the editor stays editable', async ({ page }) => {
    const res = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const run = await pw.run(code);
      return { error: run.error, model: pw.getModelColors(), regions: pw.listRegions().length };
    }, COLOR_MODEL);

    expect(res.error).toBeUndefined();
    expect(res.model.count).toBe(2);
    const byName: Record<string, { color: number[]; triangleCount: number }> =
      Object.fromEntries(res.model.colors.map((c: { name: string }) => [c.name, c]));
    expect(byName.body.triangleCount).toBeGreaterThan(0);
    expect(byName.knob.triangleCount).toBeGreaterThan(0);
    // '#3b82f6' normalized to 0..1
    expect(byName.body.color[0]).toBeCloseTo(0x3b / 255, 2);
    expect(byName.body.color[1]).toBeCloseTo(0x82 / 255, 2);
    expect(byName.body.color[2]).toBeCloseTo(0xf6 / 255, 2);
    // [1,0,0] array form
    expect(byName.knob.color).toEqual([1, 0, 0]);

    // Model colors are NOT user paint regions...
    expect(res.regions).toBe(0);
    // ...so the editor must NOT lock (the lock is a paint-only concept).
    await expect(page.locator('#editor-lock-overlay')).toHaveCount(0);
  });

  test('a color param drives a region color — setParams re-runs and recolors', async ({ page }) => {
    const out = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(code);
      const before = pw.getModelColors().colors[0].color;
      await pw.setParams({ accent: '#ff00ff' });
      const after = pw.getModelColors().colors[0].color;
      return { before, after };
    }, PARAM_COLOR_MODEL);

    // default '#00ff00' → green
    expect(out.before[0]).toBeCloseTo(0, 2);
    expect(out.before[1]).toBeCloseTo(1, 2);
    expect(out.before[2]).toBeCloseTo(0, 2);
    // '#ff00ff' → magenta after the param change
    expect(out.after[0]).toBeCloseTo(1, 2);
    expect(out.after[1]).toBeCloseTo(0, 2);
    expect(out.after[2]).toBeCloseTo(1, 2);

    // Driving color via a param still doesn't lock the editor.
    await expect(page.locator('#editor-lock-overlay')).toHaveCount(0);
  });

  test('manual paint composites on top and is the thing that locks the editor', async ({ page }) => {
    const res = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(code);
      const beforeRegions = pw.listRegions().length;
      const paint = pw.paintByLabel({ label: 'body', color: [0, 0, 0] });
      return {
        paintError: paint.error,
        beforeRegions,
        afterRegions: pw.listRegions().length,
        modelStillThere: pw.getModelColors().count,
      };
    }, COLOR_MODEL);

    expect(res.paintError).toBeUndefined();
    expect(res.beforeRegions).toBe(0); // before painting: no user regions, only the model underlay
    expect(res.afterRegions).toBe(1);  // the manual paint added exactly one user region
    expect(res.modelStillThere).toBe(2); // model colors persist underneath the paint
    // Painting a user region locks the editor, exactly as before this feature.
    await expect(page.locator('#editor-lock-overlay')).toHaveCount(1);
  });

  test('model-declared colors flow into OBJ/3MF export (not only the live GLB scene)', async ({ page }) => {
    const out = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(code); // model-declared colors, NO manual paint
      const obj = await pw.exportOBJData();
      const tmf = await pw.export3MFData();
      return {
        objMime: obj.mimeType as string,
        objFile: obj.filename as string,
        objColored: !!obj.base64 && obj.text === undefined,
        tmfBytes: (tmf.sizeBytes as number) ?? 0,
      };
    }, COLOR_MODEL);

    // With colors declared in code and no manual paint, OBJ must export the
    // colored bundle (.obj + .mtl ZIP) — the regression the export gate used to
    // miss was emitting a plain, uncolored .obj here.
    expect(out.objMime).toBe('application/zip');
    expect(out.objFile.endsWith('.zip')).toBe(true);
    expect(out.objColored).toBe(true);
    // 3MF shares the same gate and is always a ZIP — assert it built.
    expect(out.tmfBytes).toBeGreaterThan(0);
  });
});
