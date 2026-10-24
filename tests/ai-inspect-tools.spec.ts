// End-to-end dispatch of the chat tools that wrap existing window.partwright
// methods (#1085): diffVersions, renameVersion, listAnnotations, setUnits /
// getUnits and the extended `query` keys, all driven through the real
// executeTool path against a live session — the same path the in-app AI uses.
// The pure gating/dispatch logic is covered in tests/unit/aiToolGating.test.ts;
// this spec proves the wrappers line up with the real console API signatures.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('AI inspection + version tools', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('diffVersions, renameVersion, listAnnotations, units and query extensions dispatch end to end', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const out = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => Promise<unknown> | unknown> }).partwright;
      const call = async (name: string, input: Record<string, unknown> = {}) => {
        const r = await tools.executeTool(name, input);
        return { isError: r.isError, data: (() => { try { return JSON.parse(r.content); } catch { return r.content; } })() };
      };

      await pw.createSession('ai-inspect-tools');
      await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([10, 10, 10], true);', 'small');
      await pw.runAndSave('const { Manifold } = api;\nreturn Manifold.cube([20, 10, 10], true);', 'wide');

      const diff = await call('diffVersions', { a: 1, b: 2 });
      const rename = await call('renameVersion', { index: 2, label: 'final' });
      const versions = await pw.listVersions() as Array<{ index: number; label: string }>;

      await pw.addTextAnnotation({ anchor: [0, 0, 5], text: 'round this corner' });
      const annotations = await call('listAnnotations');

      const setUnits = await call('setUnits', { unit: 'in' });
      const getUnits = await call('getUnits');

      const query = await call('query', { componentBounds: true, pointsInside: [[0, 0, 0], [50, 50, 50]], containment: true });

      return { diff, rename, versions, annotations, setUnits, getUnits, query };
    });

    expect(out.diff.isError).toBe(false);
    expect(out.diff.data.codeChanged).toBe(true);
    expect(out.diff.data.codeDiff.diff).toContain('+ return Manifold.cube([20, 10, 10], true);');
    expect(out.diff.data.statDiff).toBeTruthy();

    expect(out.rename.data).toMatchObject({ ok: true, index: 2, label: 'final' });
    expect(out.versions.find(v => v.index === 2)?.label).toBe('final');

    expect(out.annotations.data.count).toBe(1);
    expect(out.annotations.data.texts[0].text).toBe('round this corner');

    expect(out.setUnits.data).toEqual({ unit: 'in' });
    expect(out.getUnits.data).toEqual({ unit: 'in' });

    expect(out.query.isError).toBe(false);
    expect(out.query.data.componentBounds).toHaveLength(1);
    expect(out.query.data.componentBounds[0].bbox.size[0]).toBeCloseTo(20, 3);
    expect(out.query.data.pointsInside).toEqual([
      { point: [0, 0, 0], inside: true },
      { point: [50, 50, 50], inside: false },
    ]);
    expect(out.query.data.containment).toEqual([]);
  });
});
