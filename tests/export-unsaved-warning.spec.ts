// E2E for the "unsaved parts" export warning. A multi-part export bakes each
// non-current part from its last SAVED version, so unsaved edits (fresh paint
// especially) silently drop out. The pre-export confirm modal now flags unsaved
// non-current parts and offers a Save shortcut (routing to the same save flow as
// Cmd/Ctrl+S). Drives the UI, since the confirm modal gates only the UI path.

import { test, expect, type Page } from 'playwright/test';
/* eslint-disable @typescript-eslint/no-explicit-any */

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('partwright-tour-completed', '1');
      localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false }));
      localStorage.setItem('partwright-units', 'mm'); // silence the unitless warning
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
async function flushDraft(page: Page) { await page.locator('.cm-content').blur(); await page.waitForTimeout(500); }

// Build: Part 1 saved (current), Part "Widget" left unsaved + non-current.
async function setup(page: Page) {
  await page.evaluate(() => (window as any).partwright.createSession('ExportUnsaved'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.cube([10,10,10],true);');
  await flushDraft(page);
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(700);

  await page.evaluate(() => (window as any).partwright.createPart('Widget'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(6,32);');
  await flushDraft(page);
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(700);

  // Dirty Widget, persist its draft, then switch back to Part 1 (no auto-save)
  // → Widget is now a NON-current part with unsaved changes.
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(8,32); // edit');
  await flushDraft(page);
  const p1 = await page.evaluate(() => (window as any).partwright.listParts()[0].id);
  await page.evaluate((id) => (window as any).partwright.changePart(id), p1);
  await page.waitForTimeout(600);
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
  const widgetVersionsBefore = await page.evaluate(async () => {
    const pw = (window as any).partwright;
    const db = await import('/src/storage/db.ts');
    const w = pw.listParts().find((p: any) => p.name === 'Widget');
    return (db as any).getVersionCount(w.id);
  });

  // Clicking Save… closes the export modal and routes to the save flow. With one
  // unsaved (non-current) part it saves THAT part directly; the export does NOT
  // fire (no "Exported" toast).
  await dialog.getByRole('button', { name: 'Save…' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(2500);
  await expect(
    page.locator('div[role="status"]').filter({ hasText: /Exported/ }),
  ).toHaveCount(0);

  // The Save shortcut committed a NEW version for the unsaved Widget part.
  const widgetVersionsAfter = await page.evaluate(async () => {
    const pw = (window as any).partwright;
    const db = await import('/src/storage/db.ts');
    const w = pw.listParts().find((p: any) => p.name === 'Widget');
    return (db as any).getVersionCount(w.id);
  });
  expect(widgetVersionsAfter).toBe(widgetVersionsBefore + 1);
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
  await expect(page.getByRole('dialog').getByText(/Export parts to STL/i)).toBeVisible({ timeout: 10_000 });
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
  for (let i = 0; i < 3; i++) {
    await page.locator('#btn-add-part').click();
    await page.waitForTimeout(900);
  }
  // Switch back to the first (saved) part so the new ones are non-current empties.
  await page.evaluate(async () => {
    const pw = (window as any).partwright;
    await pw.changePart(pw.listParts()[0].id);
  });
  await page.waitForTimeout(500);

  await openExportSTL(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('never saved are skipped');
  await expect(dialog.getByRole('button', { name: 'Save…' })).toBeVisible();
});
