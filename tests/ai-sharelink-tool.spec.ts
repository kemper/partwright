// The in-app chat assistant must NOT be able to mint a share link. The encoded
// share URL is enormous, so returning it as a tool result would dump the whole
// design into the model's context on every turn that follows — pure token waste,
// since the in-app user can just click the toolbar Share button (↗). getShareLink
// is therefore kept OFF the chat tool surface: no tool definition, not in
// ALWAYS_AVAILABLE, and no dispatch case (so executeTool rejects it as unknown).
//
// The capability still exists for EXTERNAL agents — which have no toolbar to
// click — via the window.partwright.getShareLink() console API. That path's full
// encode round-trip is covered in share-link.spec.ts (T1b); here we just confirm
// the console method is still wired so the two surfaces don't drift.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('getShareLink is not an in-app chat tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('never listed as a chat tool and rejected by dispatch, but still on the console API', async ({ page }) => {
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
        autoResume: true,
        provider: 'anthropic',
        anthropicModel: 'claude-haiku-4-5',
        localModel: null,
        openaiModel: 'gpt-5-mini',
        geminiModel: 'gemini-flash-latest',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const listFor = (t: any) => tools.buildToolList(t).map((d) => d.name);
      // No toggle combination surfaces it: it isn't a tool. Check full scope and
      // every scope/vision toggle paused (auto-continue off, so even the `finish`
      // tool isn't in play).
      const listedFullScope = listFor(baseToggles).includes('getShareLink');
      const listedAllOff = listFor({
        ...baseToggles,
        scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false },
        vision: { ...baseToggles.vision, views: false },
        autoResume: false,
      }).includes('getShareLink');

      // The dispatch case was removed, so reaching the tool by name falls through
      // to the "Unknown tool" branch — the agent can't tunnel to the console API
      // through the tool layer.
      const exec = await tools.executeTool('getShareLink', {});

      // The capability is preserved for external/console agents.
      const onConsoleApi = typeof (window as unknown as {
        partwright: { getShareLink?: unknown };
      }).partwright.getShareLink === 'function';

      return { listedFullScope, listedAllOff, exec, onConsoleApi };
    });

    expect(result.listedFullScope).toBe(false);
    expect(result.listedAllOff).toBe(false);
    expect(result.exec.isError).toBe(true);
    expect(result.exec.content).toContain('Unknown tool');
    // Still available to external agents (full round-trip covered in share-link.spec.ts T1b).
    expect(result.onConsoleApi).toBe(true);
  });
});
