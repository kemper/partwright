// Regression tests for STL import:
//  - Binary STL goes through the file picker → new session is created
//    with the auto-generated wrapper `return Manifold.ofMesh(api.imports[0])`
//  - Mesh data round-trips through IndexedDB so reload restores it
//  - The wrapper code is editable (subtract a primitive and re-render)

import { test, expect } from 'playwright/test';

/** Build a small binary-STL cube (10×10×10) as a base64 string so it can
 *  be reconstructed inside the page context for Playwright's setInputFiles. */
function buildCubeSTLBase64(): string {
  const s = 5;
  const v = [
    [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
    [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
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
  return Buffer.from(new Uint8Array(buf)).toString('base64');
}

test.describe('STL import', () => {
  // Suppress the first-visit guided tour so its backdrop doesn't intercept the
  // import-target modal's buttons.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('binary STL creates a new session with an editable Manifold.ofMesh wrapper', async ({ page }) => {
    const stlBase64 = buildCubeSTLBase64();

    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    // Drive the hidden file input the toolbar's Import button targets.
    const fileInput = page.locator('#import-wrapper input[type="file"]');
    await fileInput.setInputFiles({
      name: 'unit-cube.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(stlBase64, 'base64'),
    });

    // The fresh editor is an expendable starter part, so the import-target modal
    // appears; choose to use the mesh as the current part.
    await page.getByRole('dialog').locator('[data-target="current-part"]').click();

    // Wait for the import to finish — the editor's code buffer should pick up
    // the auto-generated wrapper. "Ready" alone isn't sufficient because the
    // editor is already rendering the default cube before the import runs.
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => ((window as any).partwright?.getCode?.() ?? '').includes('Manifold.ofMesh(api.imports[0])'),
      undefined,
      { timeout: 15000 },
    );

    // Confirm the wrapper code and a working Manifold via the public console API.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const code = pw.getCode();
      const geo = pw.getGeometryData();
      return { code, volume: geo.volume, isManifold: geo.isManifold, triangleCount: geo.triangleCount };
    });

    expect(result.code).toContain('Manifold.ofMesh(api.imports[0])');
    expect(result.code).toContain('unit-cube.stl');
    expect(result.volume).toBeCloseTo(1000, 1);
    expect(result.isManifold).toBe(true);
    expect(result.triangleCount).toBe(12);
  });

  test('imported mesh stays editable — wrapper composes with code-defined primitives', async ({ page }) => {
    const stlBase64 = buildCubeSTLBase64();

    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 15000 });

    const fileInput = page.locator('#import-wrapper input[type="file"]');
    await fileInput.setInputFiles({
      name: 'unit-cube.stl',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(stlBase64, 'base64'),
    });

    // The fresh editor is an expendable starter part, so the import-target modal
    // appears; choose to use the mesh as the current part.
    await page.getByRole('dialog').locator('[data-target="current-part"]').click();

    // Wait for the import to finish — the editor's code buffer should pick up
    // the auto-generated wrapper. "Ready" alone isn't sufficient because the
    // editor is already rendering the default cube before the import runs.
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => ((window as any).partwright?.getCode?.() ?? '').includes('Manifold.ofMesh(api.imports[0])'),
      undefined,
      { timeout: 15000 },
    );

    // Subtract a 5-cube from the corner; expected volume = 1000 - 125 = 875.
    const geo = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      return pw.run(`
        const { Manifold } = api;
        return Manifold.ofMesh(api.imports[0]).subtract(Manifold.cube([5, 5, 5]));
      `);
    });

    expect(geo.volume).toBeCloseTo(875, 1);
    expect(geo.isManifold).toBe(true);
  });
});
