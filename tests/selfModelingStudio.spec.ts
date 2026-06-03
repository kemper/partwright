import { test, expect, type Page } from 'playwright/test';

// Self-Modeling Studio UI wiring (no network). Drives the deterministic paths:
// open, the no-Gemini-key CTA, uploading silhouette images via the file chooser,
// building a voxel model through reconstructFromSilhouettes, and reopening the
// saved import prefilled (persistence — no Gemini calls). Live Gemini generation
// is exercised by the unit tests (request/response builders) and validated
// in-browser by the user, since this environment has no Google egress or key.

async function waitForEngine(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('Self-Modeling Studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('open → upload silhouettes → build voxel model → reopen prefilled', async ({ page }) => {
    await waitForEngine(page);

    // A silhouette PNG with transparent corners and an opaque disc — carves to
    // a real (non-empty) hull and exercises the alpha-channel mask path.
    const pngB64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 96, 96);
      ctx.fillStyle = '#999999';
      ctx.beginPath();
      ctx.arc(48, 48, 38, 0, Math.PI * 2);
      ctx.fill();
      return c.toDataURL('image/png').split(',')[1];
    });
    const buffer = Buffer.from(pngB64, 'base64');
    page.on('filechooser', (fc) => { void fc.setFiles({ name: 'view.png', mimeType: 'image/png', buffer }); });

    // Open the studio.
    await page.evaluate(() => (window as unknown as { partwright: { openSelfModelingStudio(): unknown } }).partwright.openSelfModelingStudio());
    await expect(page.getByRole("heading", { name: /Self-Modeling Studio/ })).toBeVisible();

    // No Gemini key in a fresh profile → the connect CTA shows.
    await expect(page.getByRole('button', { name: 'Connect Gemini' })).toBeVisible();

    // Upload the source photo (fills the Front view).
    await page.getByRole('button', { name: /Upload photo/ }).click();
    await expect(page.getByText(/1 of \d+ views ready/)).toBeVisible();

    // Upload two more angle tiles via their ⬆ buttons (per-view upload override).
    const uploadBtns = page.getByRole('button', { name: '⬆' });
    await uploadBtns.nth(3).click();
    await expect(page.getByText(/2 of \d+ views ready/)).toBeVisible();
    await uploadBtns.nth(9).click();
    await expect(page.getByText(/3 of \d+ views ready/)).toBeVisible();

    // Build — carves the hull, lands a voxel session, and closes the studio.
    const buildBtn = page.getByRole('button', { name: 'Build 3D model' });
    await expect(buildBtn).toBeEnabled();
    await buildBtn.click();
    await expect(page.getByRole("heading", { name: /Self-Modeling Studio/ })).toBeHidden({ timeout: 20_000 });

    // The active session is now a voxel reconstruction.
    const lang = await page.evaluate(() => (window as unknown as { partwright: { getActiveLanguage(): string } }).partwright.getActiveLanguage());
    expect(lang).toBe('voxel');

    // Reopen the studio for this session — the saved import repopulates with no
    // Gemini calls (persistence), so the 3 uploaded views are already ready.
    await page.evaluate(() => (window as unknown as { partwright: { openSelfModelingStudio(): unknown } }).partwright.openSelfModelingStudio());
    await expect(page.getByText(/Reopened a saved import/)).toBeVisible();
    await expect(page.getByText(/3 of \d+ views ready/)).toBeVisible();
  });

  test('build button is disabled until at least two views are ready', async ({ page }) => {
    await waitForEngine(page);
    await page.evaluate(() => (window as unknown as { partwright: { openSelfModelingStudio(): unknown } }).partwright.openSelfModelingStudio());
    await expect(page.getByText(/0 of \d+ views ready/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Build 3D model' })).toBeDisabled();
    // Generate is disabled without a key + source.
    await expect(page.getByRole('button', { name: /Generate missing angles/ })).toBeDisabled();
  });
});
