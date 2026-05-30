import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Network-free coverage for the AI input's slash commands. The commands run
// panel actions (compact / clear / review / export / models / help) instead of
// sending the text to a provider, so none of this needs a live AI key. Chat is
// seeded straight into IndexedDB where a command needs an existing transcript.

const MENU = '#ai-slash-menu';

async function createSession(page: Page, name: string): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { createSession?: unknown } }).partwright?.createSession);
  return page.evaluate(async (n) => {
    const w = window as unknown as { partwright: { createSession: (name: string) => Promise<{ id: string }> } };
    return (await w.partwright.createSession(n)).id;
  }, name);
}

/** Insert one chat row so clear/export have something to act on. */
async function seedChat(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('aiChats', 'readwrite');
    tx.objectStore('aiChats').put({ id: 'seed-1', sessionId: sid, role: 'user', blocks: [{ type: 'text', text: 'Design a widget bracket' }], createdAt: Date.now(), seq: 0 });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, sessionId);
}

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('AI slash commands', () => {
  test('typing "/" opens the autocomplete menu; a normal message does not', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    const menu = page.locator(MENU);

    await expect(menu).toBeHidden();

    // Capture the input box before the menu opens so we can prove the menu is
    // an overlay that doesn't reflow / resize the textarea.
    const inputBefore = await input.boundingBox();

    await input.click();
    await input.pressSequentially('/');
    await expect(menu).toBeVisible();
    // Lists the commands with descriptions.
    await expect(menu).toContainText('/compact');
    await expect(menu).toContainText('/clear');
    await expect(menu).toContainText('/help');
    await expect(menu).toContainText('/models');

    // The input keeps its size/position — the menu floats above it, it does
    // not share the pane or push the textarea down.
    const inputAfter = await input.boundingBox();
    expect(inputAfter?.height).toBeCloseTo(inputBefore!.height, 0);
    expect(inputAfter?.y).toBeCloseTo(inputBefore!.y, 0);
    const menuBox = await menu.boundingBox();
    // Menu sits entirely above the input's top edge.
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(inputAfter!.y + 1);

    // A stray Enter on the bare-"/" menu must NOT fire the first command
    // (/compact) — the choice is ambiguous, so Enter is a no-op that keeps the
    // menu open. Nothing ran: the input still holds "/".
    await input.press('Enter');
    await expect(menu).toBeVisible();
    await expect(input).toHaveValue('/');

    // Narrowing the token filters the list.
    await input.pressSequentially('cl');
    await expect(menu).toContainText('/clear');
    await expect(menu).not.toContainText('/compact');

    // Tab completes the highlighted command into the input.
    await input.press('Tab');
    await expect(input).toHaveValue('/clear');

    // A space after the token (now an argument) closes the menu...
    await input.pressSequentially(' x');
    await expect(menu).toBeHidden();

    // ...and a plain message never opens it.
    await input.fill('just a normal message');
    await expect(menu).toBeHidden();
  });

  test('arrow-selecting a command and pressing Enter runs it', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    const menu = page.locator(MENU);

    await input.click();
    await input.pressSequentially('/');
    await expect(menu).toBeVisible();

    // ArrowUp wraps the highlight to the last command (/help); an explicit
    // selection makes Enter act. /help clears the input and reopens the full
    // menu — a network-free, observable effect.
    await input.press('ArrowUp');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('/compact');
  });

  test('/help opens the full command menu', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    const menu = page.locator(MENU);

    await input.fill('/help');
    await input.press('Enter');

    await expect(menu).toBeVisible();
    await expect(menu).toContainText('/compact');
    await expect(menu).toContainText('/review');
    await expect(menu).toContainText('/export');
    // Running the command clears the typed text.
    await expect(input).toHaveValue('');
  });

  test('an unknown slash command warns and is not sent', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');

    await input.fill('/bogus');
    await input.press('Enter');

    await expect(panel).toContainText('Unknown command /bogus');
    // The text is kept in the box (not sent, not cleared) so the user can fix it.
    await expect(input).toHaveValue('/bogus');
    // It never became a chat bubble (the status line legitimately echoes it,
    // so scope the check to the transcript).
    await expect(page.locator('#ai-transcript')).not.toContainText('/bogus');
  });

  test('/clear empties the seeded transcript', async ({ page }) => {
    page.on('dialog', d => d.accept()); // the clear confirmation
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Slash Clear');
    await seedChat(page, id);

    await page.goto(`/editor?session=${id}`);
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    await expect(panel).toContainText('Design a widget bracket');

    const input = panel.locator('textarea');
    await input.fill('/clear');
    await input.press('Enter');

    await expect(panel).toContainText('Chat cleared.');
    await expect(panel).not.toContainText('Design a widget bracket');
  });

  test('/export downloads a Markdown transcript', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Slash Export');
    await seedChat(page, id);

    await page.goto(`/editor?session=${id}`);
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    await expect(panel).toContainText('Design a widget bracket');

    const input = panel.locator('textarea');
    const downloadPromise = page.waitForEvent('download');
    await input.fill('/export');
    await input.press('Enter');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.md$/);
  });
});
