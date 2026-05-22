// Regression: the in-app chat agent could call `saveVersion` (it's a
// window.partwright console method documented in ai.md right next to
// runAndSave), but it was never registered as a chat tool — so the call
// fell through to dispatch()'s default branch and came back as
// "Unknown tool: saveVersion". This covers both that the tool is now
// listed (gated under the saveVersions scope) and that it dispatches to
// the console API end to end.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('saveVersion chat tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('is listed under the saveVersions scope and dispatches to the console API', async ({ page }) => {
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
      const withSave = listFor(baseToggles).includes('saveVersion');
      const withoutSave = listFor({ ...baseToggles, scope: { ...baseToggles.scope, saveVersions: false } }).includes('saveVersion');

      // End-to-end dispatch: a base version, then a divergent edit that
      // saveVersion should snapshot as a fresh version (not a dedup skip).
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
        setCode: (code: string) => unknown;
        run: (code?: string) => Promise<unknown>;
      } }).partwright;
      await pw.createSession('saveversion-tool-test');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'base');
      const changed = 'const { Manifold } = api; return Manifold.cube([14, 14, 14], true);';
      pw.setCode(changed);
      await pw.run(changed);

      const exec = await tools.executeTool('saveVersion', { label: 'snap' });
      return { withSave, withoutSave, exec };
    });

    // Listed when commits are allowed, removed when the user pauses them.
    expect(result.withSave).toBe(true);
    expect(result.withoutSave).toBe(false);

    // The call dispatched to window.partwright instead of throwing the
    // old "Unknown tool" error, and persisted a real version.
    expect(result.exec.isError).toBe(false);
    expect(result.exec.content).not.toContain('Unknown tool');
    const saved = JSON.parse(result.exec.content) as { index?: number; label?: string };
    expect(saved.index).toBe(2);
    expect(saved.label).toBe('snap');
  });
});
