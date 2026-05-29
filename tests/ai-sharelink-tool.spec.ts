// Regression: ai.md (the in-app chat system prompt) tells the agent to "hand
// the user a share link" via getShareLink() as the last step of every session
// — and to PREFER it over the session/gallery URLs — but getShareLink was only
// wired into the window.partwright console API, never registered as a chat
// tool. The call fell through dispatch()'s default branch and came back as
// "Unknown tool: getShareLink", so the agent could never deliver the link it
// was instructed to deliver. This covers that the tool is now listed
// (always-available, like the other read-only session surfaces) and that it
// dispatches to the console API end to end.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('getShareLink chat tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('is always listed (even with every toggle paused) and dispatches to the console API', async ({ page }) => {
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
      const listedDefault = listFor(baseToggles).includes('getShareLink');
      // The prompt steers EVERY session toward handing back a share link, so the
      // tool must survive with EVERY toggle paused — running, saving, painting,
      // notes, and vision all off. That's the whole point of ALWAYS_AVAILABLE:
      // no toggle can remove it (gating it is what caused the original failure).
      const listedAllTogglesOff = listFor({
        ...baseToggles,
        scope: { runCode: false, saveVersions: false, paintFaces: false, sessionNotes: false },
        vision: { ...baseToggles.vision, views: false },
      }).includes('getShareLink');

      // End-to-end dispatch: a session with a saved version so there's a design
      // to encode (getShareLink commits the current buffer, then exports it).
      const pw = (window as unknown as { partwright: {
        createSession: (n?: string) => Promise<unknown>;
        runAndSave: (code: string, label?: string) => Promise<unknown>;
      } }).partwright;
      await pw.createSession('sharelink-tool-test');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'base');

      const exec = await tools.executeTool('getShareLink', {});
      return { listedDefault, listedAllTogglesOff, exec, origin: location.origin };
    });

    // Always available — present with full scope and with every toggle paused.
    expect(result.listedDefault).toBe(true);
    expect(result.listedAllTogglesOff).toBe(true);

    // The call dispatched to window.partwright instead of throwing the old
    // "Unknown tool" error, and returned a self-contained hash URL.
    expect(result.exec.isError).toBe(false);
    expect(result.exec.content).not.toContain('Unknown tool');
    const payload = JSON.parse(result.exec.content) as { url?: string; encodedBytes?: number; error?: string };
    expect(payload.error).toBeUndefined();
    expect(payload.url?.startsWith(`${result.origin}/editor#share=`)).toBe(true);
    expect(payload.encodedBytes).toBeGreaterThan(0);
  });
});
