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
});
