import { test, expect } from 'playwright/test';
import { waitForEditorReady } from './helpers/aiPanel';

// The filament color palette: opened from the left rail's 🧵 Palette button
// (next to ⚙ Settings). Seeded on first run with the 16 default paint colors,
// editable, persisted to localStorage, and surfaced to AI sessions via
// window.partwright.getColorPalette() + the per-turn prompt directive
// (buildPaletteDirective). All of this is network-free, so it runs in CI.

const PALETTE_KEY = 'partwright-color-palette-v1';

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

/** Click the rail's Palette button and return the modal locator. */
async function openPaletteModal(page: import('playwright/test').Page) {
  await page.waitForSelector('#btn-palette');
  await page.locator('#btn-palette').click();
  const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'Filament palette' });
  await expect(modal).toBeVisible();
  return modal;
}

async function getColorPalette(page: import('playwright/test').Page) {
  return page.evaluate(() => (window as unknown as {
    partwright: { getColorPalette: () => { configured: boolean; enforce: boolean; maxSimultaneous: number; colors: unknown[] } };
  }).partwright.getColorPalette());
}

test.describe('Filament color palette', () => {
  test('seeds 16 defaults, enforcement persists, and surfaces to the AI', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);

    const modal = await openPaletteModal(page);

    // First run is seeded with the 16 default paint colors.
    await expect(modal.locator('input[type="color"]')).toHaveCount(16);
    const api0 = await getColorPalette(page);
    expect(api0).toMatchObject({ configured: true, enforce: false });
    expect(api0.colors).toHaveLength(16);

    // Default (enforce off) injects nothing into the prompt.
    const off = await page.evaluate(async () => {
      const m = await import('/src/color/palette.ts');
      return m.buildPaletteDirective(m.loadPalette());
    });
    expect(off).toBeNull();

    // Turn on enforcement + set the slot limit.
    await modal.locator('input[type="checkbox"]').first().check();
    const maxInput = modal.locator('input[type="number"]');
    await maxInput.fill('3');
    await maxInput.dispatchEvent('change');

    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), PALETTE_KEY);
    expect(stored.enforce).toBe(true);
    expect(stored.maxSimultaneous).toBe(3);
    expect(stored.colors).toHaveLength(16);

    // Now the directive fires, names the limit, and lists a default color.
    const on = await page.evaluate(async () => {
      const m = await import('/src/color/palette.ts');
      return m.buildPaletteDirective(m.loadPalette());
    });
    expect(on).toContain('ENFORCED');
    expect(on).toContain('at most 3 distinct colors');
    expect(on).toContain('#000000'); // "Black" is one of the 16 defaults

    // Reload — enforcement + slot limit restore from localStorage.
    await page.reload();
    await waitForEditorReady(page);
    const modal2 = await openPaletteModal(page);
    await expect(modal2.locator('input[type="checkbox"]').first()).toBeChecked();
    await expect(modal2.locator('input[type="number"]')).toHaveValue('3');
  });

  test('adds colors without deduping, and resets to defaults', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);

    const modal = await openPaletteModal(page);
    await expect(modal.locator('input[type="color"]')).toHaveCount(16);

    // Add two rows (both default to the same hex) — both persist, proving the
    // manual list isn't deduped on save (UI, localStorage, and the AI agree).
    await modal.getByRole('button', { name: '+ Add color' }).click();
    await modal.getByRole('button', { name: '+ Add color' }).click();
    await expect(modal.locator('input[type="color"]')).toHaveCount(18);
    expect((await getColorPalette(page)).colors).toHaveLength(18);

    // Reset restores exactly the 16 built-in colors.
    await modal.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(modal.locator('input[type="color"]')).toHaveCount(16);
    const api = await getColorPalette(page);
    expect(api.colors).toHaveLength(16);
    expect(api.enforce).toBe(false);
  });
});
