import { test, expect, type Page } from 'playwright/test';

// Self-Modeling Studio UI wiring (no network). Drives the deterministic paths:
// open, the no-Gemini-key CTA, uploading angle images via the file chooser,
// handing them to the AI (references attached + brief prefilled in the chat
// input, not sent), and reopening the saved import prefilled (persistence — no
// Gemini calls). Live Gemini generation is exercised by the unit tests
// (request/response builders) and validated in-browser by the user, since this
// environment has no Google egress or key.

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

  test('open → upload angles → hand off to AI (references + brief) → reopen prefilled', async ({ page }) => {
    await waitForEngine(page);

    // A small opaque PNG stands in for an angle image (any image works — the
    // handoff just attaches them as references, it doesn't carve).
    const pngB64 = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#888888';
      ctx.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png').split(',')[1];
    });
    const buffer = Buffer.from(pngB64, 'base64');
    page.on('filechooser', (fc) => { void fc.setFiles({ name: 'view.png', mimeType: 'image/png', buffer }); });

    // Open the studio.
    await page.evaluate(() => (window as unknown as { partwright: { openSelfModelingStudio(): unknown } }).partwright.openSelfModelingStudio());
    await expect(page.getByRole('heading', { name: /Self-Modeling Studio/ })).toBeVisible();

    // No Gemini key in a fresh profile → the connect CTA shows.
    await expect(page.getByRole('button', { name: 'Connect Gemini' })).toBeVisible();

    // Default angle set is Cardinal (6 views).
    await expect(page.getByText(/0 of 6 views ready/)).toBeVisible();

    // Upload the source photo (fills the Front view) + two more angle tiles.
    await page.getByRole('button', { name: /Upload photo/ }).click();
    await expect(page.getByText(/1 of \d+ views ready/)).toBeVisible();
    const uploadBtns = page.getByRole('button', { name: '⬆' });
    await uploadBtns.nth(1).click();
    await expect(page.getByText(/2 of \d+ views ready/)).toBeVisible();
    await uploadBtns.nth(2).click();
    await expect(page.getByText(/3 of \d+ views ready/)).toBeVisible();

    // Hand off — attaches references, opens the AI panel with the brief
    // prefilled (not sent), and closes the studio.
    const sendBtn = page.getByRole('button', { name: 'Send to AI modeler' });
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    await expect(page.getByRole('heading', { name: /Self-Modeling Studio/ })).toBeHidden({ timeout: 15_000 });

    // 3 reference images attached to the session.
    const imageCount = await page.evaluate(() => (window as unknown as { partwright: { getImages(): unknown[] } }).partwright.getImages().length);
    expect(imageCount).toBe(3);

    // The AI panel is open and its input is prefilled with the modeling brief
    // (not sent — it sits in the textarea for the user to review).
    await expect(page.locator('#ai-panel')).toBeVisible();
    const briefText = await page.locator('#ai-panel textarea').inputValue();
    expect(briefText).toMatch(/reference views/);
    expect(briefText).toMatch(/renderViews?/);

    // Critically: the references are attached to the CHAT (pending images that
    // ride into the model's vision on send), not just the gallery. A fresh
    // transcript has no other images, so these are the 3 reference chips.
    await expect(page.locator('#ai-panel img')).toHaveCount(3);

    // Reopen the studio for this session — the saved import repopulates with no
    // Gemini calls (persistence), so the 3 uploaded views are already ready.
    await page.evaluate(() => (window as unknown as { partwright: { openSelfModelingStudio(): unknown } }).partwright.openSelfModelingStudio());
    await expect(page.getByText(/Reopened a saved import/)).toBeVisible();
    await expect(page.getByText(/3 of \d+ views ready/)).toBeVisible();
  });

  test('send button is disabled until at least two views are ready', async ({ page }) => {
    await waitForEngine(page);
    await page.evaluate(() => (window as unknown as { partwright: { openSelfModelingStudio(): unknown } }).partwright.openSelfModelingStudio());
    await expect(page.getByText(/0 of \d+ views ready/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send to AI modeler' })).toBeDisabled();
    // Generate is disabled without a key + source.
    await expect(page.getByRole('button', { name: /Generate missing angles/ })).toBeDisabled();
  });
});
