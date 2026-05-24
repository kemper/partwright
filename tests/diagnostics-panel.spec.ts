import { test, expect } from 'playwright/test';
import { openAiPanel } from './helpers/aiPanel';

// Covers the diagnostic-log fixes:
//   1. The viewport no longer constructs THREE.Clock (deprecated in r183), so
//      no deprecation warning is emitted on editor load.
//   2. The diagnostics panel stacks above the AI drawer instead of behind it.
//   3. Every log row expands on click to reveal the full message, a precise
//      timestamp/source/level line, and the captured stack/origin trace.

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Diagnostic log', () => {
  test('no THREE.Clock deprecation warning on editor load', async ({ page }) => {
    const consoleMsgs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'warning' || msg.type() === 'error') consoleMsgs.push(msg.text());
    });

    await page.goto('/editor');
    await page.waitForSelector('#btn-ai', { timeout: 10_000 });
    // Let the viewport animation loop tick a few frames.
    await page.waitForTimeout(500);

    const clockWarnings = consoleMsgs.filter((t) => /Clock.*deprecated|THREE\.Clock/i.test(t));
    expect(clockWarnings).toEqual([]);
  });

  test('panel stacks above the AI drawer', async ({ page }) => {
    await page.goto('/editor');
    // Wait for full editor init so the click doesn't race the WASM/COI boot.
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { help?: unknown } }).partwright?.help);

    await openAiPanel(page);
    await expect(page.locator('#ai-panel')).toBeVisible();

    await page.click('#btn-diagnostics');
    await expect(page.locator('#diagnostics-panel')).toBeVisible();

    const zIndexOf = (sel: string) =>
      page.locator(sel).evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10) || 0);
    const aiZ = await zIndexOf('#ai-panel');
    const diagZ = await zIndexOf('#diagnostics-panel');
    expect(diagZ).toBeGreaterThan(aiZ);
  });

  test('clicking a row expands it to show more detail', async ({ page }) => {
    const marker = 'diagnostic-expand-test-marker';

    await page.goto('/editor');
    await page.waitForSelector('#btn-diagnostics');

    // Seed an entry through the intercepted console.warn.
    await page.evaluate((m) => console.warn(m), marker);

    await page.click('#btn-diagnostics');
    const panel = page.locator('#diagnostics-panel');
    await expect(panel).toBeVisible();

    const row = panel.locator('div.border-b', { hasText: marker }).first();
    await expect(row).toBeVisible();

    // The detail (source/level metadata) is collapsed until the row is clicked.
    const meta = row.getByText(/source:/i);
    await expect(meta).toBeHidden();

    await row.locator('div.cursor-pointer').first().click();
    await expect(meta).toBeVisible();
    await expect(meta).toContainText(/WARN/);

    // Toggling again collapses it.
    await row.locator('div.cursor-pointer').first().click();
    await expect(meta).toBeHidden();
  });
});
