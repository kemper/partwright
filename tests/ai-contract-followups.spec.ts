// Medium/low fixes from the #1134 sweep that need a real browser: cosine and
// count validation, paintPreview topOnly parity, 0-based piece indices,
// digit-string region ids, the includeChat export option, the Worker-side
// v.sdf budget, importSession loading paint, parametric transforms keeping
// their Customizer values, and the bake warning on an explicit bake.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('AI contract follow-ups (#1134)', () => {
  test('findFaces rejects a degree value as normalTolerance; assertPaint rejects a string count', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      const faces = pw.findFaces({ normal: [0, 0, 1], normalTolerance: 15 });
      pw.paintInBox({ box: { min: [-11, -11, 9], max: [11, 11, 11] }, color: [1, 0, 0], name: 'top' });
      const assertStr = pw.assertPaint({ region: 'top', expectedTriangleCount: '50' });
      const assertOk = pw.assertPaint({ region: 'top', expectedTriangleCount: 2 });
      return { faces, assertStr, assertOk };
    });
    expect(r.faces.error).toContain('cosine');
    expect(r.assertStr.passed).toBe(false);
    expect(r.assertOk.passed).toBe(true);
  });

  test('paintPreview honours topOnly for box and point selectors', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      const box = { min: [-11, -11, -11], max: [11, 11, 11] };
      return {
        boxAll: pw.paintPreview({ box }).triangleCount,
        boxTop: pw.paintPreview({ box, topOnly: true }).triangleCount,
        nearTop: pw.paintPreview({ point: [0, 0, 0], radius: 30, topOnly: true }).triangleCount,
      };
    });
    expect(r.boxAll).toBe(12);
    expect(r.boxTop).toBe(2);
    expect(r.nearTop).toBe(2);
  });

  test('getObjectPartInfo reports 0-based piece indices; a digit-string region id resolves', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run(`const { Manifold } = api;
const a = api.label(Manifold.cube([5, 5, 5]), 'a');
const b = api.label(Manifold.cube([5, 5, 5]).translate([20, 0, 0]), 'b');
return a.add(b);`);
      const parts = pw.listObjectParts();
      const bPiece = parts.pieces.find((p: { part?: string }) => p.part === 'b').index;
      const info = pw.getObjectPartInfo('b');
      const region = pw.paintInBox({ box: { min: [-1, -1, -1], max: [6, 6, 6] }, color: [0, 1, 0], name: 'cubeA' });
      const explain = pw.paintExplain({ region: String(region.id), withImage: false });
      return { bPiece, pieces: info.pieces, explainErr: explain.error ?? null };
    });
    expect(r.pieces).toEqual([r.bPiece]);
    expect(r.explainErr).toBeNull();
  });

  test('exportSession takes includeChat', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('export-chat');
      await pw.runAndSave('return api.Manifold.cube([3, 3, 3]);', 'v1');
      const out = await pw.exportSession(undefined, { includeChat: false });
      return { error: out?.error ?? null, hasChat: !!out && 'chat' in out };
    });
    expect(r.error).toBeNull();
    expect(r.hasChat).toBe(false);
  });

  test('the v.sdf sampling budget from settings reaches the engine Worker', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const original = pw.getAppConfig?.()?.import?.voxelSdfMaxSamples ?? 8_000_000;
      pw.setAppConfig('import', 'voxelSdfMaxSamples', 100_000);
      try {
        await pw.setActiveLanguage('voxel');
        await pw.run(`const v = api.voxels();
const S = api.sdf;
v.sdf(S.sphere(30), { res: 1 });
return v;`);
        return pw.getGeometryData();
      } finally {
        pw.setAppConfig('import', 'voxelSdfMaxSamples', original);
        await pw.setActiveLanguage('manifold-js');
      }
    });
    expect(String(r.error ?? '')).toContain('100,000');
  });

  test("importSession loads the imported session's paint, not just its code", async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('import-src');
      pw.clearColors();
      await pw.runAndSave('return api.Manifold.cube([10, 10, 10]);', 'v1');
      pw.paintInBox({ box: { min: [-1, -1, 9], max: [11, 11, 11] }, color: [1, 0, 0], name: 'lid' });
      await pw.saveVersion('painted');
      const data = await pw.exportSession();
      await pw.createSession('other');
      pw.clearColors();
      await pw.runAndSave('return api.Manifold.sphere(5, 24);', 'o1');
      const res = await pw.importSession(data);
      return { error: res.error ?? null, regions: pw.listRegions().map((x: { name: string }) => x.name) };
    });
    expect(r.error).toBeNull();
    expect(r.regions).toEqual(['lid']);
  });

  test('a parametric transform saves the live Customizer values with the new version', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('param-transform');
      pw.clearColors();
      await pw.runAndSave(`const p = api.params({ width: { type: 'number', default: 20, min: 5, max: 60 } });
return api.Manifold.cube([p.width, 10, 10]).translate([0, 0, 5]);`, 'v1');
      await pw.setParams({ width: 40 });
      const placed = await pw.placeModel({ dropToFloor: true, mode: 'parametric' });
      const sm = await import('/src/storage/sessionManager.ts');
      return { placed: placed.error ?? placed.mode, params: sm.getState().currentVersion?.paramValues ?? null };
    });
    expect(r.placed).toBe('parametric');
    expect(r.params).toEqual({ width: 40 });
  });

  test('an explicit bake of a SCAD model warns that the SCAD source is gone', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('scad-bake');
      await pw.setActiveLanguage('scad');
      await pw.runAndSave('cube([10, 10, 10]);', 's1');
      const out = await pw.scaleModel(2, 2, 2, { mode: 'bake' });
      await pw.setActiveLanguage('manifold-js');
      return { error: out.error ?? null, warnings: out.warnings ?? [] };
    });
    expect(r.error).toBeNull();
    expect(r.warnings.join(' ')).toContain('OpenSCAD model was baked');
  });
});
