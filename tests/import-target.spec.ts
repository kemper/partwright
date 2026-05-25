// E2E coverage for the import-target modal: when an STL is imported into a
// session that already has saved work, the user chooses where it lands —
// a new part, the current part (composed), or a new session. Network-free.

import { test, expect, type Page } from 'playwright/test';

interface ImportAPI {
  createSession: (name?: string) => Promise<{ id: string }>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  getCode: () => string;
  getGeometryData: () => Record<string, number>;
  listParts: () => { id: string; name: string }[];
  getSessionState: () => { versionCount: number };
}

function pw(page: Page) {
  return page.evaluate.bind(page);
}

/** Build a 10×10×10 binary-STL cube (12 triangles), optionally shifted along X
 *  so two imports stay distinct components after composing. */
function buildCubeSTL(offsetX = 0): Buffer {
  const s = 5;
  const v = [
    [-s + offsetX, -s, -s], [s + offsetX, -s, -s], [s + offsetX, s, -s], [-s + offsetX, s, -s],
    [-s + offsetX, -s, s], [s + offsetX, -s, s], [s + offsetX, s, s], [-s + offsetX, s, s],
  ];
  const faces = [
    [v[0], v[2], v[1]], [v[0], v[3], v[2]],
    [v[4], v[5], v[6]], [v[4], v[6], v[7]],
    [v[0], v[1], v[5]], [v[0], v[5], v[4]],
    [v[2], v[3], v[7]], [v[2], v[7], v[6]],
    [v[0], v[4], v[7]], [v[0], v[7], v[3]],
    [v[1], v[2], v[6]], [v[1], v[6], v[5]],
  ];
  const buf = new ArrayBuffer(84 + faces.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, faces.length, true);
  let off = 84;
  for (const tri of faces) {
    off += 12;
    for (const vert of tri) {
      view.setFloat32(off, vert[0], true); off += 4;
      view.setFloat32(off, vert[1], true); off += 4;
      view.setFloat32(off, vert[2], true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2;
  }
  return Buffer.from(new Uint8Array(buf));
}

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { runAndSave?: unknown } }).partwright?.runAndSave,
    { timeout: 20_000 },
  );
}

async function setupHostSession(page: Page, code: string) {
  await page.evaluate(async (c) => {
    const api = (window as unknown as { partwright: ImportAPI }).partwright;
    await api.createSession('host');
    await api.runAndSave(c, 'base');
  }, code);
}

test.describe('Import target modal', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-visit tour so its backdrop doesn't eat clicks.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('importing into a session with saved work offers a target choice', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await setupHostSession(page, 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);');

    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'widget.stl',
      mimeType: 'application/octet-stream',
      buffer: buildCubeSTL(),
    });

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Import mesh');
    await expect(dialog).toContainText('widget.stl');
  });

  test('"New part" adds a second part holding the imported mesh', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await setupHostSession(page, 'const { Manifold } = api; return Manifold.cube([10, 10, 10], true);');

    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'widget.stl',
      mimeType: 'application/octet-stream',
      buffer: buildCubeSTL(),
    });

    await page.getByRole('dialog').locator('[data-target="new-part"]').click();

    await expect
      .poll(() => pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.listParts().length))
      .toBe(2);

    const code = await pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.getCode());
    expect(code).toContain('Manifold.ofMesh(api.imports[0])');
    expect(code).toContain('widget.stl');
  });

  test('"Add to current part" composes a second imported mesh into an import-based part', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const fileInput = page.locator('#import-wrapper input[type="file"]');

    // First import: the fresh starter part is expendable, so seed it with the
    // mesh (the modal recommends "Use for current part"). Now the current part
    // is import-based, which is the prerequisite for combining a second mesh.
    await fileInput.setInputFiles({ name: 'a.stl', mimeType: 'application/octet-stream', buffer: buildCubeSTL(0) });
    await page.getByRole('dialog').locator('[data-target="current-part"]').click();
    // Wait for the seed's version to be persisted (not just the editor text set),
    // so the part is recognized as import-based when the second mesh arrives.
    await expect
      .poll(() => pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.getSessionState().versionCount))
      .toBe(1);

    // Second import (offset so it stays a distinct component): add to current.
    await fileInput.setInputFiles({ name: 'b.stl', mimeType: 'application/octet-stream', buffer: buildCubeSTL(30) });
    await page.getByRole('dialog').locator('[data-target="current-part"]').click();

    // Combined geometry: 12 + 12 triangles across two components.
    await expect
      .poll(() => pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.getGeometryData().triangleCount))
      .toBe(24);

    const geo = await pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.getGeometryData());
    expect(geo.componentCount).toBe(2);

    // Still a single part — the mesh was combined in, not added as a new part.
    const partCount = await pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.listParts().length);
    expect(partCount).toBe(1);

    const code = await pw(page)(() => (window as unknown as { partwright: ImportAPI }).partwright.getCode());
    expect(code).toContain('Manifold.compose');
  });
});
