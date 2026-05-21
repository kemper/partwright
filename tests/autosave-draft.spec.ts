// Crash-safe autosave (draft layer). Verifies that uncommitted editor edits are
// mirrored into a per-session draft and restored on the next visit, and that
// committing a version (runAndSave) clears the draft so no stale restore is
// offered.
//
// Drafts live in localStorage keyed `partwright-draft-v1:<sessionId>`. Each test
// gets a fresh BrowserContext, so storage is isolated (see CLAUDE.md).

import { test, expect } from 'playwright/test';

const V1 = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
const EDITED = 'const { Manifold } = api; return Manifold.sphere(8);';

// Accept the native "Leave site?" prompt the dirty-state guard raises so a
// reload proceeds deterministically instead of stalling on the dialog.
function autoAcceptUnloadPrompt(page: import('playwright/test').Page) {
  page.on('dialog', d => { void d.accept().catch(() => {}); });
}

async function newSessionWithV1(page: import('playwright/test').Page): Promise<string> {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  const sid = await page.evaluate(async (code) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.createSession('draft-test');
    await pw.runAndSave(code, 'v1');
    return new URLSearchParams(location.search).get('session');
  }, V1);
  expect(sid).toBeTruthy();
  return sid as string;
}

test.describe('autosave draft recovery', () => {
  test('restores uncommitted edits after a reload', async ({ page }) => {
    autoAcceptUnloadPrompt(page);
    const sid = await newSessionWithV1(page);

    // Edit without saving — this is the work a crash would otherwise lose.
    await page.evaluate((code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).partwright.setCode(code);
    }, EDITED);

    // The debounced autosave should mirror the edit into the draft.
    await expect
      .poll(() => page.evaluate((id) => localStorage.getItem(`partwright-draft-v1:${id}`) ?? '', sid))
      .toContain('sphere');

    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // The editor should come back showing the uncommitted edit, not the saved v1.
    await expect
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .poll(() => page.evaluate(() => (window as any).partwright.getCode()))
      .toContain('sphere');
  });

  test('committing a version clears the draft (no stale restore)', async ({ page }) => {
    autoAcceptUnloadPrompt(page);
    const sid = await newSessionWithV1(page);

    // Edit, then commit it as v2 — the save must drop the draft.
    await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.setCode(code);
      await pw.runAndSave(code, 'v2');
    }, EDITED);

    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // v2 loads, and because the draft matched the saved version there is no
    // "restored unsaved changes" prompt.
    await expect
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .poll(() => page.evaluate(() => (window as any).partwright.getCode()))
      .toContain('sphere');
    await expect(
      page.locator('div[role="status"]').filter({ hasText: 'Restored unsaved changes' }),
    ).toHaveCount(0);
  });
});
