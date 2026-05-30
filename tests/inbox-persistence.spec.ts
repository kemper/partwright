// The Recent Imports / Recent Exports lists used to be in-memory only, so a
// page refresh wiped them. They're now mirrored to IndexedDB and rehydrated on
// boot. These tests import / export something, reload the page, and assert the
// entry is still there (and, for exports, still re-downloadable from its
// persisted Blob).

import { test, expect } from 'playwright/test';

/** Wait until the console API is attached (`window.partwright.run` exists). */
async function waitForApp(page: import('playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('recent imports/exports persist across reload', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the guided tour so its backdrop can't intercept toolbar clicks.
    // addInitScript re-runs on reload, so the suppression survives the refresh.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForApp(page);
  });

  test('Recent Imports survive a page refresh', async ({ page }) => {
    // Import a small PNG through the shared file input → voxel modal → commit.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const x = c.getContext('2d')!;
      x.fillStyle = '#3399ff'; x.fillRect(0, 0, 8, 8);
      return c.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    await page.locator('#import-wrapper input[type="file"]').first()
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer });

    await expect(page.getByText('Image → Voxel', { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    // It lands in Recent Imports.
    await page.locator('#btn-import').click();
    await expect(page.locator('#import-recent-list button', { hasText: 'logo.png' }).first())
      .toBeVisible({ timeout: 10_000 });

    // Refresh — the in-memory inbox is gone, so this only passes if it
    // rehydrated from IndexedDB.
    await page.reload();
    await waitForApp(page);

    await page.locator('#btn-import').click();
    await expect(page.locator('#import-recent-list button', { hasText: 'logo.png' }).first())
      .toBeVisible({ timeout: 10_000 });
  });

  test('Recent Exports survive a page refresh and stay re-downloadable', async ({ page }) => {
    // Swallow the browser downloads the export triggers so nothing hangs.
    page.on('download', (d) => { void d.path().catch(() => {}); });

    // The starter part renders a box; wait for the engine to be Ready so
    // exportSTL has a current mesh to serialize.
    await page.waitForSelector('text=Ready', { timeout: 30_000 });

    // Trigger an STL export; retry until the inbox records it (guards against a
    // race where the first call lands before the initial mesh is set). The
    // hidden list's children update on every inbox change, so counting them
    // works without opening the dropdown.
    await expect.poll(async () => {
      if (await page.locator('#export-recent-list button').count() === 0) {
        await page.evaluate(() => {
          (window as unknown as { partwright?: { exportSTL?: () => void } }).partwright?.exportSTL?.();
        });
      }
      return page.locator('#export-recent-list button').count();
    }, { timeout: 20_000 }).toBeGreaterThan(0);

    await page.locator('#btn-export').click();
    const before = page.locator('#export-recent-list button', { hasText: 'STL' }).first();
    await expect(before).toBeVisible({ timeout: 10_000 });

    // Refresh and confirm the export is still listed.
    await page.reload();
    await waitForApp(page);

    await page.locator('#btn-export').click();
    const after = page.locator('#export-recent-list button', { hasText: 'STL' }).first();
    await expect(after).toBeVisible({ timeout: 10_000 });

    // The persisted Blob is intact: re-clicking the entry re-downloads it.
    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await after.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.stl$/i);
  });
});
