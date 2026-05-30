import { test, expect } from 'playwright/test';
import { openAiPanel, waitForEditorReady } from './helpers/aiPanel';

// The filament color palette (🧵 in the AI panel header): the user records the
// filament colors they own + an AMS slot limit + an enforce switch. The data
// persists to localStorage and is surfaced to AI sessions via
// window.partwright.getColorPalette() and the per-turn prompt directive
// (buildPaletteDirective). No network is involved in any of this, so the whole
// flow is exercisable in CI (the photo→palette AI call is the only networked
// part, and it's covered by the request-shape unit tests instead).

const PALETTE_KEY = 'partwright-color-palette-v1';

test.beforeEach(async ({ page }) => {
  // Suppress the first-run guided tour — its backdrop intercepts clicks.
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
});

/** Open the AI panel and the Filament palette modal, returning the modal locator. */
async function openPaletteModal(page: import('playwright/test').Page) {
  await openAiPanel(page);
  // A stray AI Settings modal (auto-opened when the panel toggles while
  // disconnected) would swallow our clicks — dismiss it if present.
  const settingsHeading = page.getByRole('heading', { name: 'AI Settings' });
  if (await settingsHeading.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(settingsHeading).toBeHidden();
  }
  await page.locator('#ai-panel button[title^="Filament palette"]').dispatchEvent('click');
  const modal = page.locator('.bg-zinc-800.rounded-xl').filter({ hasText: 'Filament palette' });
  await expect(modal).toBeVisible();
  return modal;
}

test.describe('Filament color palette', () => {
  test('configure manually, persist across reload, and surface to the AI', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);

    const modal = await openPaletteModal(page);

    // Empty to start.
    await expect(modal.getByText('No filament colors yet', { exact: false })).toBeVisible();

    // Add one color, name it, recolor it, turn on enforcement, set the AMS limit.
    await modal.getByRole('button', { name: '+ Add color' }).click();
    await modal.getByPlaceholder('Unnamed').fill('Test Black');
    await modal.locator('input[type="color"]').fill('#112233');
    await modal.locator('input[type="checkbox"]').first().check();
    const maxInput = modal.locator('input[type="number"]');
    await maxInput.fill('3');
    await maxInput.dispatchEvent('change');

    // It wrote through to localStorage in the expected shape.
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), PALETTE_KEY);
    expect(stored.enforce).toBe(true);
    expect(stored.maxSimultaneous).toBe(3);
    expect(stored.colors).toHaveLength(1);
    expect(stored.colors[0]).toMatchObject({ name: 'Test Black', hex: '#112233' });

    // The console/MCP API mirrors it.
    const api = await page.evaluate(() => (window as unknown as {
      partwright: { getColorPalette: () => unknown };
    }).partwright.getColorPalette());
    expect(api).toMatchObject({
      configured: true,
      enforce: true,
      maxSimultaneous: 3,
      colors: [{ name: 'Test Black', hex: '#112233' }],
    });

    // The per-turn AI directive (what toggleSuffix injects) names the color and
    // the limit when enforcement is on.
    const directive = await page.evaluate(async () => {
      const m = await import('/src/color/palette.ts');
      return m.buildPaletteDirective(m.loadPalette());
    });
    expect(directive).toContain('ENFORCED');
    expect(directive).toContain('#112233');
    expect(directive).toContain('at most 3 distinct colors');

    // Reload — the modal restores the saved palette from localStorage.
    await page.reload();
    await waitForEditorReady(page);
    const modal2 = await openPaletteModal(page);
    await expect(modal2.getByPlaceholder('Unnamed')).toHaveValue('Test Black');
    await expect(modal2.locator('input[type="checkbox"]').first()).toBeChecked();
    await expect(modal2.locator('input[type="number"]')).toHaveValue('3');
  });

  test('directive is silent when enforcement is off', async ({ page }) => {
    await page.goto('/editor');
    await waitForEditorReady(page);

    const modal = await openPaletteModal(page);
    // Add two colors but leave enforcement off. Both default to the same hex —
    // a regression guard that the manual list isn't deduped on save (the UI,
    // localStorage, and getColorPalette must all agree on two rows).
    await modal.getByRole('button', { name: '+ Add color' }).click();
    await modal.getByRole('button', { name: '+ Add color' }).click();
    await expect(modal.locator('input[type="color"]')).toHaveCount(2);

    const directive = await page.evaluate(async () => {
      const m = await import('/src/color/palette.ts');
      return m.buildPaletteDirective(m.loadPalette());
    });
    expect(directive).toBeNull();

    // getColorPalette reports it configured-but-not-enforced, with both rows.
    const api = await page.evaluate(() => (window as unknown as {
      partwright: { getColorPalette: () => { configured: boolean; enforce: boolean; colors: unknown[] } };
    }).partwright.getColorPalette());
    expect(api.configured).toBe(true);
    expect(api.enforce).toBe(false);
    expect(api.colors).toHaveLength(2);
  });
});
