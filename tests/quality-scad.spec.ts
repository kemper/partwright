import { test, expect } from 'playwright/test';

// Verifies the OpenSCAD engine seeds $fn from the quality preset.
// We use the in-page console API to run a tiny sphere in SCAD under
// each preset and compare the resulting triangle counts.

test('SCAD engine applies the chosen $fn from quality preset', async ({ page }) => {
  await page.goto('/editor?view=ai');
  await page.waitForSelector('#btn-quality');

  type RunResult = { triangleCount?: number; error?: string };
  type PartwrightApi = {
    run: (code: string) => Promise<RunResult>;
    setLanguage?: (lang: 'manifold-js' | 'scad') => Promise<void> | void;
  };

  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );

  // Switch to SCAD by clicking the SCAD button in the language toggle.
  // The button is the second pill in #lang-toggle ("SCAD"). Confirm any
  // dialog asking about session switching.
  page.on('dialog', d => d.accept());

  // The simpler path: switch via the toolbar language button. We've seen
  // it ask for confirmation when a session has versions — there's none
  // here, so it should switch silently.
  await page.locator('#lang-toggle button:has-text("SCAD")').click();
  await page.waitForTimeout(2000); // give SCAD WASM a moment to spin up

  const scadCode = 'sphere(5);';

  // Run under Highest (default) — many triangles.
  const high = await page.evaluate(async (code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, scadCode);
  expect(high.error).toBeFalsy();
  expect(high.triangleCount ?? 0).toBeGreaterThan(2000);

  // Drop to Low.
  await page.locator('#btn-quality').click();
  await page.locator('input[type=radio][value=low]').check();
  await page.getByRole('button', { name: 'Done' }).click();

  // Re-run — fewer triangles.
  const low = await page.evaluate(async (code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, scadCode);
  expect(low.error).toBeFalsy();
  expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
  expect(low.triangleCount ?? 0).toBeGreaterThan(0);
});
