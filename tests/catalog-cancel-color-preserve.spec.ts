// Regression: cancelling the slow initial render of a catalog figure, then
// saving, must NOT lose the figure's colours.
//
// Catalog figures (e.g. the superhero) carry their colours as `byLabel` colour
// regions in the saved version, resolved against the rendered mesh + labelMap.
// When the user cancels the initial render, that render never produces a mesh,
// so rehydrateColorRegions (which needs one) is skipped. Previously the colour
// regions then never entered memory at all — so a subsequent Save serialised an
// empty store over the figure's 14 colours (permanent loss) and the next
// edit→rerender showed a colourless model. The fix stages the version's colour
// descriptors into memory on the cancel path, so a Save preserves them and they
// re-resolve on the next successful run.
//
// This bug is only reachable because the Cancel button now works during the
// initial render (the sibling fix in this PR) — so the two ship together.

import { test, expect } from 'playwright/test';

test.describe('catalog figure cancel + save preserves colours', () => {
  test('cancelling the initial render then saving keeps the colour regions', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));

    // The superhero is a slow SDF figure with 14 byLabel colour regions.
    await page.goto('/editor?catalog=superhero.partwright.json');

    const cancelBtn = page.locator('#btn-cancel-inline');
    const status = page.locator('#status-indicator');

    // Cancel the initial render the moment the button appears.
    await expect(cancelBtn).toBeVisible({ timeout: 30_000 });
    await cancelBtn.click();
    await expect(status).toHaveText('Cancelled', { timeout: 5_000 });

    // Save the (un-rendered) figure.
    await page.getByText('💾 Save', { exact: false }).first().click();
    // Let the save commit.
    await page.waitForTimeout(1_500);

    // The persisted session must still carry the figure's colour regions —
    // before the fix this came back as 0 (the colours were destroyed).
    const colourCount = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const res = await pw.exportSessionData();
      const versions = res?.data?.versions ?? [];
      // The latest version carries the saved colour regions.
      const last = versions[versions.length - 1] ?? {};
      return Array.isArray(last.colorRegions) ? last.colorRegions.length : -1;
    });

    expect(colourCount).toBeGreaterThan(0);
  });
});
