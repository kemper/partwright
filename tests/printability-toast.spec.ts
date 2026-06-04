// The disconnected-components printability warning surfaces as a transient
// toast (recorded in the Diagnostic Log) rather than the persistent viewport
// pill. This covers the golden path: run a multi-component model, see the
// bottom-center toast, confirm it landed in the Diagnostic Log, and confirm the
// pill does NOT carry the disconnected-components text.

import { test, expect, type Page } from 'playwright/test';

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
};

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// Two non-overlapping cubes → 2 disconnected components.
const TWO_COMPONENTS =
  'const { Manifold } = api; return Manifold.cube([5,5,5], true).add(Manifold.cube([5,5,5], true).translate([40,0,0]));';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Disconnected-components toast', () => {
  test('multi-component run toasts the warning and records it; pill stays clear', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async (c) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('disconnected-toast');
      await pw.run(c);
    }, TWO_COMPONENTS);

    // Transient toast (bottom-center role=status) carries the warning.
    const toast = page.locator('[role="status"]', { hasText: 'disconnected components' });
    await expect(toast).toBeVisible({ timeout: 5000 });

    // The persistent printability pill must NOT show the disconnected text.
    const pillText = await page.evaluate(() => {
      const el = document.querySelector('span.cursor-help') as HTMLElement | null;
      return el && el.style.display !== 'none' ? (el.textContent ?? '') : '';
    });
    expect(pillText).not.toContain('disconnected');

    // It was mirrored into the Diagnostic Log like every other toast.
    await page.click('#btn-diagnostics');
    const panel = page.locator('#diagnostics-panel');
    await expect(panel).toBeVisible();
    const row = panel.locator('div.border-b', { hasText: 'disconnected components' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('● WARN')).toBeVisible();
  });
});
