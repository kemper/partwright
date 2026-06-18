// E2E for the multi-part save flow. When two or more parts in a session carry
// unsaved changes, the save action (Cmd/Ctrl+S or the 💾 button) opens a modal
// listing every unsaved part — pre-checked, in rail order, current part called
// out — and lets the user save just the current part or a selected subset.
//
// Unsaved-on-a-non-current-part arises when a part is edited and the active
// part is then changed WITHOUT the rail's auto-save-on-switch — i.e. the
// programmatic `changePart` API (how AI-driven multi-part editing switches
// parts). We use that here to set up several genuinely-unsaved parts.

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

async function typeCode(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 3 });
}

// Blur the editor to fire its onBlur autosave (persists the per-part draft).
async function flushDraft(page: Page) {
  await page.locator('.cm-content').blur();
  await page.waitForTimeout(500);
}

async function saveShortcut(page: Page) {
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(700);
}

/** Build a session with three parts, each saved at v1, then leave all three
 *  with unsaved edits (two via stashed drafts, one live on the current part).
 *  Returns the part ids in rail order. */
async function setupThreeUnsavedParts(page: Page) {
  await page.evaluate(() => (window as any).partwright.createSession('SaveAllSpec'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.cube([10,10,10],true);');
  await flushDraft(page);
  await saveShortcut(page);

  await page.evaluate(() => (window as any).partwright.createPart('Bracket'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(6,32);');
  await flushDraft(page);
  await saveShortcut(page);

  await page.evaluate(() => (window as any).partwright.createPart('Spacer'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.cylinder(8,4);');
  await flushDraft(page);
  await saveShortcut(page);

  const ids = await page.evaluate(() =>
    (window as any).partwright.listParts().map((p: any) => ({ id: p.id, name: p.name })));
  const [p1, p2] = ids;

  // Dirty Spacer (current), persist its draft, then programmatically switch
  // (no auto-save) → Spacer stays unsaved.
  await typeCode(page, 'const {Manifold}=api; return Manifold.cylinder(9,5); // edit');
  await flushDraft(page);
  await page.evaluate((id) => (window as any).partwright.changePart(id), p2.id);
  await page.waitForTimeout(500);

  // Dirty Bracket, persist, switch to Part 1 → Bracket stays unsaved.
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(7,32); // edit');
  await flushDraft(page);
  await page.evaluate((id) => (window as any).partwright.changePart(id), p1.id);
  await page.waitForTimeout(500);

  // Dirty Part 1 (now current) — left live, unsaved.
  await typeCode(page, 'const {Manifold}=api; return Manifold.cube([12,12,12],true); // edit');
  await page.waitForTimeout(300);

  return ids;
}

test.describe('Multi-part save', () => {
  test('Cmd+S with several unsaved parts opens the save modal, current part called out', async ({ page }) => {
    await openEditor(page);
    await setupThreeUnsavedParts(page);

    await page.keyboard.press('ControlOrMeta+s');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog).toContainText('3 parts have unsaved changes');
    await expect(dialog).toContainText('Current part');
    // All three unsaved parts are listed.
    for (const name of ['Part 1', 'Bracket', 'Spacer']) {
      await expect(dialog.getByText(name, { exact: true })).toBeVisible();
    }
    // Every checkbox starts checked.
    const boxes = dialog.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(boxes.nth(i)).toBeChecked();
  });

  test('"Save all" commits a new version for every unsaved part', async ({ page }) => {
    await openEditor(page);
    await setupThreeUnsavedParts(page);

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Save all' }).click();
    await page.waitForTimeout(2500);

    const counts = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      const out: Record<string, number> = {};
      for (const p of pw.listParts()) {
        await pw.changePart(p.id);
        out[p.name] = (await pw.listVersions()).length;
      }
      return out;
    });
    expect(counts['Part 1']).toBe(2);
    expect(counts['Bracket']).toBe(2);
    expect(counts['Spacer']).toBe(2);
  });

  test('parts built via the "+" button without saving are detected as unsaved', async ({ page }) => {
    await openEditor(page);
    // Mirror the real workflow: type a part, click "+", type the next, etc.
    // The "+" path does not auto-save, so each prior part stays unsaved.
    await page.evaluate(() => (window as any).partwright.createSession('PlusFlow'));
    await typeCode(page, 'const {Manifold}=api; return Manifold.cube([10,10,10],true); // one');
    await page.locator('#btn-add-part').click();
    await page.waitForTimeout(500);
    await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(6,32); // two');
    await page.locator('#btn-add-part').click();
    await page.waitForTimeout(500);
    await typeCode(page, 'const {Manifold}=api; return Manifold.cylinder(8,4); // three');
    await page.waitForTimeout(300);

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // All three never-saved-but-edited parts should be offered.
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(3);

    await dialog.getByRole('button', { name: 'Save all' }).click();
    await page.waitForTimeout(2500);
    const counts = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      const out: number[] = [];
      for (const p of pw.listParts()) {
        await pw.changePart(p.id);
        out.push((await pw.listVersions()).length);
      }
      return out;
    });
    // Every part now has its first committed version.
    expect(counts).toEqual([1, 1, 1]);
  });

  test('parts created via "+" with no edits show "no changes yet" and are saveable', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => (window as any).partwright.createSession('EmptyParts'));
    // Create 4 more parts via the "+" button without editing anything.
    for (let i = 0; i < 4; i++) {
      await page.locator('#btn-add-part').click();
      await page.waitForTimeout(400);
    }

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // 5 parts (initial + 4), none ever committed → all offered.
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(5);
    // …and every one is flagged "no changes yet".
    await expect(dialog.getByText('no changes yet')).toHaveCount(5);

    await dialog.getByRole('button', { name: 'Save all' }).click();
    await page.waitForTimeout(3000);
    const counts = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      const out: number[] = [];
      for (const p of pw.listParts()) {
        await pw.changePart(p.id);
        out.push((await pw.listVersions()).length);
      }
      return out;
    });
    expect(counts).toEqual([1, 1, 1, 1, 1]);
  });

  test('"Save current part only" saves just the current part', async ({ page }) => {
    await openEditor(page);
    await setupThreeUnsavedParts(page);

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Save current part only' }).click();
    await page.waitForTimeout(1500);

    const counts = await page.evaluate(async () => {
      const pw = (window as any).partwright;
      const out: Record<string, number> = {};
      for (const p of pw.listParts()) {
        await pw.changePart(p.id);
        out[p.name] = (await pw.listVersions()).length;
      }
      return out;
    });
    // Only Part 1 (the current part) gained a version; the others stay at v1.
    expect(counts['Part 1']).toBe(2);
    expect(counts['Bracket']).toBe(1);
    expect(counts['Spacer']).toBe(1);
  });
});
