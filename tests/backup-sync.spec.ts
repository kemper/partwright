import { test, expect } from 'playwright/test';

// Golden path for the Backup & sync feature: the Export menu opens the modal,
// which shows both targets. Drive reports "not configured" when no client id is
// wired into the build (the default), proving the graceful-degradation path.

test.describe('Backup & sync', () => {
  test('Export menu opens the sync modal with both targets', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', 'x'));
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, {
      timeout: 30000,
    });

    // Open via the real toolbar path: Export dropdown → Backup & sync…
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByText('Backup & sync…').click();

    const heading = page.getByText('Backup & sync', { exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByText('Local folder', { exact: true })).toBeVisible();
    await expect(page.getByText('Google Drive', { exact: true })).toBeVisible();

    // With no VITE_GOOGLE_CLIENT_ID set, Drive is reported unavailable.
    await expect(page.getByText(/Google Drive sync isn.t configured/)).toBeVisible();

    // The full-snapshot action is present.
    await expect(page.getByRole('button', { name: 'Back up all sessions now' })).toBeVisible();
  });

  test('console API exposes sync status for both targets', async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, {
      timeout: 30000,
    });
    const status = await page.evaluate(() =>
      (window as unknown as { partwright: { syncStatus: () => Record<string, { phase: string }> } }).partwright.syncStatus(),
    );
    expect(status.local.phase).toBe('disconnected');
    expect(status.drive.phase).toBe('disconnected');
  });
});
