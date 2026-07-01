// Regression: plan mode used to hand the model an empty tool list, so the
// planning phase couldn't ground itself in the actual session state — the
// model would confidently plan against handoff notes and get things wrong.
// This test locks in the fix: plan mode exposes the pure-read subset
// (getCode, getSessionContext, listVersions, geometry queries, renderView*
// under the vision toggle, …) and still hides mutating and code-execution
// tools until the user approves.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('plan-mode tool list', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('exposes read-only tools and hides mutating / executing ones', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const result = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const baseToggles = {
        vision: { views: true, resolution: 'medium', angles: 'auto' },
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
        autoRetry: 0,
        maxIterations: 'medium',
        maxSpend: 'high',
        thinking: 'off',
        provider: 'anthropic',
        anthropicModel: 'claude-haiku-4-5',
        localModel: null,
        openaiModel: 'gpt-5-mini',
        geminiModel: 'gemini-flash-latest',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listFor = (t: any) => tools.buildToolList(t).map((d) => d.name);

      const planOn = listFor({ ...baseToggles, planFirst: true });
      const planOnVisionOff = listFor({
        ...baseToggles,
        planFirst: true,
        vision: { ...baseToggles.vision, views: false },
      });
      const planOff = listFor({ ...baseToggles, planFirst: false });

      return { planOn, planOnVisionOff, planOff };
    });

    // Grounding reads are exposed during planning.
    expect(result.planOn).toEqual(expect.arrayContaining([
      'getCode', 'getSessionContext', 'listVersions', 'getGeometryData',
      'getMeshSummary', 'listComponents', 'listLabels', 'listRegions',
      'listSessionNotes', 'readDoc', 'checkPrintability', 'listParts',
    ]));

    // Renders ride along when the Views toggle is on…
    expect(result.planOn).toEqual(expect.arrayContaining(['renderView', 'renderViews']));
    // …and drop out when it's off, so vision cost stays under the user's control.
    expect(result.planOnVisionOff).not.toEqual(expect.arrayContaining(['renderView', 'renderViews']));

    // Mutations and code execution stay hidden until approval.
    for (const forbidden of [
      'setCode', 'setActiveLanguage', 'modifyAndTest', 'forkVersion',
      'createPart', 'deletePart', 'saveVersion', 'runAndSave', 'runCode',
      'runAndAssert', 'runAndExplain', 'runIsolated', 'importImageAsRelief',
      'importSvgAsRelief', 'setPrinterSettings', 'setReliefPreviewMode',
      'paintRegion', 'paintFaces', 'paintInBox', 'undoLastPaint',
      'addSessionNote',
    ]) {
      expect(result.planOn).not.toContain(forbidden);
    }

    // With plan mode off, the normal gate returns the full scoped list —
    // includes things plan mode never would.
    expect(result.planOff).toEqual(expect.arrayContaining([
      'runCode', 'runAndSave', 'setCode', 'saveVersion',
    ]));
  });
});
