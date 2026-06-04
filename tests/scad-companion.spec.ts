import { test, expect } from 'playwright/test';

// Golden-path coverage for SCAD companion files: add a companion via the tab
// bar, edit it (with syntax highlighting), have the main code `include` it and
// render, then prove the companion + its content survive a reload.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

type RunResult = { triangleCount?: number; error?: string };
type Api = {
  run: (code: string) => Promise<RunResult>;
  setActiveLanguage: (lang: 'manifold-js' | 'scad' | 'replicad' | 'voxel') => Promise<void>;
  createSession: (name?: string) => Promise<unknown>;
  saveVersion: (label?: string) => Promise<unknown>;
};

test('SCAD companion file: add, edit, include, and persist across reload', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForSelector('#simplify-toggle');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );

  // Switch to SCAD and open a real session so versions (and the ?session URL)
  // persist for the reload check.
  await page.evaluate(async () => {
    const a = (window as unknown as { partwright: Api }).partwright;
    await a.setActiveLanguage('scad');
    await a.createSession('companion-e2e');
  });

  // The code editor pane is collapsed by default on this layout — expand it so
  // the companion tab bar is reachable.
  const showCode = page.locator('button[title="Show the code editor pane"]');
  if (await showCode.isVisible()) await showCode.click();

  // The companion tab bar appears in SCAD mode with a "+" add button.
  const bar = page.locator('#companion-files-bar');
  await expect(bar).toBeVisible();
  await bar.locator('button:text-is("+")').click();

  // Fill the in-app prompt dialog with the companion name.
  const dialogInput = page.locator('[role=dialog] input[type=text]');
  await expect(dialogInput).toBeVisible();
  await dialogInput.fill('shapes');
  await page.locator('[role=dialog] button:has-text("OK")').click();

  // A tab for the new companion appears and its editor opens.
  await expect(bar.getByText('shapes.scad')).toBeVisible();
  const companionPanel = page.locator('#companion-editor-panel');
  await expect(companionPanel).toBeVisible();

  // Type a module into the companion editor.
  await companionPanel.locator('.cm-content').click();
  await page.keyboard.type('module widget() { cube([10, 10, 10]); }');

  // Syntax highlighting: the SCAD language mode tokenizes into styled spans.
  await expect.poll(
    () => companionPanel.locator('.cm-line span').count(),
  ).toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/companion-editor.png' });

  // Back to the main file, write code that includes the companion, and run it.
  await bar.getByText('main.scad').click();
  const result = await page.evaluate(async () => {
    const a = (window as unknown as { partwright: Api }).partwright;
    return a.run('include <shapes.scad>\nwidget();');
  });
  expect(result.error).toBeFalsy();
  expect(result.triangleCount ?? 0).toBeGreaterThan(0); // companion resolved in MEMFS

  // Persist, then reload the same session URL.
  await page.evaluate(async () => {
    const a = (window as unknown as { partwright: Api }).partwright;
    await a.saveVersion('with-companion');
  });
  const url = page.url();
  expect(url).toContain('session=');
  await page.goto(url);
  await page.waitForSelector('#simplify-toggle');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );

  // The companion tab and its content survived the reload.
  const reloadedBar = page.locator('#companion-files-bar');
  await expect(reloadedBar.getByText('shapes.scad')).toBeVisible();
  await reloadedBar.getByText('shapes.scad').click();
  await expect(page.locator('#companion-editor-panel .cm-content')).toContainText('module widget');
});
