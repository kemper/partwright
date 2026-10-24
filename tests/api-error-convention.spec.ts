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

  test('the #1085 follow-up conversions return {error} on bad input instead of throwing', async () => {
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const call = async (fn: () => unknown) => {
        try { return { value: await fn() }; } catch (e) { return { threw: String(e) }; }
      };
      const created = await pw.createSession('api-error-convention-followups');
      await pw.run('return api.Manifold.cube([10, 10, 10], true);');
      const bad: Record<string, unknown> = {
        run: await call(() => pw.run(42)),
        saveVersion: await call(() => pw.saveVersion(7)),
        createSession: await call(() => pw.createSession(5)),
        renderView: await call(() => pw.renderView({ elevation: 'high' })),
        renderViews: await call(() => pw.renderViews({ views: 'sideways' })),
        renderSection: await call(() => pw.renderSection({ axis: 'w' })),
        probePixel: await call(() => pw.probePixel({ pixel: [1, 1], view: { size: -1 } })),
        pointInside: await call(() => pw.pointInside([0, 0])),
        healCurrent: await call(() => pw.healCurrent({ tolerance: -1 })),
        exportSTL: await call(() => pw.exportSTL(3)),
        exportGLB: await call(() => pw.exportGLB(3)),
        exportSTLData: await call(() => pw.exportSTLData(3)),
        export3MFData: await call(() => pw.export3MFData(3)),
        exportSessionData: await call(() => pw.exportSessionData(undefined, { includeSecrets: true })),
        exportSTLObjects: await call(() => pw.exportSTLObjects(undefined, 3)),
        exportOBJObjectsData: await call(() => pw.exportOBJObjectsData(undefined, 3)),
        exportGLBParts: await call(() => pw.exportGLBParts(undefined, 3)),
        export3MFObjects: await call(() => pw.export3MFObjects(undefined, 3)),
        export3MFObjectsData: await call(() => pw.export3MFObjectsData(undefined, 3)),
        exportTurntable: await call(() => pw.exportTurntable({ seconds: 999 })),
        publish: await call(() => pw.publish(9)),
        selectParts: await call(() => pw.selectParts('lid')),
        alignSelection: await call(() => pw.alignSelection('q', 'min')),
        rotateSelection: await call(() => pw.rotateSelection([1, 2])),
        addImage: await call(() => pw.addImage({ src: '' })),
        removeImage: await call(() => pw.removeImage('')),
        addAttachment: await call(() => pw.addAttachment({ src: '', kind: 'image' })),
        removeAttachment: await call(() => pw.removeAttachment('')),
        addTextAnnotation: await call(() => pw.addTextAnnotation({ anchor: [0, 0, 0], text: '' })),
        removeAnnotation: await call(() => pw.removeAnnotation(5)),
        restoreAnnotationView: await call(() => pw.restoreAnnotationView(5)),
        listCatalog: await call(() => pw.listCatalog({ limit: 0 })),
      };
      const ok = {
        pointInside: await call(() => pw.pointInside([0, 0, 0])),
        renderSection: await call(() => pw.renderSection({ axis: 'x' })),
        catalog: await call(() => pw.listCatalog({ limit: 2 })),
      };
      await pw.deleteSession(created.id);
      return { bad, ok };
    });
    for (const [key, r] of Object.entries(out.bad) as Array<[string, { value?: { error?: unknown }; threw?: string }]>) {
      expect(r.threw, `${key} threw`).toBeUndefined();
      expect(typeof r.value?.error, `${key} -> {error}`).toBe('string');
    }
    expect((out.ok.pointInside as { value: unknown }).value).toBe(true);
    expect((out.ok.renderSection as { value: { contours: number } }).value.contours).toBe(1);
    expect((out.ok.catalog as { value: { count: number } }).value.count).toBe(2);
  });
});
