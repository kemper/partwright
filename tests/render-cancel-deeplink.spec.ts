// Regression: the inline "× Cancel" button must work during the *initial*
// deep-link render, not just on later edits. main() awaits the first render
// inside syncEditorFromURL() before finishing its setup, so the Cancel button's
// click handler used to be wired up only AFTER that render completed — leaving
// the button visible-but-dead for the whole first render of a slow model. The
// catalog SDF figures are the worst case: their two-phase progressive render
// shows the "Rendering… Xs" timer + Cancel button (and a "⚡ Fast preview" pill)
// for tens of seconds, but clicking Cancel did nothing and the full-detail
// render landed anyway. The handler is now attached early; this guards it.

import { test, expect } from 'playwright/test';

test.describe('initial deep-link render cancel', () => {
  test('cancelling a catalog figure load stops the full render', async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));

    // An SDF figure (superhero) — slow enough that the inline Cancel button shows
    // during the initial render.
    await page.goto('/editor?catalog=superhero.partwright.json');

    const cancelBtn = page.locator('#btn-cancel-inline');
    const status = page.locator('#status-indicator');

    // The Cancel button appears once the render passes the short delay gate.
    await expect(cancelBtn).toBeVisible({ timeout: 25_000 });
    await expect(status).toHaveText(/Rendering/, { timeout: 25_000 });

    await cancelBtn.click();

    // Cancel terminates the geometry Worker: the status flips to "Cancelled" and
    // the button hides almost immediately — the full-detail render never lands.
    await expect(status).toHaveText('Cancelled', { timeout: 5_000 });
    await expect(cancelBtn).toBeHidden();

    // And it STAYS cancelled — prove the heavy full render didn't quietly finish
    // and overwrite the status a few seconds later (the original bug's tell).
    await page.waitForTimeout(4_000);
    await expect(status).toHaveText('Cancelled');
  });
});
