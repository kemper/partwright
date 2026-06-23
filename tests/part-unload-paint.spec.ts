// E2E coverage for paint persistence across part switches (issue #736).
// When a user paints a part and then switches away (via "+" add-part or the
// part rail), the unsaved paint must survive in the per-part draft and be
// restored when they switch back. The part should still appear as "unsaved"
// in the multi-part save modal until the paint is committed.

import { test, expect, type Page } from 'playwright/test';

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

    // Note the id of Part 1 so we can navigate back to it.
    const part1Id = await page.evaluate(() =>
      (window as any).partwright.listParts().find((p: any) => p.isCurrent)?.id
    );
    expect(part1Id).toBeTruthy();

    // Blur the editor to fire the autosave (stashes the draft including paint).
    await page.locator('.cm-content').blur();
    await page.waitForTimeout(600);

    // Click the "+" add-part button — this is the action that previously lost paint.
    // The button stashes the current part's draft (code + paint) before switching.
    await page.locator('#btn-add-part').click();
    await page.waitForTimeout(2000); // let the new part initialize (WASM)

    // Switch back to Part 1 by clicking its row in the parts rail.
    await page.locator(`#parts-list [data-part-id="${part1Id}"]`).click();
    // Wait for the part switch + draft restore + rehydrate to complete.
    await page.waitForTimeout(2500);

    // The paint regions should be restored from the draft.
    const regionsAfter = await page.evaluate(() =>
      (window as any).partwright.listRegions()
    );
    expect(regionsAfter.length).toBeGreaterThan(0);
  });

  test('save-all captures stashed paint: painted+unswitched part appears in modal', async ({ page }) => {
    await openEditor(page);

    // Create session, run+save Part 1, paint it.
    const part1Id = await page.evaluate(async (code) => {
      const pw = (window as any).partwright;
      await pw.createSession('PaintSaveAll');
      await pw.runAndSave(code, 'v1');
      pw.paintFaces({ triangleIds: [0, 1, 2, 3], color: [0, 1, 0], name: 'green' });
      return pw.listParts().find((p: any) => p.isCurrent)?.id;
    }, cube);

    // Blur the editor so the autosave draft flush fires (captures paint too).
    await page.locator('.cm-content').blur();
    await page.waitForTimeout(600);

    // Click "+" to add a new part — stashes the painted draft (code + paint).
    await page.locator('#btn-add-part').click();
    await page.waitForTimeout(1500);

    // Trigger Cmd/Ctrl+S → should open the multi-part save modal listing Part 1 as unsaved.
    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 7_000 });
    // Part 1 must appear (the painted draft makes it unsaved even though code matches saved).
    await expect(dialog.getByText('Part 1', { exact: true })).toBeVisible();

    // "Save all" commits every listed part.
    await dialog.getByRole('button', { name: 'Save all' }).click();
    await page.waitForTimeout(3000);

    // Switch back to Part 1 and verify its latest version has color regions.
    await page.locator(`#parts-list [data-part-id="${part1Id}"]`).click();
    await page.waitForTimeout(2500);

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
    await page.waitForTimeout(600);

    // Click "+" — this stashes Part 1's draft (with paint) via the button path.
    await page.locator('#btn-add-part').click();
    await page.waitForTimeout(1500);

    // Reload the page — the draft (including stashed paint) must survive in IDB.
    await page.goto(`/editor?session=${sessionId}`);
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.waitForFunction(() => !!(window as any).partwright?.listParts, { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // The session should open on the last active part (Part 2). Switch to Part 1 —
    // restoreDraftIfNewer should rehydrate its stashed paint from the draft.
    await page.locator(`#parts-list [data-part-id="${part1Id}"]`).click();
    await page.waitForTimeout(2500);

    const regionsAfterReload = await page.evaluate(() =>
      (window as any).partwright.listRegions()
    );
    expect(regionsAfterReload.length).toBeGreaterThan(0);
  });
});
