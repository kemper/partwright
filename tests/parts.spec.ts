// E2E coverage for multi-part sessions: a session can hold several parts, each
// with its own code and independent version history. Verifies the console API,
// the session-bar part switcher, and that parts survive a reload (persistence +
// the lazy parts migration). Network-free — all geometry is produced locally.

import { test, expect, type Page } from 'playwright/test';

interface PartsAPI {
  createSession: (name?: string) => Promise<{ id: string }>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  getCode: () => string;
  setCode: (code: string) => void;
  createPart: (name?: string) => Promise<{ id: string; name: string } | { error: string }>;
  changePart: (target: string | { id?: string; name?: string }) => Promise<unknown>;
  listParts: () => { id: string; name: string; order: number; isCurrent: boolean }[];
  listVersions: () => Promise<{ index: number; label: string }[]>;
  getSessionState: () => { currentPart: { id: string; name: string } | null; versionCount: number };
  paintFaces: (o: { triangleIds: number[]; color: [number, number, number]; name?: string }) => unknown;
  listRegions: () => unknown[];
}

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createPart?: unknown } }).partwright?.createPart,
    { timeout: 20_000 },
  );
}

const cube = (s: number, marker: string) =>
  `// ${marker}\nconst { Manifold } = api; return Manifold.cube([${s}, ${s}, ${s}], true);`;

test.describe('Multi-part sessions', () => {
  // Suppress the first-visit guided tour so its backdrop doesn't intercept clicks.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('parts carry independent code and version history', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const result = await page.evaluate(async ({ codeA1, codeA2, codeB1 }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('multi');
      // Part 1 (default): two versions.
      await pw.runAndSave(codeA1, 'a1');
      await pw.runAndSave(codeA2, 'a2');

      // A second part with its own single version.
      const made = await pw.createPart('Lid');
      const lidVersionsBeforeSave = (await pw.listVersions()).length; // fresh part: 0
      await pw.runAndSave(codeB1, 'b1');

      const partsAfter = pw.listParts();
      const lidVersions = (await pw.listVersions()).length;

      // Switch back to the first part and confirm its history is intact and
      // the editor shows its code, not the lid's.
      const first = partsAfter.find(p => p.name !== 'Lid')!;
      await pw.changePart(first.id);
      const firstVersions = (await pw.listVersions()).length;
      const firstCode = pw.getCode();

      return {
        madeOk: !('error' in made),
        partCount: partsAfter.length,
        partNames: partsAfter.map(p => p.name),
        lidVersionsBeforeSave,
        lidVersions,
        firstVersions,
        firstCodeHasA2: firstCode.includes('A2'),
        firstCodeHasLid: firstCode.includes('LID'),
      };
    }, { codeA1: cube(10, 'A1'), codeA2: cube(12, 'A2'), codeB1: cube(6, 'LID') });

    expect(result.madeOk).toBe(true);
    expect(result.partCount).toBe(2);
    expect(result.partNames).toContain('Lid');
    expect(result.lidVersionsBeforeSave).toBe(0);   // a new part starts empty
    expect(result.lidVersions).toBe(1);             // independent history
    expect(result.firstVersions).toBe(2);           // first part untouched
    expect(result.firstCodeHasA2).toBe(true);       // editor restored first part's latest
    expect(result.firstCodeHasLid).toBe(false);
  });

  test('parts persist across a reload', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const sessionId = await page.evaluate(async ({ codeA1, codeB1 }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      const s = await pw.createSession('persist');
      await pw.runAndSave(codeA1, 'a1');
      await pw.createPart('Handle');
      await pw.runAndSave(codeB1, 'b1');
      return s.id;
    }, { codeA1: cube(10, 'A1'), codeB1: cube(6, 'HANDLE') });

    // Reload by URL — bootstrap must re-open the session and its parts.
    await page.goto(`/editor?session=${sessionId}`);
    await waitForEngine(page);

    const after = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      return { parts: pw.listParts().map(p => p.name).sort() };
    });
    expect(after.parts).toEqual(['Handle', 'Part 1']);
  });

  test('parts rail renders, switches, and adds parts; editor title shows the part', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async ({ codeA1, codeB1 }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('switcher');
      await pw.runAndSave(codeA1, 'a1');
      await pw.createPart('Lid');
      await pw.runAndSave(codeB1, 'b1');
    }, { codeA1: cube(10, 'A1'), codeB1: cube(6, 'LID') });

    // The rail lists both parts; the editor title shows the current one (Lid).
    const list = page.locator('#parts-list');
    await expect(list.locator('[data-part-id]')).toHaveCount(2);
    await expect(page.locator('#editor-title')).toHaveText('Lid');

    // Click "Part 1" in the rail to switch; editor + title update.
    await list.getByText('Part 1', { exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { partwright: PartsAPI }).partwright.getCode()))
      .toContain('A1');
    await expect(page.locator('#editor-title')).toHaveText('Part 1');

    // The add-part button (rail header) increases the part count.
    await page.locator('#btn-add-part').click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { partwright: PartsAPI }).partwright.listParts().length))
      .toBe(3);
  });

  test('each part row shows a geometry preview thumbnail', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async ({ codeA1, codeB1 }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('previews');
      await pw.runAndSave(codeA1, 'a1');   // Part 1 gets a saved version (+thumbnail)
      await pw.createPart('Lid');
      await pw.runAndSave(codeB1, 'b1');   // Lid (now current) gets its own
    }, { codeA1: cube(10, 'A1'), codeB1: cube(6, 'LID') });

    const list = page.locator('#parts-list');
    await expect(list.locator('[data-part-id]')).toHaveCount(2);

    // Both rows render an <img> preview in their thumbnail slot: the current part
    // (Lid) is painted synchronously from in-memory state, the other (Part 1) via
    // the cached async fetch. toHaveCount auto-waits for the async paint to land.
    const thumbs = list.locator('[data-part-id] [data-thumb] img');
    await expect(thumbs).toHaveCount(2);
    const srcs = await thumbs.evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
    for (const src of srcs) expect(src).toMatch(/^blob:/);
  });

  test('parts can be drag-reordered in the rail', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async ({ code }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('reorder');
      await pw.runAndSave(code, 'a1');     // Part 1
      await pw.createPart('Beta');
      await pw.createPart('Gamma');
    }, { code: cube(10, 'A1') });

    const list = page.locator('#parts-list');
    await expect(list.locator('[data-part-id]')).toHaveCount(3);
    // Initial order: Part 1, Beta, Gamma.
    const initial = await page.evaluate(() =>
      (window as unknown as { partwright: PartsAPI }).partwright.listParts().map(p => p.name));
    expect(initial).toEqual(['Part 1', 'Beta', 'Gamma']);

    // Drag the first row's grip below the last row.
    const firstGrip = list.locator('[data-part-id]').first().locator('[title="Drag to reorder"]');
    const lastRow = list.locator('[data-part-id]').last();
    const g = await firstGrip.boundingBox();
    const l = await lastRow.boundingBox();
    if (!g || !l) throw new Error('missing drag boxes');
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(l.x + l.width / 2, l.y + l.height + 6, { steps: 10 });
    await page.mouse.up();

    // Part 1 should now be last; order persists in state.
    await expect
      .poll(() => page.evaluate(() =>
        (window as unknown as { partwright: PartsAPI }).partwright.listParts().map(p => p.name)))
      .toEqual(['Beta', 'Gamma', 'Part 1']);
  });

  test('adding a part after painting clears stale regions and unlocks the editor', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async ({ code }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('paint-part');
      await pw.runAndSave(code, 'base');
      pw.paintFaces({ triangleIds: [0, 1, 2], color: [1, 0, 0], name: 'A' });
    }, { code: cube(10, 'BASE') });

    // Painting locks the editor (banner shown) and registers one region.
    await expect(page.locator('#editor-lock-overlay')).toBeVisible();

    // Adding a part must NOT carry the previous part's regions, and must leave
    // the new part's editor unlocked (regression: stale module-state colors).
    const regionCount = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createPart('Fresh');
      return pw.listRegions().length;
    });
    expect(regionCount).toBe(0);
    await expect(page.locator('#editor-lock-overlay')).toHaveCount(0);
  });

  test('multi-select bulk-deletes parts from the rail', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async ({ code }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('bulk');
      await pw.runAndSave(code, 'a1');     // Part 1
      await pw.createPart('Beta');
      await pw.createPart('Gamma');        // becomes the current part
    }, { code: cube(10, 'A1') });

    const list = page.locator('#parts-list');
    await expect(list.locator('[data-part-id]')).toHaveCount(3);
    // No bulk-action bar until at least one part is checked.
    await expect(page.locator('#parts-bulk-actions')).toHaveCount(0);

    const checkbox = (name: string) =>
      list.locator('[data-part-id]', { hasText: name }).locator('input[type="checkbox"]');
    await checkbox('Beta').click();
    await checkbox('Gamma').click();

    // The footer reports the count and offers a matching delete.
    const bar = page.locator('#parts-bulk-actions');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('2 selected');
    const delBtn = page.locator('#btn-delete-parts');
    await expect(delBtn).toHaveText('Delete 2');
    await expect(delBtn).toBeEnabled();

    // Confirm and delete; the current part (Gamma) was selected, so the active
    // part must fall back to a survivor and the editor title follows.
    page.once('dialog', d => d.accept());
    await delBtn.click();

    await expect
      .poll(() => page.evaluate(() =>
        (window as unknown as { partwright: PartsAPI }).partwright.listParts().map(p => p.name)))
      .toEqual(['Part 1']);
    await expect(page.locator('#parts-bulk-actions')).toHaveCount(0);
    await expect(page.locator('#editor-title')).toHaveText('Part 1');
  });

  test('bulk delete refuses to remove every part', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async ({ code }) => {
      const pw = (window as unknown as { partwright: PartsAPI }).partwright;
      await pw.createSession('guard');
      await pw.runAndSave(code, 'a1');
      await pw.createPart('Beta');
    }, { code: cube(10, 'A1') });

    const list = page.locator('#parts-list');
    await expect(list.locator('[data-part-id]')).toHaveCount(2);

    // Selecting every part disables delete — a session must keep one.
    for (const row of await list.locator('[data-part-id]').all()) {
      await row.locator('input[type="checkbox"]').click();
    }
    const delBtn = page.locator('#btn-delete-parts');
    await expect(delBtn).toHaveText('Delete 2');
    await expect(delBtn).toBeDisabled();
  });
});
