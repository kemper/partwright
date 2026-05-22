// E2E coverage for the Versions tab — rename, delete, in-memory undo/redo,
// and the non-destructive version picker in the export dialog. Runs with no
// external network (all geometry is produced locally via the partwright API).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

/** Create a session with three distinct, named versions. */
async function seedVersions(page: Page) {
  await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: {
      createSession: (n?: string) => Promise<unknown>;
      runAndSave: (code: string, label?: string) => Promise<unknown>;
    } }).partwright;
    await pw.createSession('vtest');
    await pw.runAndSave('const { Manifold } = api; return Manifold.cube([10, 10, 10], true);', 'alpha');
    await pw.runAndSave('const { Manifold } = api; return Manifold.cube([14, 14, 14], true);', 'beta');
    await pw.runAndSave('const { Manifold } = api; return Manifold.cube([18, 18, 18], true);', 'gamma');
  });
}

const VERSIONS_TAB = 'button[data-tab="Versions"]';

test.describe('Versions tab', () => {
  // Suppress the first-visit guided tour so its backdrop doesn't intercept clicks.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('lists saved versions with management controls', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedVersions(page);

    await page.locator(VERSIONS_TAB).click();
    const container = page.locator('#versions-container');
    await expect(container.getByText('alpha', { exact: true })).toBeVisible();
    await expect(container.getByText('beta', { exact: true })).toBeVisible();
    await expect(container.getByText('gamma', { exact: true })).toBeVisible();
    // Toolbar reports the count.
    await expect(container.getByText('Versions (3)')).toBeVisible();
  });

  test('renames a version', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedVersions(page);
    await page.locator(VERSIONS_TAB).click();
    const container = page.locator('#versions-container');

    const betaTile = container.locator('div.grid > div', { hasText: 'beta' });
    await betaTile.locator('button[title="Rename this version"]').click();

    const input = page.locator('input[type="text"]:visible');
    await input.fill('beta-renamed');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();

    await expect(container.getByText('beta-renamed', { exact: true })).toBeVisible();
    await expect(container.getByText('beta', { exact: true })).toHaveCount(0);
  });

  test('deletes a version and undoes / redoes the deletion', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedVersions(page);
    await page.locator(VERSIONS_TAB).click();
    const container = page.locator('#versions-container');

    // Delete gamma.
    const gammaTile = container.locator('div.grid > div', { hasText: 'gamma' });
    await gammaTile.locator('button[title^="Delete this version"]').click();
    await expect(container.getByText('gamma', { exact: true })).toHaveCount(0);
    await expect(container.getByText('Versions (2)')).toBeVisible();

    // Undo restores it.
    await page.getByRole('button', { name: '↶ Undo' }).click();
    await expect(container.getByText('gamma', { exact: true })).toBeVisible();
    await expect(container.getByText('Versions (3)')).toBeVisible();

    // Redo deletes it again.
    await page.getByRole('button', { name: '↷ Redo' }).click();
    await expect(container.getByText('gamma', { exact: true })).toHaveCount(0);
    await expect(container.getByText('Versions (2)')).toBeVisible();
  });

  test('export dialog offers a non-destructive version picker', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await seedVersions(page);

    await page.locator('#btn-export').click();
    await page.getByText('Session (.partwright.json)').click();

    // One checkbox per version, all checked by default.
    const versionChecks = page.locator('input[data-index]');
    await expect(versionChecks).toHaveCount(3);

    // Deselecting everything blocks export; nothing is deleted from storage.
    await page.getByRole('button', { name: 'Select none' }).click();
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();

    await page.getByRole('button', { name: 'Cancel' }).click();

    const remaining = await page.evaluate(() =>
      (window as unknown as { partwright: { listVersions: () => Promise<unknown[]> } })
        .partwright.listVersions().then(v => v.length),
    );
    expect(remaining).toBe(3);
  });
});
