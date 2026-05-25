// Regression: the in-app chat agent is told to "use runAndExplain(code) to
// identify which pieces are floating" — public/ai.md documents it in the
// "Isolated execution" block right next to its registered siblings runIsolated,
// runAndAssert and modifyAndTest, and window.partwright.runAndExplain exists —
// but the tool was never registered as a chat tool. The call fell through
// dispatch()'s default branch and came back as "Unknown tool: runAndExplain",
// leaving the agent with no way to debug disconnected components. This covers
// that the tool is now listed (always-available, like its isolated-execution
// siblings) and that it dispatches to the console API end to end.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('runAndExplain chat tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('is always listed (even with runCode paused) and dispatches to the console API', async ({ page }) => {
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
      const listedDefault = listFor(baseToggles).includes('runAndExplain');
      // Still listed when the runCode scope is paused — it runs in isolation
      // (no editor/viewport mutation) just like its always-on siblings
      // runAndAssert and modifyAndTest.
      const listedWithRunOff = listFor({ ...baseToggles, scope: { ...baseToggles.scope, runCode: false } }).includes('runAndExplain');

      // End-to-end dispatch: a big cube unioned with a tiny far-away cube
      // produces two boolean-distinct components, so runAndExplain returns a
      // component breakdown and floater hints.
      const code = 'const { Manifold } = api; return Manifold.union([Manifold.cube([20, 20, 20], true), Manifold.cube([2, 2, 2], true).translate([50, 0, 0])]);';
      const exec = await tools.executeTool('runAndExplain', { code });
      return { listedDefault, listedWithRunOff, exec };
    });

    // Always available — present with full scope and with runCode paused.
    expect(result.listedDefault).toBe(true);
    expect(result.listedWithRunOff).toBe(true);

    // The call dispatched to window.partwright instead of throwing the old
    // "Unknown tool" error, and returned the component breakdown + hints.
    expect(result.exec.isError).toBe(false);
    expect(result.exec.content).not.toContain('Unknown tool');
    const parsed = JSON.parse(result.exec.content) as {
      stats?: { componentCount?: number };
      components?: Array<{ index: number; volume: number }> | null;
      hints?: string[];
    };
    expect(parsed.stats?.componentCount).toBe(2);
    expect(Array.isArray(parsed.components)).toBe(true);
    expect(parsed.components!.length).toBe(2);
    expect(Array.isArray(parsed.hints)).toBe(true);
    expect(parsed.hints!.join(' ')).toContain('disconnected');
  });
});
