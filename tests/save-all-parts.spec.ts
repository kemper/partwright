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

async function typeCode(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 3 });
}

// Blur the editor to fire its onBlur autosave (persists the per-part draft),
// then poll IndexedDB (via sessionManager.readDraft, the same reader the app's
// part-switch/reload paths use) until the draft actually carries the typed
// code — the real completion signal for an async, fire-and-forget autosave.
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

// Cmd/Ctrl+S's onSave handler is fire-and-forget (see keyboardShortcuts.ts), so
// poll the current part's version count instead of sleeping past a guess.
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

/** Build a session with three parts, each saved at v1, then leave all three
 *  with unsaved edits (two via stashed drafts, one live on the current part).
 *  Returns the part ids in rail order. */
async function setupThreeUnsavedParts(page: Page) {
  await page.evaluate(() => (window as any).partwright.createSession('SaveAllSpec'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.cube([10,10,10],true);');
  await flushDraft(page, 'cube([10,10,10]');
  await saveShortcut(page, 1);

  await page.evaluate(() => (window as any).partwright.createPart('Bracket'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(6,32);');
  await flushDraft(page, 'sphere(6,32)');
  await saveShortcut(page, 1);

  await page.evaluate(() => (window as any).partwright.createPart('Spacer'));
  await typeCode(page, 'const {Manifold}=api; return Manifold.cylinder(8,4);');
  await flushDraft(page, 'cylinder(8,4)');
  await saveShortcut(page, 1);

  const ids = await page.evaluate(() =>
    (window as any).partwright.listParts().map((p: any) => ({ id: p.id, name: p.name })));
  const [p1, p2] = ids;

  // Dirty Spacer (current), persist its draft, then programmatically switch
  // (no auto-save) → Spacer stays unsaved. changePart() is awaited fully by
  // the evaluate() call below (it resolves only once the target part's
  // version is loaded into the editor), so no extra settle margin is needed.
  await typeCode(page, 'const {Manifold}=api; return Manifold.cylinder(9,5); // edit');
  await flushDraft(page, 'cylinder(9,5)');
  await page.evaluate((id) => (window as any).partwright.changePart(id), p2.id);

  // Dirty Bracket, persist, switch to Part 1 → Bracket stays unsaved.
  await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(7,32); // edit');
  await flushDraft(page, 'sphere(7,32)');
  await page.evaluate((id) => (window as any).partwright.changePart(id), p1.id);

  // Dirty Part 1 (now current) — left live, unsaved. CodeMirror's docChanged
  // listener (which drives the "unsaved" comparison against getValue()) fires
  // synchronously inside keyboard.type(), so no extra wait is needed here.
  await typeCode(page, 'const {Manifold}=api; return Manifold.cube([12,12,12],true); // edit');

  return ids;
}

/** Read every part's version count via `db.ts`'s `listVersions(partId)` — a
 *  direct, read-only IndexedDB read with no side effects. Deliberately does
 *  NOT use `partwright.changePart()`/`listVersions()` to inspect a
 *  non-current part: `saveSelectedParts` (behind "Save all" / "Save
 *  selected") itself calls `selectPart()` per part in the background after
 *  the modal already closed, and switching the active part from a concurrent
 *  poll races with — and corrupts — that in-flight save loop. */
async function readVersionCountsByName(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const pw = (window as any).partwright;
    const db = await import('/src/storage/db.ts');
    const out: Record<string, number> = {};
    for (const p of pw.listParts()) {
      out[p.name] = (await db.listVersions(p.id)).length;
    }
    return out;
  });
}

/** Poll every part's version count against `expected` — the same walk the
 *  tests below already do to assert the outcome, just polled until it
 *  matches instead of sleeping a guess and sampling once. The "Save all" /
 *  "Save selected" modal actions close the modal the instant they're clicked
 *  (before the async save loop runs — see saveAllModal.ts), so there's no
 *  DOM signal for "the saves landed"; the version counts are the real one. */
async function waitForVersionCounts(page: Page, expected: Record<string, number>) {
  return waitFor(
    () => readVersionCountsByName(page).then((counts) => {
      for (const [name, n] of Object.entries(expected)) {
        if (counts[name] !== n) return null;
      }
      return counts;
    }),
    { timeout: 15_000, message: `every part to reach its expected version count (${JSON.stringify(expected)})` },
  );
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

    const counts = await waitForVersionCounts(page, { 'Part 1': 2, Bracket: 2, Spacer: 2 });
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
    await waitFor(() => page.evaluate(() => (window as any).partwright.listParts().length === 2), { timeout: 10_000, message: '2 parts to exist' });
    await typeCode(page, 'const {Manifold}=api; return Manifold.sphere(6,32); // two');
    await page.locator('#btn-add-part').click();
    await waitFor(() => page.evaluate(() => (window as any).partwright.listParts().length === 3), { timeout: 10_000, message: '3 parts to exist' });
    await typeCode(page, 'const {Manifold}=api; return Manifold.cylinder(8,4); // three');

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // All three never-saved-but-edited parts should be offered.
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(3);

    await dialog.getByRole('button', { name: 'Save all' }).click();
    const counts = await waitFor(
      () => readVersionCountsByName(page).then((c) => {
        const vals = Object.values(c);
        return vals.length === 3 && vals.every((n) => n === 1) ? vals : null;
      }),
      { timeout: 15_000, message: 'every part to reach v1' },
    );
    // Every part now has its first committed version.
    expect(counts).toEqual([1, 1, 1]);
  });

  test('parts created via "+" with no edits show "no changes yet" and are saveable', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => (window as any).partwright.createSession('EmptyParts'));
    // Create 4 more parts via the "+" button without editing anything.
    for (let i = 0; i < 4; i++) {
      await page.locator('#btn-add-part').click();
      await waitFor(
        () => page.evaluate((n) => (window as any).partwright.listParts().length === n, i + 2),
        { timeout: 10_000, message: `${i + 2} parts to exist` },
      );
    }

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // 5 parts (initial + 4), none ever committed → all offered.
    await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(5);
    // …and every one is flagged "no changes yet".
    await expect(dialog.getByText('no changes yet')).toHaveCount(5);

    await dialog.getByRole('button', { name: 'Save all' }).click();
    const counts = await waitFor(
      () => readVersionCountsByName(page).then((c) => {
        const vals = Object.values(c);
        return vals.length === 5 && vals.every((n) => n === 1) ? vals : null;
      }),
      { timeout: 15_000, message: 'every part to reach v1' },
    );
    expect(counts).toEqual([1, 1, 1, 1, 1]);
  });

  test('"Save current part only" saves just the current part', async ({ page }) => {
    await openEditor(page);
    await setupThreeUnsavedParts(page);

    await page.keyboard.press('ControlOrMeta+s');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Save current part only' }).click();

    const counts = await waitForVersionCounts(page, { 'Part 1': 2, Bracket: 1, Spacer: 1 });
    // Only Part 1 (the current part) gained a version; the others stay at v1.
    expect(counts['Part 1']).toBe(2);
    expect(counts['Bracket']).toBe(1);
    expect(counts['Spacer']).toBe(1);
  });
});
