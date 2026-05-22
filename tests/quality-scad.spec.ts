import { test, expect } from 'playwright/test';

// Verifies the OpenSCAD engine seeds $fn from the curve-quality preset. We run a
// tiny sphere in SCAD under two presets and compare triangle counts. The preset
// lives in the viewport Mesh popover, so we use the interactive editor (where
// the overlay is visible) and dismiss the onboarding tour.

type RunResult = { triangleCount?: number; error?: string };
type PartwrightApi = { run: (code: string) => Promise<RunResult> };

const scadCode = 'sphere(5);';

test('SCAD engine applies the chosen $fn from quality preset', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  page.on('dialog', (d) => d.accept());

  await page.goto('/editor');
  await page.waitForSelector('#mesh-settings-toggle');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );

  // Switch to SCAD via the language toggle (auto-accept any confirm dialog).
  await page.locator('#lang-toggle button:has-text("SCAD")').click();
  await page.waitForTimeout(2000); // SCAD WASM spin-up

  const runScad = () =>
    page.evaluate((code) => {
      const api = (window as unknown as { partwright: PartwrightApi }).partwright;
      return api.run(code);
    }, scadCode);

  // Very High (default) — many triangles.
  const high = await runScad();
  expect(high.error).toBeFalsy();
  expect(high.triangleCount ?? 0).toBeGreaterThan(2000);

  // Drop to Low via the Mesh popover and re-run.
  await page.locator('#mesh-settings-toggle').click();
  await page.locator('#mesh-settings-panel [data-quality="low"]').click();

  const low = await runScad();
  expect(low.error).toBeFalsy();
  expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
  expect(low.triangleCount ?? 0).toBeGreaterThan(0);
});
