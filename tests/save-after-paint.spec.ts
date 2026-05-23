// Regression: clicking "Save" after painting must create a new version.
//
// The session-bar Save button calls onSaveVersion(), which awaits
// captureThumbnail(). On a painted (subdivided + colored) mesh, the composite
// canvas's toBlob() can stall indefinitely — with no timeout and no catch, the
// save silently never happened (no new version, no error). captureThumbnail now
// caps the toBlob wait and resolves null on timeout so the save still commits.

import { test, expect } from 'playwright/test';

test('clicking Save after painting creates a new version', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });

  const before = await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.createSession('save-after-paint');
    await pw.runAndSave(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`, 'v1');
    return (await pw.listVersions()).length;
  });

  // Paint a region (same regions store the UI face-pick feeds).
  const painted = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    pw.paintStroke({ points: [[0, 0, 5]], radius: 3, resolution: 64, color: [1, 0, 0] });
    return pw.listRegions().length;
  });
  expect(painted).toBe(1);

  // Click the real Save button.
  await page.locator('#btn-save-version').dispatchEvent('click');

  // A new version must appear. (If the thumbnail toBlob stalls, captureThumbnail
  // falls back to null after its timeout and the save still commits — so allow
  // generously more than that timeout here.)
  await expect
    .poll(async () => page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await (window as any).partwright.listVersions()).length;
    }), { timeout: 12000 })
    .toBe(before + 1);
});
