// E2E for JSON import "Merge into current session" + the "Import from URL…"
// modal's input validation. No external network is exercised.

import { test, expect, type Page } from 'playwright/test';

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

type ExportedVersion = { code: string; thumbnail?: string; part?: number };
type ExportedPart = { name: string; order: number };
type ExportedData = { versions: ExportedVersion[]; parts?: ExportedPart[] };

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  runAndSave: (c: string, l?: string) => Promise<unknown>;
  exportSessionData: (
    id?: string,
    opts?: { includeThumbnails?: boolean },
  ) => Promise<{ data: ExportedData }>;
  listParts: () => { id: string; name: string }[];
};

test.describe('Import: merge + from-URL', () => {
  test('JSON import defaults to "Add as new part(s)" and appends the parts', async ({ page }) => {
    await openEditor(page);

    // Build an exported session payload from a throwaway session.
    const json = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('source-session');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([6,6,6], true);', 'v1');
      const { data } = await pw.exportSessionData();
      return JSON.stringify(data);
    });

    // Switch to a DIFFERENT session that we will merge into.
    const partsBefore = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('target-session');
      await pw.runAndSave('const { Manifold } = api; return Manifold.sphere(5);', 'v1');
      return pw.listParts().length;
    });
    expect(partsBefore).toBe(1);

    // Import the source JSON through the toolbar file input.
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'source.partwright.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json, 'utf8'),
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });
    // The merge destination choice is offered because a session is open, AND it
    // is the pre-selected default — so the primary button already reads
    // "Add parts" without the user touching the radios.
    await expect(dialog).toContainText('Add as new part(s) to current project');
    const mergeRadio = dialog.locator('input[type="radio"][value="merge"]');
    await expect(mergeRadio).toBeChecked();
    const mergeBtn = dialog.getByRole('button', { name: 'Add parts' });
    await expect(mergeBtn).toBeVisible();
    await mergeBtn.click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // The current session now has its original part PLUS the merged one, and we
    // did NOT navigate away to a new session.
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listParts().length),
    ).toBe(2);

    const sessionName = await page.evaluate(() =>
      new URLSearchParams(window.location.search).get('session'));
    expect(sessionName).toBeTruthy();
  });

  test('merging an imported-mesh part regenerates its OWN thumbnail (not the host part\'s)', async ({ page }) => {
    await openEditor(page);

    // Author an exported session whose only version renders an imported mesh
    // (`Manifold.ofMesh(api.imports[0])`) and carries NO embedded thumbnail, so
    // the merge MUST regenerate one by running that code. The bug under test:
    // if the active-imports register isn't seeded with THIS version's mesh
    // before the run, the capture reflects the host (previously selected) part
    // instead — a stale thumbnail. The imported mesh here is a single triangle,
    // visually distinct from the host part's sphere.
    const json = await page.evaluate(() => {
      // A closed tetrahedron — a valid watertight mesh so `Manifold.ofMesh`
      // produces real geometry (a flat triangle would be non-manifold and the
      // run would yield no mesh, leaving the thumbnail stale for the wrong
      // reason). Large enough to fill the iso thumbnail frame.
      const verts = new Float32Array([
        0, 0, 0,
        30, 0, 0,
        0, 30, 0,
        0, 0, 30,
      ]);
      // Outward-facing winding for the four faces.
      const tris = new Uint32Array([
        0, 2, 1,
        0, 1, 3,
        0, 3, 2,
        1, 2, 3,
      ]);
      const toB64 = (arr: Float32Array | Uint32Array): string => {
        const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
      };
      const payload = {
        partwright: '1.9',
        session: { name: 'imported-source', created: Date.now(), updated: Date.now() },
        parts: [{ name: 'Imported', order: 0 }],
        versions: [{
          index: 1,
          part: 0,
          // Mirrors the real import codegen wrapper: reads the imported mesh out
          // of the sandbox's `api.imports[0]`. With the stale-capture bug, the
          // register isn't seeded with THIS mesh before the run, so the code
          // either errors (host has no imports) or renders the host part — and
          // the captured thumbnail is wrong.
          code: 'const { Manifold } = api;\nreturn Manifold.ofMesh(api.imports[0]);',
          label: 'imported',
          timestamp: Date.now(),
          // No `thumbnail` field → forces regeneration on import/merge.
          importedMeshes: [{
            id: 'm1',
            filename: 'tetra.stl',
            format: 'stl',
            numVert: 4,
            numTri: 4,
            numProp: 3,
            vertProperties: toB64(verts),
            triVerts: toB64(tris),
          }],
        }],
      };
      return JSON.stringify(payload);
    });

    // Host session: a sphere, with its own (regenerated) thumbnail.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('host-session');
      await pw.runAndSave('const { Manifold } = api; return Manifold.sphere(8);', 'v1');
    });

    // Import → the chooser defaults to merge → confirm with "Add parts".
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'imported.partwright.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json, 'utf8'),
    });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });
    await dialog.getByRole('button', { name: 'Add parts' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listParts().length),
    ).toBe(2);

    // Export the host session (with thumbnails) and inspect the two parts'
    // thumbnails. The merged (imported) part is order 1; the host sphere is
    // order 0. `exportSession` omits the `part` field when the order is 0.
    const thumbs = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const { data } = await pw.exportSessionData(undefined, { includeThumbnails: true });
      const byPart = (order: number): string | undefined =>
        data.versions.find((v) => (v.part ?? 0) === order)?.thumbnail;
      return { host: byPart(0), imported: byPart(1) };
    });

    // The merged part carries a freshly regenerated, non-trivial PNG thumbnail…
    expect(thumbs.imported).toBeTruthy();
    expect(thumbs.imported!.startsWith('data:image/png')).toBe(true);
    expect(thumbs.imported!.length).toBeGreaterThan(256);
    // …and it is NOT a copy of the host sphere's thumbnail (the stale-capture
    // bug produced an identical image because both runs read the host's mesh).
    expect(thumbs.imported).not.toBe(thumbs.host);
  });

  test('switching between a manifold-js part and a merged voxel part runs each under its own engine', async ({ page }) => {
    await openEditor(page);

    // A source session whose single part is authored in the VOXEL language. We
    // export it, then merge it into a manifold-js session — producing the mixed-
    // language session the bug needs (manifold-js Part 1 + voxel Part 2).
    const json = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & {
        setActiveLanguage: (l: string) => Promise<void>;
      } }).partwright;
      await pw.createSession('voxel-source');
      await pw.setActiveLanguage('voxel');
      // A minimal voxel model — `api.voxels()` exists only under the voxel
      // engine (the manifold-js sandbox has `api.Manifold` instead).
      await pw.runAndSave('const { voxels } = api; return voxels().fillBox([0,0,0],[5,5,5], "#88aaff");', 'v1');
      const { data } = await pw.exportSessionData();
      return JSON.stringify(data);
    });

    // The host: a fresh manifold-js session. Crucially Part 1 here is the
    // DEFAULT, UNSAVED starter — it has no saved version, so switching back to
    // it goes through the version-less `loadPartIntoEditor(null)` path. Re-run
    // the starter so it's the active, render-clean manifold-js part.
    await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { run: (c: string) => Promise<unknown> } }).partwright;
      await pw.createSession('host-manifold');
      await pw.run('const { Manifold } = api; return Manifold.cube([10,10,10], true);');
    });

    // Merge the voxel part in via the toolbar import → "Add parts".
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'voxel.partwright.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json, 'utf8'),
    });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });
    await dialog.getByRole('button', { name: 'Add parts' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Two parts now: [0] = manifold-js host (unsaved starter), [1] = voxel.
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: PW }).partwright.listParts().length),
    ).toBe(2);

    type PartChange = { active: string; error?: string };
    const switchTo = (idx: number): Promise<PartChange> =>
      page.evaluate(async (i: number) => {
        const w = window as unknown as {
          partwright: PW & {
            changePart: (id: string) => Promise<unknown>;
            getActiveLanguage: () => string;
          };
        };
        const pw = w.partwright;
        const parts = pw.listParts();
        try {
          await pw.changePart(parts[i].id);
          return { active: pw.getActiveLanguage() };
        } catch (e) {
          return { active: pw.getActiveLanguage(), error: e instanceof Error ? e.message : String(e) };
        }
      }, idx);

    // Switch to the voxel part (index 1): engine becomes voxel, no error.
    const onVoxel = await switchTo(1);
    expect(onVoxel.error).toBeUndefined();
    expect(onVoxel.active).toBe('voxel');

    // Switch back to the manifold-js host (index 0). This is the regression:
    // before the fix, the version-less starter ran its `Manifold.cube(...)`
    // under the still-active voxel engine and threw "Cannot read properties of
    // undefined (reading 'cube')", leaving the language stuck on voxel.
    const onHost = await switchTo(0);
    expect(onHost.error).toBeUndefined();
    expect(onHost.active).toBe('manifold-js');

    // And the round-trip back to voxel still works cleanly.
    const backToVoxel = await switchTo(1);
    expect(backToVoxel.error).toBeUndefined();
    expect(backToVoxel.active).toBe('voxel');
  });

  test('"Import from URL…" rejects an unsupported scheme inline', async ({ page }) => {
    await openEditor(page);

    await page.locator('#btn-import').click();
    await page.getByText('Import from URL…').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });
    await expect(dialog).toContainText('Import from URL');

    const input = dialog.locator('input[type="text"]');
    await input.fill('file:///etc/passwd');
    await dialog.getByRole('button', { name: 'Import' }).click();
    // Inline validation error; the modal stays open (no network attempt).
    await expect(dialog).toContainText('Only http(s) URLs or share links');
    await expect(dialog).toBeVisible();
  });

  test('"Import from URL…" decodes a pasted share link with no network', async ({ page }) => {
    await openEditor(page);

    // Make a real share link via the console API, then close the session so the
    // import lands cleanly as a new one.
    const shareUrl = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW & { getShareLink: () => Promise<{ url?: string }> } }).partwright;
      await pw.createSession('to-share');
      await pw.runAndSave('const { Manifold } = api; return Manifold.cube([7,7,7], true);', 'v1');
      const r = await pw.getShareLink();
      return r.url ?? '';
    });
    expect(shareUrl).toContain('#share=');

    await page.locator('#btn-import').click();
    await page.getByText('Import from URL…').click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 6000 });

    await dialog.locator('input[type="text"]').fill(shareUrl);
    await dialog.getByRole('button', { name: 'Import' }).click();

    // The share preview modal opens (same chooser as a file import). Confirm a
    // new-session import; the share decode happened entirely client-side.
    const previewDialog = page.locator('[role="dialog"]');
    await expect(previewDialog).toContainText('Import session', { timeout: 10_000 });
  });
});
