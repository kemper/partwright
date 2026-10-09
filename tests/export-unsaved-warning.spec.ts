// E2E for the "unsaved parts" export warning. A multi-part export bakes each
// non-current part from its last SAVED version, so unsaved edits (fresh paint
// especially) silently drop out. The pre-export confirm modal now flags unsaved
// non-current parts and offers a Save shortcut (routing to the same save flow as
// Cmd/Ctrl+S). Drives the UI, since the confirm modal gates only the UI path.

import { test, expect, type Page } from 'playwright/test';
import { waitFor } from './helpers/waitFor';
/* eslint-disable @typescript-eslint/no-explicit-any */

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('partwright-tour-completed', '1');
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
      localStorage.setItem('partwright-units', 'mm'); // silence the unitless warning
      localStorage.setItem('editor-auto-format', 'false'); // so runAndSave parts read clean (see #764)
    } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).partwright?.runAndSave, { timeout: 30_000 });
}
async function typeCode(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 3 });
}
// Blur to fire the onBlur autosave, then poll IndexedDB (via
// sessionManager.readDraft) until the draft actually carries the typed
// fragment — the real completion signal for an async, fire-and-forget write.
async function flushDraft(page: Page, expectFragment: string) {
  await page.locator('.cm-content').blur();
  await waitFor(
    () => page.evaluate(async (fragment) => {
      const sm = await import('/src/storage/sessionManager.ts');
      const st = sm.getState();
      if (!st.session || !st.currentPart) return false;
      const d = await sm.readDraft(st.session.id, 'manifold-js', st.currentPart.id);
      return !!d?.code.includes(fragment);
    }, expectFragment),
    { timeout: 10_000, message: 'the blur autosave to persist the draft' },
  );
}
// Cmd/Ctrl+S's onSave handler is fire-and-forget, so poll the current part's
// version count instead of sleeping past a guess.
async function saveShortcut(page: Page, expectedVersionCount: number) {
  await page.keyboard.press('ControlOrMeta+s');
  await waitFor(
    () => page.evaluate(async (n) => {
      const pw = (window as any).partwright;
      return (await pw.listVersions()).length === n;
    }, expectedVersionCount),
    { timeout: 10_000, message: `the current part to reach v${expectedVersionCount}` },
  );
}

// Build: Part 1 saved (current), Part "Widget" left unsaved + non-current.
async function setup(page: Page) {
  await page.evaluate(() => (window as any).partwright.createSession('ExportUnsaved'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.cube([10,10,10],true);');
  await flushDraft(page, 'cube([10,10,10]');
  await saveShortcut(page, 1);

  await page.evaluate(() => (window as any).partwright.createPart('Widget'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(6,32);');
  await flushDraft(page, 'sphere(6,32)');
  await saveShortcut(page, 1);

  // Dirty Widget, persist its draft, then switch back to Part 1 (no auto-save)
  // → Widget is now a NON-current part with unsaved changes. changePart() is
  // awaited fully by the evaluate() call below, so no extra settle margin.
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(8,32); // edit');
  await flushDraft(page, 'sphere(8,32)');
  const p1 = await page.evaluate(() => (window as any).partwright.listParts()[0].id);
  await page.evaluate((id) => (window as any).partwright.changePart(id), p1);
}

async function openExportSTL(page: Page) {
  await page.locator('#btn-export').click();
  await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();
}

test('export with an unsaved non-current part warns and offers Save', async ({ page }) => {
  await openEditor(page);
  await setup(page);

  await openExportSTL(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('last saved version');
  await expect(dialog).toContainText('Widget');
  await expect(dialog.getByRole('button', { name: 'Save…' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Export anyway' })).toBeVisible();

  // Widget starts with one saved version. Read the count WITHOUT switching parts
  // (a console changePart would restore+resave Widget's draft and perturb the
  // very unsaved state under test).
  const widgetId = await page.evaluate(() => {
    const pw = (window as any).partwright;
    return pw.listParts().find((p: any) => p.name === 'Widget').id;
  });
  const widgetVersionsBefore = await page.evaluate(async (id) => {
    const db = await import('/src/storage/db.ts');
    return (db as any).getVersionCount(id);
  }, widgetId);

  // Clicking Save… closes the export modal and opens the multi-part save modal
  // (the part chooser) — the export does NOT fire (no "Exported" toast).
  await dialog.getByRole('button', { name: 'Save…' }).click();
  const saveModal = page.getByRole('dialog');
  await expect(saveModal.getByText('Save unsaved objects')).toBeVisible({ timeout: 10_000 });
  // All parts pre-checked → the primary button reads "Save all". Commit.
  await saveModal.getByRole('button', { name: /Save all|Save selected/ }).click();

  // The save modal closes the instant the button is clicked (before the async
  // save loop runs), so poll the real ground truth — Widget's version count —
  // via a direct, read-only db.ts read (no changePart side effects, so it
  // can't race the app's own in-flight save loop; see save-all-parts.spec.ts).
  const widgetVersionsAfter = await waitFor(
    () => page.evaluate(async (id) => {
      const db = await import('/src/storage/db.ts');
      return (db as any).getVersionCount(id);
    }, widgetId).then((n: number) => (n === widgetVersionsBefore + 1 ? n : null)),
    { timeout: 15_000, message: 'Widget to gain a new saved version' },
  );
  expect(widgetVersionsAfter).toBe(widgetVersionsBefore + 1);

  // Negative check: give a wrongly-fired export a bounded window to toast
  // before asserting it never did.
  await page.waitForTimeout(1500);
  await expect(
    page.locator('div[role="status"]').filter({ hasText: /Exported/ }),
  ).toHaveCount(0);
});

test('Export anyway proceeds despite unsaved non-current parts', async ({ page }) => {
  await openEditor(page);
  await setup(page);

  await openExportSTL(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('last saved version');
  await dialog.getByRole('button', { name: 'Export anyway' }).click();

  // The unsaved warning is dismissed and the export proceeds. With ≥2 parts an
  // STL export opens the multi-part part picker ("Export parts to STL") rather
  // than a direct download — its appearance proves we got past the warning.
  await expect(page.getByRole('dialog').getByText(/Export objects to STL/i)).toBeVisible({ timeout: 10_000 });
});

// The reported case: paint the CURRENT part (saved earlier) and export without
// saving. The current part exports from its live mesh, but the user still wants
// to be alerted they have unsaved work — so the warning must fire for it too.
test('export warns when the CURRENT part has unsaved paint', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const pw = (window as any).partwright;
    await pw.createSession('CurrentUnsaved');
    await pw.runAndSave('const {Manifold}=api; return Manifold.cube([10,10,10],true);', 'v1');
    // Paint the current part — now it has unsaved changes.
    pw.paintFaces({ triangleIds: [0, 1, 2, 3], color: [1, 0, 0], name: 'red' });
  });

  await openExportSTL(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('last saved version');
  await expect(dialog.getByRole('button', { name: 'Save…' })).toBeVisible();
});

// Untouched, never-saved "+" parts (status 'empty') are flagged too: a
// multi-part export skips them entirely (they have no saved version), so the
// user wants to be warned about them before exporting.
test('export warns about untouched, never-saved parts', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(async () => {
    const pw = (window as any).partwright;
    await pw.createSession('EmptyParts');
    // Save the first part so there's at least one exportable part.
    await pw.runAndSave('const {Manifold}=api; return Manifold.cube([10,10,10],true);', 'v1');
  });
  // Add 3 brand-new parts via the + button, no edits → untouched starters.
  // "+" is fire-and-forget, so poll the part count instead of sleeping.
  for (let i = 0; i < 3; i++) {
    await page.locator('#btn-add-part').click();
    await waitFor(
      () => page.evaluate((n) => (window as any).partwright.listParts().length === n, i + 2),
      { timeout: 10_000, message: `${i + 2} parts to exist` },
    );
  }
  // Switch back to the first (saved) part so the new ones are non-current
  // empties. changePart() is awaited fully, so no extra settle margin.
  await page.evaluate(async () => {
    const pw = (window as any).partwright;
    await pw.changePart(pw.listParts()[0].id);
  });

  await openExportSTL(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('never saved are skipped');
  await expect(dialog.getByRole('button', { name: 'Save…' })).toBeVisible();
});
