import { test, expect, type Page } from 'playwright/test';
import { readFileSync } from 'fs';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// Network-free coverage for the chat export feature:
//   - the standalone "⬇ Chat" button in the AI panel header (Markdown), and
//   - chat embedded in / restored from a `.partwright.json` session export.
// Chat is seeded straight into IndexedDB so we never need a live AI provider.

const EXPORT_BTN = 'button[title^="Export this conversation"]';

/** Insert three representative chat rows (text, a tool call, a tool result)
 *  into the app's `aiChats` store under the given session id. */
async function seedChat(page: Page, sessionId: string): Promise<void> {
  await page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const tx = db.transaction('aiChats', 'readwrite');
    const store = tx.objectStore('aiChats');
    const now = Date.now();
    store.put({ id: 'seed-1', sessionId: sid, role: 'user', blocks: [{ type: 'text', text: 'Design a widget bracket' }], createdAt: now, seq: 0 });
    store.put({ id: 'seed-2', sessionId: sid, role: 'assistant', blocks: [{ type: 'text', text: 'Sure, building it now.' }], toolCalls: [{ id: 't1', name: 'runAndSave', input: { code: 'return Manifold.cube([10,10,10])', label: 'v1' } }], createdAt: now, seq: 1 });
    store.put({ id: 'seed-3', sessionId: sid, role: 'user', blocks: [], toolResults: [{ toolUseId: 't1', content: '{"saved":true}' }], createdAt: now, seq: 2 });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, sessionId);
}

async function createSession(page: Page, name: string): Promise<string> {
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { createSession?: unknown } }).partwright?.createSession);
  return page.evaluate(async (n) => {
    const w = window as unknown as { partwright: { createSession: (name: string) => Promise<{ id: string }> } };
    return (await w.partwright.createSession(n)).id;
  }, name);
}

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Chat export', () => {
  test('Export button on an empty chat warns and downloads nothing', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');

    let downloaded = false;
    page.on('download', () => { downloaded = true; });

    await panel.locator(EXPORT_BTN).dispatchEvent('click');
    await expect(panel).toContainText('Nothing to export');
    expect(downloaded).toBe(false);
  });

  test('Export button downloads a Markdown transcript of the conversation', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Export Test');
    await seedChat(page, id);

    await page.goto(`/editor?session=${id}`);
    await waitForEditorReady(page);
    await openAiPanel(page);
    const panel = page.locator('#ai-panel');
    await expect(panel).toContainText('Design a widget bracket');

    const downloadPromise = page.waitForEvent('download');
    await panel.locator(EXPORT_BTN).dispatchEvent('click');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.md$/);
    const path = await download.path();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('# Chat — Export Test');
    expect(content).toContain('Design a widget bracket');
    expect(content).toContain('Sure, building it now.');
    expect(content).toContain('runAndSave');
  });

  test('session export embeds chat and import restores it under the new session', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const id = await createSession(page, 'Roundtrip');
    await seedChat(page, id);

    // Exported payload carries the chat with volatile fields stripped.
    const exported = await page.evaluate(async (sid) => {
      const w = window as unknown as { partwright: { exportSessionData: (id: string) => Promise<{ data: unknown }> } };
      return (await w.partwright.exportSessionData(sid)).data as {
        partwright: string;
        chat?: { id?: string; sessionId?: string; blocks: { type: string; text?: string }[] }[];
      };
    }, id);
    expect(exported.partwright).toBe('1.7');
    expect(exported.chat?.length).toBe(3);
    expect(exported.chat?.[0].blocks[0].text).toBe('Design a widget bracket');
    expect(exported.chat?.[0].id).toBeUndefined();
    expect(exported.chat?.[0].sessionId).toBeUndefined();

    // Import mints a new session and re-homes the chat into it.
    const newId = await page.evaluate(async (payload) => {
      const w = window as unknown as { partwright: { importSession: (d: unknown) => Promise<{ id: string }> } };
      return (await w.partwright.importSession(payload)).id;
    }, exported);
    expect(typeof newId).toBe('string');
    expect(newId).not.toBe(id);

    const restored = await page.evaluate(async (sid) => {
      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open('partwright');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const tx = db.transaction('aiChats', 'readonly');
      const idx = tx.objectStore('aiChats').index('sessionId');
      const rows: { id: string; sessionId: string; seq: number }[] = await new Promise((res, rej) => {
        const r = idx.getAll(IDBKeyRange.only(sid));
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();
      return rows;
    }, newId);

    expect(restored.length).toBe(3);
    expect(restored.every(m => m.sessionId === newId)).toBe(true);
    // Fresh ids minted on import — originals must not be reused (would clobber).
    expect(restored.some(m => m.id === 'seed-1')).toBe(false);
  });
});

// Reproduces the reported bug: one continuous conversation persisted across two
// real sessions (the lead-up turns stranded under an earlier session when the
// model created a new one mid-turn), and the recovery that reunites them.
async function seedSplit(page: Page, fromId: string, toId: string): Promise<void> {
  await page.evaluate(async ([A, B]) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const t0 = 1_000_000;
    const tx = db.transaction('aiChats', 'readwrite');
    const os = tx.objectStore('aiChats');
    // First half lives under session A (earlier in time, seq 0..1).
    os.put({ id: 'a-0', sessionId: A, role: 'user', blocks: [{ type: 'text', text: 'first half one' }], createdAt: t0, seq: 0 });
    os.put({ id: 'a-1', sessionId: A, role: 'assistant', blocks: [{ type: 'text', text: 'first half two' }], createdAt: t0 + 1000, seq: 1 });
    // Second half under session B (later, seq 2..3) — the URL/landing session.
    os.put({ id: 'b-0', sessionId: B, role: 'user', blocks: [{ type: 'text', text: 'second half one' }], createdAt: t0 + 10000, seq: 2 });
    os.put({ id: 'b-1', sessionId: B, role: 'assistant', blocks: [{ type: 'text', text: 'second half two' }], createdAt: t0 + 11000, seq: 3 });
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, [fromId, toId]);
}

test.describe('Chat history recovery', () => {
  test('mergeChatHistory reunites a conversation split across two sessions', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    const a = await createSession(page, 'First half');
    const b = await createSession(page, 'Second half');
    await seedSplit(page, a, b);

    const res = await page.evaluate(async ([from, to]) => {
      const w = window as unknown as { partwright: { mergeChatHistory: (f: string, t: string) => Promise<{ moved?: number; error?: string }> } };
      return w.partwright.mergeChatHistory(from, to);
    }, [a, b]);
    expect(res.error).toBeUndefined();
    expect(res.moved).toBe(2);

    const rows = await page.evaluate(async ([A, B]) => {
      const db: IDBDatabase = await new Promise((res2, rej) => {
        const r = indexedDB.open('partwright');
        r.onsuccess = () => res2(r.result);
        r.onerror = () => rej(r.error);
      });
      const getAll = (sid: string): Promise<{ id: string; sessionId: string; seq: number; createdAt: number }[]> =>
        new Promise((res2, rej) => {
          const r = db.transaction('aiChats', 'readonly').objectStore('aiChats').index('sessionId').getAll(IDBKeyRange.only(sid));
          r.onsuccess = () => res2(r.result);
          r.onerror = () => rej(r.error);
        });
      const out = { a: await getAll(A), b: await getAll(B) };
      db.close();
      return out;
    }, [a, b]);

    // Source emptied, everything reunited under the target, contiguous + ordered.
    expect(rows.a.length).toBe(0);
    expect(rows.b.length).toBe(4);
    const ordered = rows.b.sort((x, y) => x.seq - y.seq);
    expect(ordered.map(m => m.seq)).toEqual([0, 1, 2, 3]);
    expect(ordered.map(m => m.id)).toEqual(['a-0', 'a-1', 'b-0', 'b-1']);
    expect(ordered.every(m => m.sessionId === b)).toBe(true);
  });
});
