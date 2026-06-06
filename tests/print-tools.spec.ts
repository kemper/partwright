// End-to-end tests for the print-readiness feature:
//   - checkPrintability reports bed fit on small vs oversized models
//   - the 🖨 Print overlay panel opens (mounted in the Inspect popover) and
//     renders a report
//
// Scaling and splitting live in their own dedicated tools and have their own
// tests.

import { test, expect, type Page } from 'playwright/test';

type Geo = { volume?: number; triangleCount?: number; isManifold?: boolean; boundingBox?: { dimensions?: [number, number, number] } };
type PW = {
  run: (code: string) => Promise<Geo>;
  getGeometryData: () => Geo;
  checkPrintability: (opts?: unknown) => { ok?: boolean; bedFit?: { fits: boolean }; checks?: { id: string; level: string }[]; error?: string };
};

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { checkPrintability?: unknown } }).partwright?.checkPrintability,
    { timeout: 20_000 },
  );
}

async function openEditor(page: Page) {
  await page.goto('/editor');
  await waitForEngine(page);
}

test.describe('Print tools', () => {
  test('checkPrintability reports bed fit for small vs oversized models', async ({ page }) => {
    await openEditor(page);
    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.cube([20,20,20], true).translate([0,0,10]);');
      const small = pw.checkPrintability();
      await pw.run('const { Manifold } = api; return Manifold.cube([300,300,300], true).translate([0,0,150]);');
      const big = pw.checkPrintability();
      return { small, big };
    });
    expect(result.small.bedFit?.fits).toBe(true);
    expect(result.small.ok).toBe(true);
    expect(result.big.bedFit?.fits).toBe(false);
    expect(result.big.checks?.find(c => c.id === 'bed')?.level).toBe('fail');
  });

  test('the Print panel opens (mounted in Inspect) and renders a printability report', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.run('const { Manifold } = api; return Manifold.cube([20,20,20], true).translate([0,0,10]);');
    });

    // Print is a read-only Inspect tool — its button lives inside the Inspect
    // popover menu alongside Measure and Cross-section.
    await expect(page.locator('#viewport-inspect-menu #print-tools-toggle')).toHaveCount(1);

    await page.locator('#print-tools-toggle').dispatchEvent('click');
    await page.waitForSelector('#print-tools-panel:not(.hidden)');
    await expect(page.locator('#print-check-btn')).toBeVisible();

    await page.locator('#print-check-btn').dispatchEvent('click');
    // The report lists individual checks — the watertight one always renders.
    await expect(page.locator('#print-report')).toContainText(/Watertight|print-ready|Printable|blocker/i, { timeout: 10_000 });
  });

  test('the Print panel follows the shared chrome — × close button and Escape close', async ({ page }) => {
    await openEditor(page);
    await page.locator('#print-tools-toggle').dispatchEvent('click');
    await page.waitForSelector('#print-tools-panel:not(.hidden)');

    // Header has a × close button with the standard aria-label.
    const closeBtn = page.locator('#print-tools-close');
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toHaveAttribute('aria-label', /close/i);

    // Clicking × closes the panel.
    await closeBtn.dispatchEvent('click');
    await expect(page.locator('#print-tools-panel')).toHaveClass(/hidden/);

    // Re-open and press Escape — also closes.
    await page.locator('#print-tools-toggle').dispatchEvent('click');
    await page.waitForSelector('#print-tools-panel:not(.hidden)');
    await page.keyboard.press('Escape');
    await expect(page.locator('#print-tools-panel')).toHaveClass(/hidden/);
  });
});
