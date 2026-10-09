// E2E coverage for paint persistence across part switches (issue #736).
// When a user paints a part and then switches away (via "+" add-part or the
// part rail), the unsaved paint must survive in the per-part draft and be
// restored when they switch back. The part should still appear as "unsaved"
// in the multi-part save modal until the paint is committed.

import { test, expect, type Page } from 'playwright/test';
import { waitFor } from './helpers/waitFor';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('partwright-tour-completed', '1');
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
    } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).partwright?.runAndSave, { timeout: 30_000 });
}

const cube = `const { Manifold } = api; return Manifold.cube([10,10,10], true);`;

/** Poll until the active part id differs from `prevPartId`. `#btn-add-part`'s
 *  click handler is fire-and-forget (`void cb.onCreatePart()`), so Playwright's
 *  click() resolves before the new part is actually created and switched to.
 *  `onCreatePart` awaits `writeDraft(...)` (stashing the outgoing part's paint)
 *  BEFORE `createPart()` resolves, so this single wait also covers the draft
 *  write — a plain `.blur()` call does not reliably fire CodeMirror's onBlur in
 *  a headless page (the editor never actually holds DOM focus here), so the
 *  autosave-on-blur path isn't a usable signal; the "+" button's own stash is. */
async function waitForPartChange(page: Page, prevPartId: string) {
  await waitFor(
    () => page.evaluate((prev) => {
      const cur = (window as any).partwright.getCurrentPart();
      return !!cur && cur.id !== prev;
    }, prevPartId),
    { timeout: 10_000, message: 'the new part to become active' },
  );
}

/** Poll until `listRegions()` reports at least one region. The parts-list row
 *  click handler is also fire-and-forget (`void cb.onSelectPart(...)`), so this
 *  is the real "switch + draft restore + rehydrate" completion signal — the
 *  same condition the test asserts right after, just polled instead of guessed. */
async function waitForRegionsRestored(page: Page) {
  await waitFor(
    () => page.evaluate(() => (window as any).partwright.listRegions().length > 0),
    { timeout: 10_000, message: 'paint regions to be restored after switching parts' },
  );
}

test.describe('Part-unload paint persistence', () => {
  test('paint survives clicking the + add-part button and switching back', async ({ page }) => {
    await openEditor(page);

    // Create a session, run+save part 1 to give it a mesh to paint.
    await page.evaluate(async (code) => {
      const pw = (window as any).partwright;
      await pw.createSession('PaintPersist');
      await pw.runAndSave(code, 'v1');
    }, cube);

    // Paint some triangles on part 1 via the console API.
    await page.evaluate(() => {
      (window as any).partwright.paintFaces({ triangleIds: [0, 1, 2, 3], color: [1, 0, 0], name: 'red' });
    });

    // Verify paint was applied.
    const regionsBefore = await page.evaluate(() =>
      (window as any).partwright.listRegions()
    );
    expect(regionsBefore.length).toBeGreaterThan(0);

    // Note the id of Object 1 so we can navigate back to it.
    const part1Id = await page.evaluate(() =>
      (window as any).partwright.listParts().find((p: any) => p.isCurrent)?.id
    );
    expect(part1Id).toBeTruthy();

    // Blur the editor to fire the autosave (stashes the draft including paint).
    await page.locator('.cm-content').blur();

    // Click the "+" add-part button — this is the action that previously lost paint.
    // The button stashes the current part's draft (code + paint) before switching.
    await page.locator('#btn-add-part').click();
    await waitForPartChange(page, part1Id); // let the new part initialize (WASM)

    // Switch back to Object 1 by clicking its row in the parts rail.
    await page.locator(`#parts-list [data-part-id="${part1Id}"]`).click();
    // Wait for the part switch + draft restore + rehydrate to complete.
    await waitForRegionsRestored(page);

    // The paint regions should be restored from the draft.
    const regionsAfter = await page.evaluate(() =>
      (window as any).partwright.listRegions()
    );
    expect(regionsAfter.length).toBeGreaterThan(0);
  });

  test('save-all captures stashed paint: painted+unswitched part appears in modal', async ({ page }) => {
    await openEditor(page);

    // Create session, run+save Object 1, paint it.
    const part1Id = await page.evaluate(async (code) => {
      const pw = (window as any).partwright;
      await pw.createSession('PaintSaveAll');
      await pw.runAndSave(code, 'v1');
      pw.paintFaces({ triangleIds: [0, 1, 2, 3], color: [0, 1, 0], name: 'green' });
      return pw.listParts().find((p: any) => p.isCurrent)?.id;
    }, cube);

    // Blur the editor so the autosave draft flush fires (captures paint too).
    await page.locator('.cm-content').blur();

    // Click "+" to add a new part — stashes the painted draft (code + paint).
    await page.locator('#btn-add-part').click();
    await waitForPartChange(page, part1Id);

    // Trigger Cmd/Ctrl+S → should open the multi-part save modal listing Object 1 as unsaved.
    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 7_000 });
    // Object 1 must appear (the painted draft makes it unsaved even though code matches saved).
    await expect(dialog.getByText('Object 1', { exact: true })).toBeVisible();

    // "Save all" commits every listed part. The modal itself closes the instant
    // the button is clicked (before the save loop runs), so the real completion
    // signal is the success toast the save loop fires once every part lands.
    await dialog.getByRole('button', { name: 'Save all' }).click();
    await expect(page.locator('[role="status"]', { hasText: /Saved \d+ part/ })).toBeVisible({ timeout: 10_000 });

    // Switch back to Object 1 and verify its latest version has color regions.
    await page.locator(`#parts-list [data-part-id="${part1Id}"]`).click();
    await waitForRegionsRestored(page);

    const regionsOnSaved = await page.evaluate(() =>
      (window as any).partwright.listRegions()
    );
    expect(regionsOnSaved.length).toBeGreaterThan(0);
  });

  test('paint persists across a page reload when stashed in draft via the + button', async ({ page }) => {
    await openEditor(page);

    // Create session, run+save, paint.
    const { sessionId, part1Id } = await page.evaluate(async (code) => {
      const pw = (window as any).partwright;
      const s = await pw.createSession('PaintReload');
      await pw.runAndSave(code, 'v1');
      pw.paintFaces({ triangleIds: [0, 1, 2, 3], color: [0, 0, 1], name: 'blue' });
      const id = pw.listParts().find((p: any) => p.isCurrent)?.id;
      return { sessionId: s.id, part1Id: id };
    }, cube);

    // Blur to trigger autosave so the draft is flushed before clicking "+".
    await page.locator('.cm-content').blur();

    // Click "+" — this stashes Object 1's draft (with paint) via the button path.
    await page.locator('#btn-add-part').click();
    await waitForPartChange(page, part1Id);

    // Reload the page — the draft (including stashed paint) must survive in IDB.
    await page.goto(`/editor?session=${sessionId}`);
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as any).partwright?.listParts, { timeout: 30_000 });
    // Wait for both parts to actually render in the rail before clicking a row.
    await expect(page.locator('#parts-list [data-part-id]')).toHaveCount(2);

    // The session should open on the last active part (Object 2). Switch to Object 1 —
    // restoreDraftIfNewer should rehydrate its stashed paint from the draft.
    await page.locator(`#parts-list [data-part-id="${part1Id}"]`).click();
    await waitForRegionsRestored(page);

    const regionsAfterReload = await page.evaluate(() =>
      (window as any).partwright.listRegions()
    );
    expect(regionsAfterReload.length).toBeGreaterThan(0);
  });
});
