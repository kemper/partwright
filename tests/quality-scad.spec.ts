import { test, expect } from 'playwright/test';

// Verifies the OpenSCAD engine seeds $fn from the curve-quality preset.
// We run a tiny sphere in SCAD under two presets and compare triangle counts.
// The curve-quality control now lives in the viewport Mesh popover (interactive
// view only), so for this AI-view SCAD test we set the preset via localStorage
// and reload rather than driving the UI.

type RunResult = { triangleCount?: number; error?: string };
type PartwrightApi = { run: (code: string) => Promise<RunResult> };

const STORAGE_KEY = 'partwright-quality-settings-v1';
const scadCode = 'sphere(5);';

async function bootScadAndRun(page: import('playwright/test').Page): Promise<RunResult> {
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );
  // Switch to SCAD via the language toggle (auto-accept any confirm dialog).
  await page.locator('#lang-toggle button:has-text("SCAD")').click();
  await page.waitForTimeout(2000); // SCAD WASM spin-up
  return page.evaluate((code) => {
    const api = (window as unknown as { partwright: PartwrightApi }).partwright;
    return api.run(code);
  }, scadCode);
}

test('SCAD engine applies the chosen $fn from quality preset', async ({ page }) => {
  page.on('dialog', (d) => d.accept());

  // Highest (default) — many triangles.
  await page.goto('/editor?view=ai');
  const high = await bootScadAndRun(page);
  expect(high.error).toBeFalsy();
  expect(high.triangleCount ?? 0).toBeGreaterThan(2000);

  // Drop to Low via persisted settings + reload, then re-run.
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ quality: 'low', refine: 1 }));
  }, STORAGE_KEY);
  await page.reload();
  const low = await bootScadAndRun(page);
  expect(low.error).toBeFalsy();
  expect(low.triangleCount ?? 0).toBeLessThan(high.triangleCount ?? 0);
  expect(low.triangleCount ?? 0).toBeGreaterThan(0);
});
