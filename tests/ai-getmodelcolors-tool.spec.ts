// Regression: ai.md and the colors/replicad subdocs all point the agent at
// `partwright.getModelColors()` to read the model-declared color underlay, but
// `getModelColors` was never registered as a chat tool. The call fell through
// dispatch()'s default branch and came back as "Unknown tool: getModelColors",
// leaving the in-app agent unable to inspect the colors its own labelled code
// produced. This covers that the tool is now listed (always-available — it's a
// pure read, sibling of listLabels/listRegions) and dispatches to the console
// API end to end.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('getModelColors chat tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('is always listed (even with paint paused) and dispatches to the console API', async ({ page }) => {
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
      const listedDefault = listFor(baseToggles).includes('getModelColors');
      // Still listed when painting is paused — it reads colors declared in code,
      // not manual paint, so it's a pure read like listLabels.
      const listedWithPaintOff = listFor({ ...baseToggles, scope: { ...baseToggles.scope, paintFaces: false } }).includes('getModelColors');

      // End-to-end dispatch: build geometry that declares a color via
      // api.label(shape, name, {color}), then read it back.
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
      } }).partwright;
      await pw.createSession('getmodelcolors-tool-test');
      await pw.runAndSave(
        "const { Manifold } = api; return api.label(Manifold.cube([10, 10, 10], true), 'body', { color: [1, 0, 0] });",
        'base',
      );

      const exec = await tools.executeTool('getModelColors', {});
      return { listedDefault, listedWithPaintOff, exec };
    });

    // Always available — present with full scope and with painting paused.
    expect(result.listedDefault).toBe(true);
    expect(result.listedWithPaintOff).toBe(true);

    // The call dispatched to window.partwright instead of throwing the old
    // "Unknown tool" error, and returned the declared color.
    expect(result.exec.isError).toBe(false);
    expect(result.exec.content).not.toContain('Unknown tool');
    const colors = JSON.parse(result.exec.content) as { count: number; colors: Array<{ name?: string }> };
    expect(colors.count).toBe(1);
    expect(colors.colors[0].name).toBe('body');
  });
});
