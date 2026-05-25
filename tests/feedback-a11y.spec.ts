// Feedback + accessibility polish:
//  - export actions surface a success toast
//  - the status indicator is an ARIA live region
//  - modalShell dialogs expose dialog semantics and trap Tab focus

import { test, expect } from 'playwright/test';
import { openAiPanel } from './helpers/aiPanel';

async function openEditor(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
}

test.describe('feedback + a11y', () => {
  test('exporting surfaces a success toast', async ({ page }) => {
    await openEditor(page);
    await page.click('#btn-export');
    await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();
    await expect(
      page.locator('div[role="status"]').filter({ hasText: /Exported .*\.stl/ }),
    ).toBeVisible();
  });

  test('the status indicator is an ARIA live region', async ({ page }) => {
    await openEditor(page);
    const status = page.locator('#status-indicator');
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
  });

  test('modal dialogs expose dialog semantics and trap Tab focus', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', new Date().toISOString()); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);
    await openAiPanel(page);
    // The panel CTA opens the AI Settings modal (a modalShell dialog).
    await page.locator('#ai-panel button:has-text("Connect an AI agent")').dispatchEvent('click');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // Focus lands inside the dialog on open.
    await expect.poll(() => page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && d.contains(document.activeElement);
    })).toBe(true);

    // Tabbing repeatedly keeps focus trapped inside the dialog.
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return !!d && d.contains(document.activeElement);
    })).toBe(true);
  });
});
