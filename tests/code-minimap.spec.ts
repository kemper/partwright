import { test, expect } from 'playwright/test';

// Golden path for the compact code map (src/editor/codeMinimap.ts): the code
// pane's default desktop mode. It shows the file's shape, peeks real code on
// hover, opens the full editor at the clicked line, and folds back down.

type Api = {
  run: (code: string) => Promise<unknown>;
  getViewState: () => { codeView: string };
  setCodeView: (mode: string) => void;
};

const CODE = [
  '// Minimap golden path',
  'const { Manifold } = api;',
  ...Array.from({ length: 30 }, (_, i) => `const part${i} = Manifold.cube([${i + 1}, 2, 3]).translate([${i * 2}, 0, 0]);`),
  'const MARKER_LINE = 42;',
  'return Manifold.union([part0, part1, part2]);',
].join('\n');

test.describe('code minimap', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
    });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run);
  });

  test('is the default code view: peek on hover, click to open the editor, minimize back', async ({ page }) => {
    const minimap = page.locator('#code-minimap');
    await expect(minimap).toBeVisible();
    await expect(page.locator('.cm-content')).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { partwright: Api }).partwright.getViewState().codeView)).toBe('mini');

    await page.evaluate((code) => (window as unknown as { partwright: Api }).partwright.run(code), CODE);
    // Auto-format appends a trailing newline, so allow the extra empty line.
    await expect(minimap.locator('div').last()).toContainText(/^3[45] lines/);

    // The map is narrow — far narrower than the old 40% editor pane.
    const box = await page.locator('#code-pane').boundingBox();
    expect(box!.width).toBeLessThan(200);

    // Hovering peeks the real code around the pointer.
    const scroller = minimap.locator('canvas');
    const canvasBox = (await scroller.boundingBox())!;
    // Row height is 4px with 4px top padding: line 33 (MARKER_LINE) sits at y ≈ 4 + 32*4.
    await page.mouse.move(canvasBox.x + 30, canvasBox.y + 4 + 32 * 4 + 2);
    const peek = page.locator('#code-minimap-peek');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText('MARKER_LINE');
    await page.screenshot({ path: 'test-results/code-minimap-peek.png' });

    // Clicking opens the full editor with the caret on that line.
    await page.mouse.click(canvasBox.x + 30, canvasBox.y + 4 + 32 * 4 + 2);
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect(minimap).toBeHidden();
    await expect(peek).toBeHidden();
    await expect(page.locator('.cm-activeLine')).toContainText('MARKER_LINE');
    await page.screenshot({ path: 'test-results/code-minimap-full.png' });

    // Minimize returns to the map, and the choice persists across reloads.
    await page.click('#btn-code-minimize');
    await expect(minimap).toBeVisible();
    await expect(page.locator('.cm-content')).toBeHidden();
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run);
    await expect(page.locator('#code-minimap')).toBeVisible();
  });

  test('the expand button and setCodeView API switch modes', async ({ page }) => {
    await page.click('#code-minimap-expand');
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.evaluate(() => (window as unknown as { partwright: Api }).partwright.setCodeView('hidden'));
    await expect(page.locator('button:has-text("▶ Show code")')).toBeVisible();
    // Hidden = the pane collapses to zero width (its content is clipped, not removed).
    await expect.poll(async () => (await page.locator('#code-pane').boundingBox())?.width ?? 0).toBeLessThan(4);
    // Show code restores the last visible mode (full, here).
    await page.click('button:has-text("▶ Show code")');
    await expect(page.locator('.cm-content')).toBeVisible();
    const err = await page.evaluate(() => {
      try { (window as unknown as { partwright: Api }).partwright.setCodeView('wide'); return null; } catch (e) { return String(e); }
    });
    expect(err).toMatch(/setCodeView/);
  });

  test('surfaces a code error in the map footer', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { partwright: Api }).partwright.run('const { Manifold } = api;\nreturn Manifold.nope();'));
    const badge = page.locator('#code-minimap-error');
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'test-results/code-minimap-error.png' });
    await badge.click();
    await expect(page.locator('.cm-content')).toBeVisible();
  });
});
