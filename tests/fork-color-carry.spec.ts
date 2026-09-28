// Integration tests for the AI-session-feedback improvements:
//  - forkVersion re-applies the parent version's color regions to the
//    forked geometry (no repainting after a geometry tweak)
//  - forkVersion returns a codeDiff so a no-op transform is visible
//  - copyColorsFromVersion transfers a prior version's colors onto the
//    current mesh and reports which regions dropped

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

const LABELLED_CUBE = `
  const { Manifold } = api;
  const size = 20;
  return api.label(Manifold.cube([size, size, size], true), 'body');
`;

// Every test opens its own fresh session (createSession) before touching
// paint/version state. createSession() only resets session/version
// bookkeeping though — it does NOT clear the live paint-region store (only an
// explicit loadVersion/rehydrate does that) — so each test also calls
// clearColors() up front to guarantee it starts from zero regions regardless
// of what a sibling test left painted. The file shares one booted editor
// instead of paying a fresh page + WASM boot per test.
let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('forkVersion color carry-over + codeDiff', () => {
  test('carries the parent version colors onto the forked geometry', async () => {
    const result = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('fork-carry-colors');
      pw.clearColors();
      const v1 = await pw.runAndSave(code, 'base');
      pw.paintByLabel({ label: 'body', color: [0.8, 0.2, 0.2] });
      const painted = await pw.saveVersion('painted');

      // Grow the cube — geometry changes, but the 'body' label re-resolves.
      const fork = await pw.forkVersion(
        { index: painted.index },
        (c: string) => c.replace('size = 20', 'size = 28'),
        'bigger',
      );
      return { fork, regionsAfter: pw.listRegions() };
    }, LABELLED_CUBE);

    expect(result.fork.error).toBeUndefined();
    expect(result.fork.version).not.toBeNull();
    // Colors carried onto the new geometry, none dropped.
    expect(result.fork.colors.carried).toContain('body');
    expect(result.fork.colors.dropped).toEqual([]);
    // The carried region resolved to real triangles on the forked mesh.
    expect(result.regionsAfter).toHaveLength(1);
    expect(result.regionsAfter[0].triangles).toBeGreaterThan(0);
    // codeDiff reflects the one-line change.
    expect(result.fork.codeDiff.changed).toBe(true);
    expect(result.fork.codeDiff.added).toBeGreaterThan(0);
    expect(result.fork.codeDiff.removed).toBeGreaterThan(0);
  });

  test('carryColors:false produces an uncolored fork', async () => {
    const result = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('fork-no-carry');
      pw.clearColors();
      const v1 = await pw.runAndSave(code, 'base');
      pw.paintByLabel({ label: 'body', color: [0.2, 0.2, 0.8] });
      const painted = await pw.saveVersion('painted');

      const fork = await pw.forkVersion(
        { index: painted.index },
        (c: string) => c.replace('size = 20', 'size = 28'),
        'uncolored',
        undefined,
        false,
      );
      return { fork, regionsAfter: pw.listRegions() };
    }, LABELLED_CUBE);

    expect(result.fork.error).toBeUndefined();
    expect(result.fork.colors).toBeUndefined();
    expect(result.regionsAfter).toHaveLength(0);
  });

  test('codeDiff reports changed:false for a no-op transform', async () => {
    const fork = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('fork-noop-diff');
      pw.clearColors();
      const v1 = await pw.runAndSave(code, 'base');
      return pw.forkVersion({ index: v1.version.index }, (c: string) => c, 'noop');
    }, LABELLED_CUBE);

    expect(fork.codeDiff.changed).toBe(false);
    expect(fork.codeDiff.diff).toBeNull();
  });

  test('forked colors persist to the saved version and survive a reload', async () => {
    const result = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('fork-persist-reload');
      pw.clearColors();
      const v1 = await pw.runAndSave(code, 'base');
      pw.paintByLabel({ label: 'body', color: [0.8, 0.2, 0.2] });
      const painted = await pw.saveVersion('painted');
      const fork = await pw.forkVersion(
        { index: painted.index },
        (c: string) => c.replace('size = 20', 'size = 28'),
        'bigger',
      );
      // Navigate away, then reload the fork from storage — proves the colors
      // were written to the saved geometryData blob, not just left in memory.
      await pw.loadVersion({ index: v1.version.index });
      await pw.loadVersion({ index: fork.version.index });
      return { regionsAfterReload: pw.listRegions() };
    }, LABELLED_CUBE);

    expect(result.regionsAfterReload).toHaveLength(1);
    expect(result.regionsAfterReload[0].triangles).toBeGreaterThan(0);
  });
});

test.describe('modifyAndTest return', () => {
  test('returns modifiedCode and a codeDiff that flags a real change', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('modify-and-test-return');
      pw.clearColors();
      await pw.runAndSave('const { Manifold } = api; const h = 10; return Manifold.cube([5, 5, h], true);', 'base');
      return pw.modifyAndTest((c: string) => c.replace('h = 10', 'h = 20'));
    });

    expect(r.error).toBeUndefined();
    expect(typeof r.modifiedCode).toBe('string');
    expect(r.modifiedCode).toContain('h = 20');
    expect(r.codeDiff.changed).toBe(true);
    expect(r.codeDiff.added).toBeGreaterThan(0);
    expect(r.stats).toBeTruthy();
  });

  test('codeDiff.changed is false when the transform matches nothing', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('modify-and-test-noop');
      pw.clearColors();
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([5, 5, 10], true);', 'base');
      // A console transformFn that matches nothing returns the code unchanged;
      // codeDiff is what makes that visible (the stats would look "fine").
      return pw.modifyAndTest((c: string) => c.replace('DOES_NOT_EXIST', 'x'));
    });

    expect(r.codeDiff.changed).toBe(false);
    expect(typeof r.modifiedCode).toBe('string');
  });
});

test.describe('copyColorsFromVersion', () => {
  test('transfers colors when the descriptor still resolves, reports drops when it does not', async () => {
    const result = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('copy-colors');
      pw.clearColors();
      const v1 = await pw.runAndSave(code, 'base');
      pw.paintByLabel({ label: 'body', color: [0.3, 0.7, 0.3] });
      const painted = await pw.saveVersion('painted');

      // Rebuild with a DIFFERENT label — 'body' no longer exists, so the
      // copied region should drop.
      await pw.runAndSave(
        'const { Manifold } = api; return api.label(Manifold.cube([15,15,15], true), "shell");',
        'shell-only',
      );
      const missing = await pw.copyColorsFromVersion({ index: painted.index });

      // Rebuild WITH the 'body' label — now the copy should resolve.
      await pw.runAndSave(code, 'body-again');
      const hit = await pw.copyColorsFromVersion({ index: painted.index });

      return { missing, hit, regionsAfter: pw.listRegions() };
    }, LABELLED_CUBE);

    expect(result.missing.error).toBeUndefined();
    expect(result.missing.carried).toEqual([]);
    expect(result.missing.dropped).toContain('body');

    expect(result.hit.error).toBeUndefined();
    expect(result.hit.carried).toContain('body');
    expect(result.hit.dropped).toEqual([]);
    expect(result.regionsAfter).toHaveLength(1);
    expect(result.regionsAfter[0].triangles).toBeGreaterThan(0);
  });

  test('errors clearly when the source version has no colors', async () => {
    const res = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('copy-colors-empty');
      pw.clearColors();
      const v1 = await pw.runAndSave(code, 'no-colors');
      return pw.copyColorsFromVersion({ index: v1.version.index });
    }, LABELLED_CUBE);

    expect(res.error).toMatch(/no color regions/);
  });
});
