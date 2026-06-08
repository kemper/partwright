import { test, expect } from 'playwright/test';

// Golden path for "constrain colours to filament palette" in the two image
// import flows (voxel + relief). Each opens the modal programmatically with a
// synthetic image, toggles the new checkbox, and asserts the mode switches.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
});

test('voxel import: constrain to palette swaps the reduction picker for filament swatches', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForTimeout(4000);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 24;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 24, 24);
    g.addColorStop(0, '#e02525'); g.addColorStop(1, '#2452c0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 24, 24);
    const image = ctx.getImageData(0, 0, 24, 24);
    const m = await import('/src/ui/imageVoxelImportModal.tsx');
    void m.showImageVoxelImportModal({ filename: 'probe.png', image });
  });

  // Off by default: the All/Posterize/Palette reduction picker is shown.
  await expect(page.getByRole('button', { name: 'All colors' })).toBeVisible();
  const constrain = page.getByText('Constrain to filament palette');
  await expect(constrain).toBeVisible();

  // On: reduction picker is replaced by the filament-snap note.
  await constrain.click();
  await expect(page.getByText(/Every voxel snaps to the nearest/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'All colors' })).toHaveCount(0);

  // Off again: reduction picker returns.
  await constrain.click();
  await expect(page.getByRole('button', { name: 'All colors' })).toBeVisible();
});

test('relief import: colour tiles default to the filament palette, and it can be toggled off', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForTimeout(4000);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 24; c.height = 24;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e02525'; ctx.fillRect(0, 0, 12, 24);
    ctx.fillStyle = '#2452c0'; ctx.fillRect(12, 0, 12, 24);
    const blob: Blob = await new Promise(res => c.toBlob(b => res(b!), 'image/png'));
    const file = new File([blob], 'probe.png', { type: 'image/png' });
    const m = await import('/src/ui/reliefImportModal.ts');
    m.openReliefImportModal({ aiAvailable: false, initialFile: file, onCreate() {} });
  });
  await page.waitForTimeout(1200);

  const constrain = page.getByText('Use filament palette colours');
  await expect(constrain).toBeVisible();
  const checkbox = constrain.locator('xpath=preceding-sibling::input[@type="checkbox"]');
  // A fresh colour-tile open defaults to the filament palette.
  await expect(checkbox).toBeChecked();

  // It's an opt-out: unchecking falls back to auto-extracted (k-means) colours.
  await constrain.click();
  await expect(checkbox).not.toBeChecked();
  await constrain.click();
  await expect(checkbox).toBeChecked();
});
