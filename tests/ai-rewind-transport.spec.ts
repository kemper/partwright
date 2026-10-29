import { test, expect, type Page } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// The AI panel's rewind transport (⏮ ◀ ▶ ⏭): step back/forward move one agent
// step (a model reply + its tool results) at a time, skip back/forward jump a
// whole "chapter" (to before/after the human's next message). Network-free —
// the chat is seeded straight into IndexedDB. The cut/step math itself is
// unit-tested in tests/unit/rewind.test.ts.

async function createSession(page: Page, name: string): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { createSession?: unknown } }).partwright?.createSession);
  return page.evaluate(async (n) => {
    const w = window as unknown as { partwright: { createSession: (name: string) => Promise<{ id: string }> } };
    return (await w.partwright.createSession(n)).id;
  }, name);
}

/** A plan request, the approval, then a three-step agent run. */
async function seedRun(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('aiChats', 'readwrite');
    const store = tx.objectStore('aiChats');
    let seq = 0;
    const put = (m: Record<string, unknown>) => store.put({ sessionId: sid, createdAt: 1000 + seq, seq: seq++, blocks: [], ...m });
    put({ id: 'r-ask', role: 'user', blocks: [{ type: 'text', text: 'Make a wall bracket' }] });
    put({ id: 'r-plan', role: 'assistant', blocks: [{ type: 'text', text: 'Plan: base plate, screw holes, fillets.' }] });
    put({ id: 'r-approve', role: 'user', blocks: [{ type: 'text', text: 'Plan approved — build it.' }] });
    for (const [n, label] of [[1, 'Building the base plate'], [2, 'Drilling the screw holes'], [3, 'Adding the fillets']] as const) {
      put({ id: `r-a${n}`, role: 'assistant', blocks: [{ type: 'text', text: `${label}.` }], toolCalls: [{ id: `toolu_${n}`, name: 'runAndSave', input: {} }] });
      put({ id: `r-t${n}`, role: 'user', toolResults: [{ toolUseId: `toolu_${n}`, content: 'ok', isError: false }] });
    }
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, sessionId);
}

async function chatIds(page: Page, sessionId: string): Promise<string[]> {
  return page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows: Array<{ id: string; sessionId: string; seq: number }> = await new Promise((res, rej) => {
      const req = db.transaction('aiChats', 'readonly').objectStore('aiChats').getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    db.close();
    return rows.filter(r => r.sessionId === sid).sort((a, b) => a.seq - b.seq).map(r => r.id);
  }, sessionId);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('AI chat rewind transport', () => {
  test('steps back one agent step at a time, skips back to the last message, and restores', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Rewind Transport');
    await seedRun(page, id);

    await page.goto(`/editor?session=${id}`);
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    await expect(panel).toContainText('Adding the fillets');

    const btn = (a: string) => panel.locator(`button[data-rewind="${a}"]`);
    const banner = panel.locator('[data-rewind-banner]');
    await expect(btn('stepForward')).toBeDisabled();
    await expect(btn('skipForward')).toBeDisabled();
    await expect(banner).toHaveCount(0);

    // ◀ removes only the last step (its reply and tool result).
    await btn('stepBack').click();
    await expect(panel).not.toContainText('Adding the fillets');
    await expect(panel).toContainText('Drilling the screw holes');
    await expect(banner).toContainText('Rewound 1 step');
    expect(await chatIds(page, id)).toEqual(['r-ask', 'r-plan', 'r-approve', 'r-a1', 'r-t1', 'r-a2', 'r-t2']);
    await panel.screenshot({ path: 'test-results/rewind-step-back.png' });

    await btn('stepBack').click();
    await expect(panel).not.toContainText('Drilling the screw holes');
    await expect(banner).toContainText('Rewound 2 steps');

    // ▶ restores exactly one step.
    await btn('stepForward').click();
    await expect(panel).toContainText('Drilling the screw holes');
    await expect(panel).not.toContainText('Adding the fillets');

    // ⏮ jumps to before the plan approval in one click.
    await btn('skipBack').click();
    await expect(panel).not.toContainText('Plan approved');
    await expect(panel).toContainText('Plan: base plate');
    await expect(banner).toContainText('Rewound 4 steps (incl. 1 of your message)');
    expect(await chatIds(page, id)).toEqual(['r-ask', 'r-plan']);

    // ⏭ restores everything up to the next human message — here, the end.
    await btn('skipForward').click();
    await expect(panel).toContainText('Adding the fillets');
    await expect(banner).toHaveCount(0);
    expect(await chatIds(page, id)).toEqual([
      'r-ask', 'r-plan', 'r-approve', 'r-a1', 'r-t1', 'r-a2', 'r-t2', 'r-a3', 'r-t3',
    ]);
    await expect(btn('stepForward')).toBeDisabled();
  });
});
