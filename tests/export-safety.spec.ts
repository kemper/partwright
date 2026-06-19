// E2E coverage for the pre-export safety confirmation (unitless + printability)
// and the export-units selector. Runs with no external network — all geometry
// is produced locally via the window.partwright console API.
//
// IMPORTANT: the confirmation gates ONLY the toolbar/UI export path. The
// console API (window.partwright.exportSTL etc.) is intentionally unguarded;
// these tests therefore drive the UI buttons, not the API.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  setUnits: (u: string) => void;
};

async function runManifold(page: Page, code: string) {
  await page.evaluate(async (c) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession('export-safety');
    // Save a version so the part isn't flagged "unsaved" — these tests isolate
    // the units/printability warnings, not the new unsaved-parts warning.
    await pw.runAndSave(c, 'v1');
  }, code);
}

const CUBE = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';
// Two non-overlapping cubes → 2 disconnected components (printability warning).
const TWO_COMPONENTS =
  'const { Manifold } = api; return Manifold.cube([5,5,5], true).add(Manifold.cube([5,5,5], true).translate([40,0,0]));';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('partwright-tour-completed', '1');
      // Ensure a clean unit baseline regardless of any persisted value.
      localStorage.removeItem('partwright-units');
      // Disable auto-format so runAndSave's saved code matches the editor buffer
      // exactly — otherwise the part reads as "unsaved" (formatted editor vs
      // unformatted saved arg) and the new unsaved-parts export warning fires.
      localStorage.setItem('editor-auto-format', 'false');
    } catch { /* ignore */ }
  });
});

test.describe('Export safety confirmation', () => {
  test('unitless STL export shows a confirm modal with bounding-box dims', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await runManifold(page, CUBE);

    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('No units set');
    // 10×10×10 cube → bounding box dims show up.
    await expect(dialog).toContainText('10.00 × 10.00 × 10.00');

    // Cancelling aborts — no toast, modal closes.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('non-manifold / multi-component geometry shows a printability warning', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await runManifold(page, TWO_COMPONENTS);

    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Printability warning');
    await expect(dialog).toContainText('disconnected components');
  });

  test('unitless modal lets the user set units inline', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await runManifold(page, CUBE);

    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('No units set');
    // Inline selector is present, defaulting to unitless; button warns.
    const select = dialog.locator('#export-confirm-units-select');
    await expect(select).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Export anyway' })).toBeVisible();

    // Pick millimeters right in the modal — warning clears to a confirmation,
    // dims re-format in mm, and the button relaxes to "Export".
    await select.selectOption('mm');
    await expect(dialog).toContainText('Units set to mm');
    await expect(dialog).toContainText('10.00 mm × 10.00 mm × 10.00 mm');
    await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeVisible();

    // The choice persists to the toolbar selector and proceeds with the export.
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.locator('div[role="status"]').filter({ hasText: /Exported/ }),
    ).toBeVisible({ timeout: 5_000 });
    await page.locator('#btn-export').click();
    await expect(page.locator('#export-units-select')).toHaveValue('mm');
  });

  test('setting a unit suppresses the unitless modal', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await runManifold(page, CUBE);

    // Pick millimeters via the export-menu selector.
    await page.locator('#btn-export').click();
    await page.locator('#export-units-select').selectOption('mm');
    await page.locator('#export-dropdown').getByText('STL', { exact: true }).click();

    // A watertight single-component cube in mm has no warning → exports
    // directly, surfacing the success toast and no dialog.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    // Target the toast specifically — the status pill (<span role="status">
    // "Ready") also matches role=status, so getByRole would be ambiguous.
    await expect(
      page.locator('div[role="status"]').filter({ hasText: /Exported/ }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
