// Contract test for the window.partwright argument-validation convention
// (public/ai.md#argument-validation): value-returning methods report bad input
// as `{ error }` rather than throwing, so console / MCP / AI callers can branch
// on `result?.error`. Locks in the methods converted from bare asserts for
// issue #683 and the exceptions' replacement shapes (renameSession /
// deleteSession success = `{ success: true }`, exportSTEP = `{ ok: false, error }`).

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

test.describe('API {error} convention', () => {
  test('value-returning methods return {error} on bad input instead of throwing', async () => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const call = async (fn: () => unknown) => {
        try { return { value: await fn() }; } catch (e) { return { threw: String(e) }; }
      };
      const created = await pw.createSession('api-error-convention-spec');
      await pw.run('return api.Manifold.cube([10, 10, 10], true);');
      const r = {
        measureAt: await call(() => pw.measureAt([5])),
        measurePoints: await call(() => pw.measurePoints([0, 0], [1, 1, 1])),
        probeRay: await call(() => pw.probeRay([0, 0, 0], [0, '1', 0])),
        sliceAtZVisual: await call(() => pw.sliceAtZVisual('x')),
        exportSTEP: await call(() => pw.exportSTEP(5)),
        renameEmpty: await call(() => pw.renameSession('')),
        deleteUnknown: await call(() => pw.deleteSession('nope')),
        renameOk: await call(() => pw.renameSession('api-error-convention-renamed')),
        renamedTo: pw.getSessionState().session?.name,
        distance: await call(() => pw.measurePoints([0, 0, 0], [3, 4, 0])),
        slice: await call(() => pw.sliceAtZVisual(0)),
        deleteOk: await call(() => pw.deleteSession(created.id)),
      };
      return r;
    });

    for (const key of ['measureAt', 'measurePoints', 'probeRay', 'sliceAtZVisual', 'renameEmpty', 'deleteUnknown'] as const) {
      const r = out[key] as { value?: { error?: unknown }; threw?: string };
      expect(r.threw, `${key} threw`).toBeUndefined();
      expect(typeof r.value?.error, `${key} -> {error}`).toBe('string');
    }
    const step = out.exportSTEP as { value?: { ok?: boolean; error?: unknown }; threw?: string };
    expect(step.threw).toBeUndefined();
    expect(step.value?.ok).toBe(false);
    expect(typeof step.value?.error).toBe('string');

    expect((out.renameOk as { value: unknown }).value).toEqual({ success: true });
    expect(out.renamedTo).toBe('api-error-convention-renamed');
    expect((out.distance as { value: unknown }).value).toBe(5);
    expect((out.slice as { value: { contours: number } }).value.contours).toBe(1);
    expect((out.deleteOk as { value: unknown }).value).toEqual({ success: true });
  });
});
