import { test, expect } from 'playwright/test';
import { waitForEditorReady } from './helpers/aiPanel';

// The "Colors" viewport tool (🌈 Colors) reduces a model's colors to the
// filament palette: it enumerates the distinct colors currently shown, auto-
// matches each to the nearest palette color, previews live, and bakes the
// result into color regions on Apply. Driven here through code-declared
// api.label({color}) colors so there's something to remap. No network.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Win = { partwright: any };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

test.describe('Colors remap tool', () => {
  test('enumerates model colors, then applies the palette match as regions', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await page.waitForFunction(() => !!(window as unknown as Win).partwright?.runAndSave, { timeout: 20_000 });

    const panel = page.locator('#colors-panel');

    // Fresh starter model has no colors → empty state, Apply disabled.
    await page.locator('#colors-toggle').dispatchEvent('click');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('no colors yet', { exact: false })).toBeVisible();
    await expect(panel.locator('#colors-apply')).toBeDisabled();
    await page.locator('#colors-toggle').dispatchEvent('click'); // close
    await expect(panel).toBeHidden();

    // A two-color model via code-declared colors (red + green).
    await page.evaluate(async () => {
      const code = [
        'const { Manifold } = api;',
        "const a = api.label(Manifold.cube([10,10,10], true), 'a', { color: '#ff0000' });",
        "const b = api.label(Manifold.cube([10,10,10], true).translate([8,0,0]), 'b', { color: '#00ff00' });",
        'return a.add(b);',
      ].join('\n');
      await (window as unknown as Win).partwright.runAndSave(code, 'two-color', { isManifold: true });
    });

    // Reopen → two distinct source colors, each its own row (with a target select).
    await page.locator('#colors-toggle').dispatchEvent('click');
    await expect(panel).toBeVisible();
    await expect(panel.locator('select')).toHaveCount(2);
    await expect(panel.locator('#colors-apply')).toBeEnabled();

    // Apply the (auto-matched) palette mapping; it bakes into color regions.
    await panel.locator('#colors-apply').click();
    await expect(panel).toBeHidden();

    const regions = await page.evaluate(() => (window as unknown as Win).partwright.listRegions());
    expect(Array.isArray(regions)).toBe(true);
    // Red and green snap to two different palette entries → two regions.
    expect(regions.length).toBe(2);
    // Each region's color is a palette color (not the original pure red/green).
    const hexes = regions.map((r: { color: [number, number, number] }) =>
      '#' + r.color.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join(''));
    expect(hexes).not.toContain('#ff0000');
    expect(hexes).not.toContain('#00ff00');
  });

  test('auto-closes when code is re-run (no stale colors)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);
    await page.waitForFunction(() => !!(window as unknown as Win).partwright?.runAndSave, { timeout: 20_000 });

    await page.evaluate(async () => {
      await (window as unknown as Win).partwright.runAndSave(
        "return api.label(api.Manifold.cube([10,10,10], true), 'a', { color: '#ff0000' });",
        'one-color', { isManifold: true });
    });

    const panel = page.locator('#colors-panel');
    await page.locator('#colors-toggle').dispatchEvent('click');
    await expect(panel).toBeVisible();

    // Re-running replaces the mesh — the panel's enumerated colors would be
    // stale, so it must close itself.
    await page.evaluate(async () => {
      await (window as unknown as Win).partwright.runAndSave('return api.Manifold.sphere(8);', 'plain', { isManifold: true });
    });
    await expect(panel).toBeHidden();
  });
});
