import { test, expect } from 'playwright/test';

// Importing a session must switch the editor + part selection to the imported
// session IMMEDIATELY — before the (slow) per-version thumbnail regeneration —
// and then backfill the missing thumbnails offscreen. Regression test for the
// bug where the new geometry rendered while the OLD part stayed selected and
// the OLD code lingered in the editor for seconds (thumbnail regen ran before
// notify()/selection + the editor swap).

type PW = {
  run: (code?: string) => Promise<unknown>;
  saveVersion: (label?: string) => Promise<unknown>;
  exportSessionData: (id?: string, opts?: { includeThumbnails?: boolean }) => Promise<unknown>;
  importSessionData: (data: unknown) => Promise<unknown>;
  createSession: (name?: string) => Promise<unknown>;
};

test('importing a session selects it + loads its code immediately, then backfills thumbnails', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2000); // WASM + viewport settle

  // A 2-version "figure" whose api.label colours exercise the offscreen
  // thumbnail colouring path (model-declared colours must survive the backfill).
  const codeA = `const { Manifold } = api;\nconst a = api.label(Manifold.cube([20,20,20], true), 'body', { color: [0.9,0.2,0.2] });\nreturn a; // FIGURE-V1`;
  const codeB = `const { Manifold } = api;\nconst a = api.label(Manifold.cube([20,20,20], true), 'body', { color: [0.2,0.4,0.9] });\nconst b = api.label(Manifold.sphere(8).translate([0,0,14]), 'head', { color: [0.95,0.8,0.6] });\nreturn a.add(b); // FIGURE-V2`;

  await page.evaluate(async ([a, b]) => {
    const p = (window as unknown as { partwright: PW }).partwright;
    await p.run(a);
    await p.saveVersion('v1');
    await p.run(b);
    await p.saveVersion('v2');
  }, [codeA, codeB]);

  // Export WITHOUT thumbnails — the default-export case that forces a backfill.
  // exportSessionData returns a download descriptor; `.data` is the JSON string.
  const data = await page.evaluate(async () => {
    const p = (window as unknown as { partwright: PW }).partwright;
    const desc = await p.exportSessionData(undefined, { includeThumbnails: false }) as { data: string };
    return desc.data;
  });

  // Switch to a fresh "starter" session with distinctly different code.
  await page.evaluate(async () => {
    const p = (window as unknown as { partwright: PW }).partwright;
    await p.createSession('starter');
    await p.run('const { Manifold } = api; return Manifold.cylinder(30, 5); // STARTER-CODE');
  });
  await expect(page.locator('.cm-content')).toContainText('STARTER-CODE');

  // Import the figure. The editor must show the imported latest version
  // (FIGURE-V2) and drop the starter code.
  const importResult = await page.evaluate(async (d) => {
    const p = (window as unknown as { partwright: PW }).partwright;
    return await p.importSessionData(d) as { sessionId: string };
  }, data);

  await expect(page.locator('.cm-content')).toContainText('FIGURE-V2', { timeout: 15_000 });
  await expect(page.locator('.cm-content')).not.toContainText('STARTER-CODE');

  // The offscreen backfill writes a thumbnail blob for every imported version.
  await expect.poll(async () => page.evaluate(async (sid) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const versions: { sessionId: string; thumbnail: Blob | null }[] = await new Promise((resolve, reject) => {
      const req = db.transaction('versions', 'readonly').objectStore('versions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const mine = versions.filter(v => v.sessionId === sid);
    return `${mine.filter(v => v.thumbnail).length}/${mine.length}`;
  }, importResult.sessionId), { timeout: 20_000 }).toBe('2/2');
});
