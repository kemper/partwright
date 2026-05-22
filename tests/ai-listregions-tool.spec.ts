// Regression: the in-app chat agent was repeatedly told to "get the id from
// listRegions()" — removeRegion, assertPaint and paintExplain tool schemas
// plus the system prompt all reference it — but `listRegions` was never
// registered as a chat tool. The call fell through dispatch()'s default
// branch and came back as "Unknown tool: listRegions", leaving the agent
// with no way to discover region ids. This covers that the tool is now
// listed (always-available, even when painting is paused — its consumers
// paintExplain/assertPaint are always-available too) and that it dispatches
// to the console API end to end.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('listRegions chat tool', () => {
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
      const listedDefault = listFor(baseToggles).includes('listRegions');
      // Still listed when painting is paused — it's a read, and the always-on
      // consumers paintExplain/assertPaint need a region id to target.
      const listedWithPaintOff = listFor({ ...baseToggles, scope: { ...baseToggles.scope, paintFaces: false } }).includes('listRegions');

      // End-to-end dispatch: build geometry, paint one region by explicit
      // triangle id (deterministic regardless of mesh resolution), then list.
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
        paintFaces: (input: { triangleIds: number[]; color: number[]; name?: string }) => unknown;
      } }).partwright;
      await pw.createSession('listregions-tool-test');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'base');
      pw.paintFaces({ triangleIds: [0], color: [1, 0, 0], name: 't0' });

      const exec = await tools.executeTool('listRegions', {});
      return { listedDefault, listedWithPaintOff, exec };
    });

    // Always available — present with full scope and with painting paused.
    expect(result.listedDefault).toBe(true);
    expect(result.listedWithPaintOff).toBe(true);

    // The call dispatched to window.partwright instead of throwing the old
    // "Unknown tool" error, and returned the painted region with its id.
    expect(result.exec.isError).toBe(false);
    expect(result.exec.content).not.toContain('Unknown tool');
    const regions = JSON.parse(result.exec.content) as Array<{ id?: number; name?: string }>;
    expect(Array.isArray(regions)).toBe(true);
    expect(regions.length).toBe(1);
    expect(typeof regions[0].id).toBe('number');
    expect(regions[0].name).toBe('t0');
  });
});
