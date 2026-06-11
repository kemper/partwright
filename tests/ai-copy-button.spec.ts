import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady, waitForChatSessionId } from './helpers/aiPanel';

// Golden path for the per-bubble copy button: every text/response bubble in the
// AI panel carries a small copy-to-clipboard button on its outer edge, so a
// user can grab any message (especially AI replies) in one click. We seed a
// user + assistant turn, then assert one button per text bubble and that the
// assistant button copies that bubble's text verbatim.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test('each chat bubble has a copy button that copies its text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/editor');
  await page.waitForSelector('#ai-panel', { state: 'attached' });
  // Seed against the restored session bucket so the post-reload restore reads it
  // back (a bare /editor creates the session only after WASM init).
  const sid = await waitForChatSessionId(page);

  await page.evaluate(async (sid) => {
    const db = await import('/src/ai/db.ts');
    await db.putMessages([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'm-user-1', sessionId: sid, role: 'user', blocks: [{ type: 'text', text: 'Make me a gear.' }], createdAt: Date.now(), seq: 1 } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'm-asst-1', sessionId: sid, role: 'assistant', blocks: [{ type: 'text', text: 'Done — created a 20-tooth spur gear.' }], createdAt: Date.now(), seq: 2 } as any,
    ]);
  }, sid);

  await page.reload();
  await waitForEditorReady(page);
  await openAiPanel(page);

  await expect(page.locator('#ai-panel').getByText('Done — created a 20-tooth spur gear.'))
    .toBeVisible({ timeout: 15_000 });

  // One copy button per text bubble (the seeded user turn + assistant reply).
  const copyBtns = page.locator('#ai-panel button[aria-label="Copy message to clipboard"]');
  await expect(copyBtns).toHaveCount(2);

  // The assistant button (second) puts that bubble's exact text on the clipboard.
  await copyBtns.nth(1).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('Done — created a 20-tooth spur gear.');
});
