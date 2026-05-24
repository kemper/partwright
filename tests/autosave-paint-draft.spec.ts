// Repro: paint regions must survive a refresh via the autosave draft layer.
import { test, expect } from 'playwright/test';

const CUBE = 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);';

function autoAcceptUnloadPrompt(page: import('playwright/test').Page) {
  page.on('dialog', d => { void d.accept().catch(() => {}); });
}

async function paintTopFace(page: import('playwright/test').Page) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(() => (window as any).partwright.paintRegion({ point: [0, 0, 5], normal: [0, 0, 1], color: [1, 0, 0] }));
}
async function regionCount(page: import('playwright/test').Page) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return page.evaluate(() => (window as any).partwright.listRegions().length as number);
}

test.describe('autosave draft — paint survives reload', () => {
  test('with a saved version', async ({ page }) => {
    autoAcceptUnloadPrompt(page);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    const sid = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('paint-saved');
      await pw.runAndSave(code, 'v1');
      return new URLSearchParams(location.search).get('session');
    }, CUBE);
    await paintTopFace(page);
    expect(await regionCount(page)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`partwright-draft-v1:${id}`) ?? '', sid)).toContain('color');

    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await expect.poll(() => regionCount(page)).toBeGreaterThan(0);
  });

  test('with an unsaved session (no version)', async ({ page }) => {
    autoAcceptUnloadPrompt(page);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    const sid = await page.evaluate(async (code) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('paint-unsaved');
      await pw.run(code); // run, not save → session has no committed version
      return new URLSearchParams(location.search).get('session');
    }, CUBE);
    await paintTopFace(page);
    expect(await regionCount(page)).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`partwright-draft-v1:${id}`) ?? '', sid)).toContain('color');

    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 15000 });
    await expect.poll(() => regionCount(page)).toBeGreaterThan(0);
  });

  // The reported repro: paint the freshly-opened default model WITHOUT touching
  // the code or saving a version, then refresh *immediately* — before the
  // debounced draft fires. Only the beforeunload flush can persist the paint
  // here, and that flush is gated by hasUnsavedChanges(), which used to ignore
  // paint on a no-version session (so the draft was never written → paint lost).
  test('on the unchanged default model (no version) survives an immediate reload', async ({ page }) => {
    autoAcceptUnloadPrompt(page);
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const sid = await page.evaluate(() => new URLSearchParams(location.search).get('session'));
    expect(sid).toBeTruthy();

    // Paint a solid side face (the default basic_shapes model has a hole through
    // the top, so paint off-center via the bounding box's +X face).
    const regions = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bb = (pw.getGeometryData() as any).boundingBox;
      const cy = (bb.y[0] + bb.y[1]) / 2;
      const cz = (bb.z[0] + bb.z[1]) / 2;
      pw.paintRegion({ point: [bb.x[1], cy, cz], normal: [1, 0, 0], color: [1, 0, 0] });
      return pw.listRegions().length;
    });
    expect(regions).toBeGreaterThan(0);

    // Reload right away — do NOT wait for the debounced draft. The paint only
    // survives if beforeunload flushes it (which needs the dirty check to count
    // paint on a no-version session).
    await page.reload();
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    await expect.poll(() => regionCount(page)).toBeGreaterThan(0);
  });
});
