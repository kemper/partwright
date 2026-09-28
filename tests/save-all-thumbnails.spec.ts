// Regression: saving several freshly-created parts at once must give each part
// its OWN thumbnail — not one shared, colorless image.
//
// New parts seed a starter primitive that renders + colors itself, but the
// version-less branch of loadPartIntoEditor fired seedStarter() WITHOUT awaiting
// it. So a part switch "completed" before the starter rendered, and the Save-all
// loop's captureThumbnail() read the previous part's stale mesh — every newly
// created part got the same wrong, uncolored thumbnail. loadPartIntoEditor now
// awaits the starter render so the switch isn't done until the geometry is on
// screen.

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

test('Save-all gives each freshly-created part its own thumbnail', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => (window as any).partwright.createSession('SaveAllThumbs'));

  // Create several parts via the + button with no edits — pure starter
  // geometry. Starters rotate through distinct, self-colored primitives, so
  // each part's thumbnail should differ. "+" is fire-and-forget, so poll the
  // part count instead of sleeping past a guess.
  for (let i = 0; i < 4; i++) {
    await page.locator('#btn-add-part').click();
    await waitFor(
      () => page.evaluate((n) => (window as any).partwright.listParts().length === n, i + 2),
      { timeout: 10_000, message: `${i + 2} parts to exist` },
    );
  }

  // Save everything at once via the modal.
  await page.keyboard.press('ControlOrMeta+s');
  const dialog = page.getByRole('dialog');
  // The modal may or may not appear depending on part state; wait briefly for
  // it rather than sleeping a fixed guess before checking.
  await dialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await dialog.isVisible().catch(() => false)) {
    const saveAll = dialog.getByRole('button', { name: 'Save all' });
    if (await saveAll.isVisible().catch(() => false)) await saveAll.click();
    else await dialog.getByRole('button', { name: /save/i }).first().click();
    // The modal closes the instant the button is clicked (before the async
    // save loop runs), so poll for every part to actually gain a saved
    // version (a direct, read-only db.ts read — see save-all-parts.spec.ts
    // for why this avoids partwright.changePart()-based polling here).
    await waitFor(
      () => page.evaluate(async () => {
        const pw = (window as any).partwright;
        const db = await import('/src/storage/db.ts');
        const parts = pw.listParts();
        const counts = await Promise.all(parts.map((p: any) => (db as any).getVersionCount(p.id)));
        return counts.every((n: number) => n >= 1) ? counts : null;
      }),
      { timeout: 15_000, message: 'every part to gain a saved version' },
    );
  }

  // Hash each part's saved thumbnail bytes; rotating starters ⇒ all distinct.
  const hashes = await page.evaluate(async () => {
    const pw = (window as any).partwright;
    const db = await import('/src/storage/db.ts');
    const out: string[] = [];
    for (const p of pw.listParts()) {
      const v = await (db as any).getLatestVersion(p.id);
      const blob: Blob | null = v?.thumbnail ?? null;
      if (!blob) { out.push('none-' + p.id); continue; }
      const buf = new Uint8Array(await blob.arrayBuffer());
      let h = 0;
      for (let i = 0; i < buf.length; i++) h = (h * 31 + buf[i]) >>> 0;
      out.push(String(h));
    }
    return out;
  });

  expect(hashes.length).toBeGreaterThanOrEqual(4);
  expect(hashes.every(h => !h.startsWith('none')), `every part has a thumbnail: ${hashes.join(',')}`).toBe(true);
  // The core assertion: no two parts share a thumbnail (the bug made them equal).
  expect(new Set(hashes).size, `expected ${hashes.length} distinct thumbnails, got ${new Set(hashes).size}: ${hashes.join(',')}`).toBe(hashes.length);
});
