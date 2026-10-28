// api.headform: the metric head proxy builds in the editor at the stated size,
// its landmarks come back as data, bad options are refused, and the mask
// recipe from /ai/headform.md runs and doesn't touch the face.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

type R = { status?: string; error?: string; logs?: string[]; geometry?: unknown };
const run = (code: string) => page.evaluate(async (c) => {
  const pw = (window as unknown as { partwright: { run: (code: string) => Promise<R>; getGeometryData: () => Record<string, unknown> } }).partwright;
  const result = await pw.run(c);
  return { result, data: pw.getGeometryData() };
}, code);

test.describe('headform', () => {
  test('builds a metric head with landmarks and validates its options', async () => {
    test.setTimeout(120_000);
    await page.evaluate(() => (window as unknown as { partwright: { createSession: (n: string) => Promise<unknown> } }).partwright.createSession('headform'));

    const big = await run([
      "const lm = api.headform.landmarks({ size: 'L', neck: false });",
      'console.log(JSON.stringify(lm));',
      "return api.headform({ size: 'L', neck: false });",
    ].join('\n'));
    const data = big.data as { isManifold: boolean; componentCount: number; boundingBox: { x: number[]; y: number[]; z: number[] } };
    expect(data.isManifold).toBe(true);
    expect(data.componentCount).toBe(1);
    const lm = JSON.parse(big.result.logs![0]) as { units: string; measurements: Record<string, number>; points: Record<string, number[]> };
    expect(lm.units).toBe('mm');
    expect(lm.measurements.vertexHeight).toBeCloseTo(129 * 1.05, 0);
    // Top of the head at the vertex, front at the nose tip.
    expect(data.boundingBox.z[1]).toBeCloseTo(lm.points.vertex[2], -0.5);
    expect(data.boundingBox.y[0]).toBeCloseTo(lm.points.pronasale[1], -0.5);
    // Wearer's left is +X; the face is toward −Y.
    expect(lm.points.pupilL[0]).toBeGreaterThan(0);
    expect(lm.points.pupilL[1]).toBeLessThan(-60);

    const bad = await run("return api.headform({ size: 'XXL' });");
    expect(bad.result.status).toBe('error');
    expect(bad.result.error).toMatch(/headform\(opts\)\.size/);
  });

  test('the mask recipe from the docs runs and clears the face', async () => {
    test.setTimeout(180_000);
    const out = await run([
      'const { Manifold } = api;',
      'const head = api.headform({ neck: false });',
      'const lm = api.headform.landmarks({ neck: false });',
      'const skin = api.offset(head, { distance: 2, resolution: 320 });',
      "let mask = api.shell(skin, { thickness: 2.5, side: 'outside' });",
      'mask = mask.subtract(Manifold.cube([400, 400, 400], true).translate([0, 200 - 30, 0]));',
      'for (const p of [lm.points.pupilL, lm.points.pupilR]) {',
      '  mask = mask.subtract(Manifold.cylinder(80, 16, 16, 48, true).rotate([90, 0, 0]).translate(p));',
      '}',
      'console.log(api.intersects(mask, head));',
      'return mask;',
    ].join('\n'));
    expect(out.result.status, out.result.error).not.toBe('error');
    expect(out.result.logs).toEqual(['false']);
    expect((out.data as { isManifold: boolean }).isManifold).toBe(true);
  });
});
