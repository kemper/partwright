// E2E coverage for startup / runtime resilience UX:
//  - WebGL context loss + restore surfaces a recovery toast and the render
//    loop resumes without errors (Item 5).
//  - The low-memory notice shows on low-RAM devices, is dismissible, and stays
//    dismissed across reloads; high-RAM devices never see it (Item 8).
// Runs with no external network.

import { test, expect, type Page } from 'playwright/test';

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('WebGL context loss', () => {
  test('loss then restore surfaces a recovery toast and resumes cleanly', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await openEditor(page);

    // Force a context loss via the standard debug extension, then restore it.
    const ok = await page.evaluate(() => {
      const canvas = document.getElementById('viewport') as HTMLCanvasElement | null;
      const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext();
      // The browser fires 'lost' asynchronously; restore shortly after.
      setTimeout(() => ext.restoreContext(), 150);
      return true;
    });
    expect(ok).toBe(true);

    // The loss toast appears, then the recovery toast.
    await expect(page.getByText('graphics context was lost')).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('3D view recovered')).toBeVisible({ timeout: 8000 });

    // No uncaught console errors from the loss/restore cycle (the deliberate
    // GL "context lost" info messages are not errors).
    const fatal = consoleErrors.filter((t) => !/WebGL.*context/i.test(t));
    expect(fatal).toEqual([]);
  });
});

test.describe('Low-memory notice', () => {
  test('shows on a low-RAM device, dismisses, and stays dismissed across reload', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 4 });
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });

    const notice = page.locator('#lowmem-notice');
    await expect(notice).toBeVisible({ timeout: 10_000 });
    await expect(notice).toContainText('4 GB');

    await notice.getByRole('button', { name: /Dismiss/i }).click();
    await expect(notice).toHaveCount(0);

    // The dismissal persists — a reload (same context → same localStorage)
    // must not bring it back.
    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 20_000 });
    await expect(page.locator('#lowmem-notice')).toHaveCount(0);
  });

  test('does not show on a high-RAM device', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, get: () => 8 });
    });
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 20_000 });
    // Give the editor a beat to finish init, then assert the notice is absent.
    await page.waitForTimeout(500);
    await expect(page.locator('#lowmem-notice')).toHaveCount(0);
  });
});
