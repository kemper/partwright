// Regression tests for the second-round paint workflow improvements:
//  - paintByLabels batches N paint calls into one tool round-trip
//  - loadVersion reports labelsAvailable / labelCount
//  - runIsolated accepts a view spec for single-angle thumbnails
//  - manifold-js engine rejects user code that calls partwright.* with
//    a structured, instructive error instead of a generic ReferenceError

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

// Every test runs its own fresh geometry via pw.run()/pw.createSession() and
// only ever inspects the value it just got back — nothing depends on paint
// state a sibling left behind — so the file shares one booted editor instead
// of paying a fresh page + WASM boot per test. A defensive clearColors()
// keeps each test's region-bearing run starting from a clean paint slate.
let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('paint batch + lifecycle', () => {
  test('paintByLabels paints multiple features in one call', async () => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run(`
        const { Manifold } = api;
        const head = api.label(Manifold.sphere(10, 32), 'head');
        const eyeL = api.label(Manifold.sphere(2, 16).translate([-3, 8, 5]), 'eyeL');
        const eyeR = api.label(Manifold.sphere(2, 16).translate([ 3, 8, 5]), 'eyeR');
        return head.add(eyeL).add(eyeR);
      `);
      return pw.paintByLabels([
        { label: 'head', color: [0.4, 0.7, 0.4] },
        { label: 'eyeL', color: [0, 0, 0] },
        { label: 'eyeR', color: [0, 0, 0] },
      ]);
    });
    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(3);
    expect(result.failed).toEqual([]);
    for (const r of result.results) {
      expect(r.triangles).toBeGreaterThan(0);
      expect(typeof r.id).toBe('number');
    }
  });

  test('paintByLabels reports per-label failures without aborting the batch', async () => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run(`
        const { Manifold } = api;
        return api.label(Manifold.cube([10, 10, 10]), 'box');
      `);
      return pw.paintByLabels([
        { label: 'box', color: [1, 0, 0] },
        { label: 'nonexistent', color: [0, 1, 0] },
      ]);
    });
    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].label).toBe('nonexistent');
    expect(result.failed[0].error).toMatch(/no label/);
  });

  test('loadVersion reports labelsAvailable for labelled and unlabelled versions', async () => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('test-labels-lifecycle');
      const v1 = await pw.runAndSave('return api.Manifold.cube([5, 5, 5]);', 'unlabelled');
      const v2 = await pw.runAndSave(
        'return api.label(api.Manifold.cube([5, 5, 5]), "box");',
        'labelled',
      );
      const loadedUnlabelled = await pw.loadVersion({ index: v1.version.index });
      const loadedLabelled = await pw.loadVersion({ index: v2.version.index });
      return { loadedUnlabelled, loadedLabelled };
    });
    expect(result.loadedUnlabelled.error).toBeUndefined();
    expect(result.loadedUnlabelled.labelsAvailable).toBe(false);
    expect(result.loadedUnlabelled.labelCount).toBe(0);
    expect(result.loadedLabelled.error).toBeUndefined();
    expect(result.loadedLabelled.labelsAvailable).toBe(true);
    expect(result.loadedLabelled.labelCount).toBeGreaterThan(0);
  });

  test('runIsolated with view: top-down renders the top face clearly', async () => {
    const { topThumb, isoThumb } = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // A short, wide cube — top face is the dominant visible surface
      // from above. From the default iso angle the top is foreshortened.
      const code = 'return api.Manifold.cube([20, 20, 2], true);';
      const top = await pw.runIsolated(code, { elevation: 90, azimuth: 0, ortho: true, size: 200 });
      const iso = await pw.runIsolated(code);
      return { topThumb: top.thumbnail, isoThumb: iso.thumbnail };
    });
    // Both should produce thumbnails; they should differ (different
    // angles → different pixel data). The top-down one is the cheap
    // verification the agent feedback asked for.
    expect(typeof topThumb).toBe('string');
    expect(typeof isoThumb).toBe('string');
    expect(topThumb).not.toBe(isoThumb);
    expect(topThumb.startsWith('data:image/png;base64,')).toBe(true);
  });

  test('runCode rejects code that calls partwright.* with an instructive error', async () => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const r = await pw.runIsolated(`
        const cube = api.Manifold.cube([1, 1, 1]);
        partwright.paintByLabel({ label: 'x', color: [1, 0, 0] });
        return cube;
      `);
      return r;
    });
    // runIsolated returns geometryData with status: 'error' on failure
    expect(result.geometryData.status).toBe('error');
    expect(result.geometryData.error).toContain('paint tools');
    expect(result.geometryData.error).toMatch(/separate tool calls|paintByLabels/);
  });
});
