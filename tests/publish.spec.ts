// Assisted-publish flow: partwright.publish() opens a modal that prepares a
// publish to Printables / MakerWorld / Thingiverse / Thangs — these sites have
// no public upload API, so the flow downloads the model file + cover image,
// copies title/description/tags to the clipboard, and opens the upload page.

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
  publish: (platform?: string) => unknown;
};

test.describe('assisted publish', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('partwright-tour-completed', '1');
      // Record window.open + clipboard writes instead of actually firing them.
      const w = window as unknown as { __opened?: string[]; __clip?: string[] };
      w.__opened = [];
      window.open = ((url?: string | URL) => { w.__opened!.push(String(url)); return null; }) as typeof window.open;
      w.__clip = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t: string) => { w.__clip!.push(t); return Promise.resolve(); } },
      });
    });
  });

  test('publish() opens the modal, switches platform, and prepares the publish', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('publish-test');
      await pw.run('const { Manifold } = api;\nreturn Manifold.sphere(10, 32);');
      pw.publish('printables');
    });

    // Modal is up with the platform pills.
    await expect(page.getByRole('heading', { name: 'Publish to a print site' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Printables', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'MakerWorld', exact: true })).toBeVisible();

    // The primary button reflects the selected platform.
    await expect(page.getByRole('button', { name: 'Download & open Printables' })).toBeVisible();

    // MakerWorld recommends the Bambu/Orca 3MF flavour.
    await page.getByRole('button', { name: 'MakerWorld', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Download & open MakerWorld' })).toBeVisible();
    await page.screenshot({ path: 'test-results/publish-modal.png' });

    // Switch to Thingiverse — primary label follows.
    await page.getByRole('button', { name: 'Thingiverse', exact: true }).click();
    const go = page.getByRole('button', { name: 'Download & open Thingiverse' });
    await expect(go).toBeVisible();

    // Clicking prepares: a single ZIP download fires (model + cover + details),
    // the upload page "opens", and the details land on the clipboard.
    const download = await Promise.all([
      page.waitForEvent('download'),
      go.click(),
    ]).then(([d]) => d);
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? []),
    ).toContain('https://www.thingiverse.com/upload');

    const clip = await page.evaluate(() => (window as unknown as { __clip?: string[] }).__clip ?? []);
    expect(clip.join('\n')).toContain('Title: publish-test');
  });

  test('Export menu has a "Publish to a print site…" entry that opens the modal', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('publish-menu');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube(10);');
    });
    await page.getByRole('button', { name: '↓ Export' }).click();
    await page.getByText('Publish to a print site…').click();
    await expect(page.getByRole('heading', { name: 'Publish to a print site' })).toBeVisible();
  });

  test('publish() rejects an unknown platform id', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const res = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('publish-bad');
      await pw.run('const { Manifold } = api;\nreturn Manifold.cube(10);');
      return pw.publish('nope') as { error?: string };
    });
    expect(res.error).toContain('Unknown platform');
  });
});
