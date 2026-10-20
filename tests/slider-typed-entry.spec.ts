// Typed-entry sliders: every numeric slider in the Surface panel pairs with an
// editable number box. The slider covers the common range; the box accepts an
// exact value — including one past the slider's max, up to the engine's real
// limit — and that typed value is what Preview/Apply use.

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
  getCode: () => string;
};

test.describe('typed-entry sliders', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('Surface Smooth: a typed rounding strength past the slider max is applied', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('typed-smooth');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube([20, 20, 20], true);');
    });

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press('ControlOrMeta+k');
    await page.locator('input[aria-label="Search commands"]').fill('Surface: Smooth');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();
    await page.getByRole('button', { name: 'Whole model' }).click();

    const box = page.locator('input[type="number"][aria-label="Rounding strength"]');
    const range = page.locator('input[type="range"][aria-label="Rounding strength"]');
    await expect(box).toHaveValue('4');
    await expect(range).toHaveAttribute('max', '12');

    // Type past the slider's 12: the box keeps 30, the thumb pins at its max.
    await box.fill('30');
    await box.press('Enter');
    await expect(box).toHaveValue('30');
    await expect(range).toHaveValue('12');

    // Over the engine cap (100) clamps on commit.
    await box.fill('500');
    await box.press('Enter');
    await expect(box).toHaveValue('100');

    // Dragging the slider writes back into the box.
    await range.fill('6');
    await expect(box).toHaveValue('6');

    await box.fill('30');
    await box.press('Enter');
    await page.screenshot({ path: 'test-results/slider-typed-entry-smooth.png' });

    await page.getByRole('button', { name: 'Apply as code' }).click();
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0, { timeout: 60_000 });
    const code = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(code).toMatch(/api\.surface\.smooth\(\{[^}]*iterations: 30/);
  });

  test('Voxel Studio: a typed brush radius goes past the slider, clamped to the engine cap', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { setActiveLanguage: (l: string) => Promise<unknown>; activateVoxelPaint: () => unknown } }).partwright;
      await pw.createSession('typed-voxel-brush');
      await pw.setActiveLanguage('voxel');
      await pw.run('const v = api.voxels();\nv.fillBox([0, 0, 0], [8, 8, 8], 0x44aa66);\nreturn v;');
      pw.activateVoxelPaint();
    });
    await page.locator('button[title^="Brush —"]').click();
    const panel = page.locator('#voxel-paint-panel');
    const box = panel.locator('input[type="number"][title^="Brush radius"]');
    await box.fill('12');
    await box.press('Enter');
    await expect(panel.getByText('Size: 25 wide')).toBeVisible();   // 12 > the slider's 8
    await box.fill('99');
    await box.press('Enter');
    await expect(box).toHaveValue('16');                             // MAX_BRUSH_RADIUS
    await expect(panel.getByText('Size: 33 wide')).toBeVisible();
  });
});
