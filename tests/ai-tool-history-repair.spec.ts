import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Recovery from a wedged tool-history invariant — the "`tool_use` ids were found
// without `tool_result` blocks immediately after" provider 400. An interrupted
// turn (Stop, stall, spend cap, crash, mid-turn session switch) leaves an
// assistant `tool_use` with no matching `tool_result` persisted in history, and
// every hosted provider then 400s on that shape on EVERY subsequent send until
// the stored messages are fixed. This spec seeds exactly that corrupted shape
// and proves the manual `/repair` command heals it (network-free — no key).
//
// The automatic counterpart (repair-before-every-send at the runTurnWithStallRetry
// choke point) and the error-signature matcher are covered by the unit tier
// (tests/unit/historyRepair.test.ts).

async function createSession(page: Page, name: string): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { createSession?: unknown } }).partwright?.createSession);
  return page.evaluate(async (n) => {
    const w = window as unknown as { partwright: { createSession: (name: string) => Promise<{ id: string }> } };
    return (await w.partwright.createSession(n)).id;
  }, name);
}

/** Seed a corrupted transcript: a user turn, then an assistant turn that emitted
 *  a tool_use whose tool_result never landed (the orphaned tool_use). */
async function seedOrphanedToolUse(page: Page, sessionId: string, toolUseId: string): Promise<void> {
  await page.evaluate(async ({ sid, tid }) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('aiChats', 'readwrite');
    const store = tx.objectStore('aiChats');
    store.put({ id: 'seed-user', sessionId: sid, role: 'user', blocks: [{ type: 'text', text: 'Model a bracket' }], createdAt: 1000, seq: 0 });
    store.put({
      id: 'seed-assistant',
      sessionId: sid,
      role: 'assistant',
      blocks: [{ type: 'text', text: 'On it — building the bracket now.' }],
      toolCalls: [{ id: tid, name: 'runAndSave', input: {} }],
      createdAt: 2000,
      seq: 1,
    });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, { sid: sessionId, tid: toolUseId });
}

/** Read every aiChats row for a session back out of IndexedDB. */
async function readChat(page: Page, sessionId: string): Promise<Array<{ role: string; toolResults?: Array<{ toolUseId: string; isError?: boolean }> }>> {
  return page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: unknown[] = await new Promise((res, rej) => {
      const tx = db.transaction('aiChats', 'readonly');
      const req = tx.objectStore('aiChats').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return (rows as Array<{ sessionId: string }>).filter((r) => r.sessionId === sid) as never;
  }, sessionId);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('tool-history repair', () => {
  test('/repair heals an orphaned tool_use so the chat can send again', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Repair Orphan');
    const toolUseId = 'toolu_01Cvxc2x4mLvUKaYTaCQK32e'; // the id from the reported 400
    await seedOrphanedToolUse(page, id, toolUseId);

    await page.goto(`/editor?session=${id}`);
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    await expect(panel).toContainText('building the bracket now');

    // Precondition: the seeded history really is corrupted (an assistant
    // tool_use with no following tool_result).
    const before = await readChat(page, id);
    expect(before.some((m) => m.role === 'user' && (m.toolResults ?? []).some((r) => r.toolUseId === toolUseId))).toBe(false);

    // Run the manual repair.
    const input = panel.locator('textarea');
    await input.fill('/repair');
    await input.press('Enter');

    // The transcript now shows the synthetic, error-marked result standing in for
    // the interrupted call (the success toast itself is global + fades, so we
    // assert on the persistent transcript content instead).
    await expect(panel).toContainText(/history was repaired so the chat can continue/i);

    // A synthetic, error-marked tool_result for the orphaned id was persisted.
    const after = await readChat(page, id);
    const carrier = after.find((m) => m.role === 'user' && (m.toolResults ?? []).some((r) => r.toolUseId === toolUseId));
    expect(carrier).toBeTruthy();
    expect(carrier!.toolResults!.find((r) => r.toolUseId === toolUseId)!.isError).toBe(true);

    await page.screenshot({ path: 'test-results/tool-history-repair.png' });
  });

  test('/repair on a clean chat reports nothing to fix', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Repair Clean');
    // Seed a well-formed turn: assistant tool_use answered by a tool_result.
    await page.evaluate(async (sid) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('partwright');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction('aiChats', 'readwrite');
      const store = tx.objectStore('aiChats');
      store.put({ id: 'c-user', sessionId: sid, role: 'user', blocks: [{ type: 'text', text: 'hi' }], createdAt: 1000, seq: 0 });
      store.put({ id: 'c-asst', sessionId: sid, role: 'assistant', blocks: [], toolCalls: [{ id: 'toolu_ok', name: 'runAndSave', input: {} }], createdAt: 2000, seq: 1 });
      store.put({ id: 'c-res', sessionId: sid, role: 'user', blocks: [], toolResults: [{ toolUseId: 'toolu_ok', content: 'ok', isError: false }], createdAt: 3000, seq: 2 });
      await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
      db.close();
    }, id);

    await page.goto(`/editor?session=${id}`);
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    const input = panel.locator('textarea');
    await input.fill('/repair');
    await input.press('Enter');

    await expect(panel).toContainText(/No corrupted tool history/i);
  });
});
