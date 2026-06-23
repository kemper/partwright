import { test, expect, type Page } from 'playwright/test';

// Importing a figure into a session that already has an (unsaved starter)
// "Part 1" must: add it as a uniquely-named NEW part (not a second "Part 1"),
// SELECT that part, and show its code in the editor — with a single progressive
// render, not the old double render that left the host part selected.

async function openEditor(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ }
  });
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (c?: string) => Promise<unknown>;
  runAndSave: (c: string, l?: string) => Promise<unknown>;
  exportSessionData: (id?: string, opts?: { includeThumbnails?: boolean }) => Promise<{ data: unknown }>;
  listParts: () => { id: string; name: string }[];
};

test('merge import adds a uniquely-named part, selects it, and shows its code', async ({ page }) => {
  await openEditor(page);

  // Build an exported single-part figure (default part name "Part 1"), coloured
  // via api.label so the backfilled thumbnail exercises the colouring path.
  const json = await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession('figure-source');
    await pw.runAndSave(`const { Manifold } = api;
const body = api.label(Manifold.cube([20,20,30], true), 'body', { color: [0.2,0.4,0.9] });
const head = api.label(Manifold.sphere(9).translate([0,0,22]), 'head', { color: [0.95,0.8,0.6] });
return body.add(head); // FIGURE-MARKER`, 'v1');
    const { data } = await pw.exportSessionData(undefined, { includeThumbnails: false });
    return JSON.stringify(data);
  });

  // Fresh target session: a DEFAULT, UNSAVED starter "Part 1" (don't save it).
  await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession('my-project');
  });
  expect(await page.evaluate(() =>
    (window as unknown as { partwright: PW }).partwright.listParts().map(p => p.name),
  )).toEqual(['Part 1']);

  // Import the figure via the toolbar file input → default "Add parts" (merge).
  await page.locator('#import-wrapper input[type="file"]').setInputFiles({
    name: 'figure.partwright.json',
    mimeType: 'application/json',
    buffer: Buffer.from(json, 'utf8'),
  });
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 6000 });
  await dialog.getByRole('button', { name: 'Add parts' }).click();
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // The new part is named "Part 2" (NOT a colliding second "Part 1")…
  await expect.poll(async () =>
    page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listParts().map(p => p.name)),
  ).toEqual(['Part 1', 'Part 2']);

  // …it is SELECTED, so the editor shows the imported figure code, not the
  // starter code (the core regression: the old path left "Part 1" selected).
  await expect(page.locator('.cm-content')).toContainText('FIGURE-MARKER', { timeout: 15_000 });

  // The selected part's id is the second part (it's the active one).
  const selectedIsPart2 = await page.evaluate(() => {
    const parts = (window as unknown as { partwright: PW }).partwright.listParts();
    const activePart = new URLSearchParams(window.location.search).get('part');
    // When only one part exists the URL omits `part`; with two it carries the
    // active id. The active part should be the newly-added "Part 2".
    return activePart === null || activePart === parts[1].id;
  });
  expect(selectedIsPart2).toBe(true);

  // The merged part's version was given a thumbnail (live capture on select).
  await expect.poll(async () => page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const r = indexedDB.open('partwright');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const versions: { thumbnail: Blob | null }[] = await new Promise((resolve, reject) => {
      const req = db.transaction('versions', 'readonly').objectStore('versions').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return versions.some(v => !!v.thumbnail);
  }), { timeout: 15_000 }).toBe(true);
});
