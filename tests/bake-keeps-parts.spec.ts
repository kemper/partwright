// Baking a model to a mesh (surface textures, scale / rotate / place in bake
// mode) used to drop its parts: the api.label calls lived in the code the
// bake replaced. The parts now ride the baked import and come back as labels
// through api.importWithParts (#1025).

import { test, expect } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';
import type { Page } from 'playwright/test';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('bakes keep parts', () => {
  test('scale (bake) and a baked surface texture keep api.label parts', async () => {
    test.setTimeout(120_000);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label: string) => Promise<unknown>;
        scaleModel: (x: number, y: number, z: number, o?: unknown) => Promise<Record<string, unknown>>;
        applyFuzzySkin: (o?: unknown) => Promise<Record<string, unknown>>;
        getCode: () => string;
        listObjectParts: () => { parts?: { name: string; triangleCount: number; color?: string | null }[] };
      } }).partwright;
      await pw.createSession('bake-keeps-parts');
      await pw.runAndSave([
        'const { Manifold } = api;',
        "const body = api.label(Manifold.cube([20, 20, 20], true), 'body', { color: [0.35, 0.55, 0.85] });",
        "const knob = api.label(Manifold.sphere(6, 32).translate([0, 0, 12]), 'knob', { color: [0.95, 0.6, 0.3] });",
        'return body.add(knob);',
      ].join('\n'), 'labelled');
      const parts = () => Object.fromEntries((pw.listObjectParts().parts ?? []).map(p => [p.name, p.triangleCount]));
      const scaled = await pw.scaleModel(1.5, 1.5, 1.5, { mode: 'bake' });
      const afterScale = { parts: parts(), code: pw.getCode(), carried: scaled.partsCarried, error: scaled.error ?? null };
      const fuzzy = await pw.applyFuzzySkin({ amplitude: 0.3 });
      const afterFuzzy = { parts: parts(), code: pw.getCode(), carried: fuzzy.partsCarried, error: fuzzy.error ?? null };
      const colors = Object.fromEntries((pw.listObjectParts().parts ?? []).map(p => [p.name, p.color]));
      return { afterScale, afterFuzzy, colors };
    });

    for (const step of [out.afterScale, out.afterFuzzy]) {
      expect(step.error).toBeNull();
      expect(step.code).toContain('api.importWithParts(0)');
      expect(step.parts.body).toBeGreaterThan(0);
      expect(step.parts.knob).toBeGreaterThan(0);
    }
    expect(out.afterScale.carried).toEqual(['body', 'knob']);
    // Each part keeps its own code colour.
    expect(out.colors).toEqual({ body: '#598cd9', knob: '#f2994d' });
  });
});
