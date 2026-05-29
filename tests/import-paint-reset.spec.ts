import { test, expect, type Page } from 'playwright/test';

// Regression: importing a fresh model must NOT inherit the previous painted
// model's color regions.
//
// Color regions live in module state the session/part layer doesn't own. The
// import chokepoints (importCodePayload / importMeshPayload / applyImportWrapper)
// create or reseed a part but used to leave that state untouched, so the next
// runCodeSync re-resolved the old regions onto the freshly-imported mesh — a
// painted part's colors bleeding onto image→voxel art or an imported STL — and
// the editor opened locked. The fix drops paint state (dropPaintState() in
// src/main.ts) before running the imported code. See the
// `for the image to voxel feature` bug report.

/** A 10×10×10 binary-STL cube (12 triangles). Mirrors tests/import-target.spec.ts. */
function buildCubeSTL(): Buffer {
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
  return Buffer.from(new Uint8Array(buf));
}

async function waitForEngine(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('import resets stale paint state', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress the first-visit tour so its backdrop doesn't eat the modal click.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('image→voxel import drops a painted model’s regions and unlocks the editor', async ({ page }) => {
    await waitForEngine(page);
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;

      // 1. Paint a manifold-js model so the region store + editor lock are live.
      await pw.createSession('painted-cube');
      await pw.runAndSave(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`, 'v1');
      const paint = pw.paintFaces({ triangleIds: [0, 1], color: [1, 0, 0], name: 'red' });
      const regionsBefore = pw.listRegions().length;
      const lockedBefore = !!document.getElementById('editor-lock-overlay');

      // 2. Build a tiny opaque image and import it as voxels (→ importCodePayload).
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#3366ff';
      ctx.fillRect(0, 0, 8, 8);
      const dataUrl = canvas.toDataURL('image/png');
      const imported = await pw.importImageAsVoxels(dataUrl, { maxSize: 8 });

      // 3. After import: no leftover regions, editor unlocked, voxel code loaded.
      const regionsAfter = pw.listRegions().length;
      const lockedAfter = !!document.getElementById('editor-lock-overlay');
      const code = pw.getCode();
      return { paint, regionsBefore, lockedBefore, imported, regionsAfter, lockedAfter, code };
    });

    // Painting created exactly one region and locked the editor...
    expect(result.paint.error).toBeFalsy();
    expect(result.regionsBefore).toBe(1);
    expect(result.lockedBefore).toBe(true);

    // ...the voxel import succeeded...
    expect(result.imported.error).toBeFalsy();
    expect(result.imported.voxelCount).toBeGreaterThan(0);

    // ...and the freshly-imported voxel art starts clean: no inherited paint,
    // editor unlocked, procedural voxel code in the editor.
    expect(result.regionsAfter).toBe(0);
    expect(result.lockedAfter).toBe(false);
    expect(result.code).toContain('voxels.decode(');
  });

  test('STL "New part" import drops the previous part’s paint and unlocks the editor', async ({ page }) => {
    await waitForEngine(page);

    // Paint the current part: an in-memory region that also locks the editor.
    const before = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('host');
      await pw.runAndSave(`const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`, 'base');
      pw.paintFaces({ triangleIds: [0, 1], color: [0, 1, 0], name: 'green' });
      return { regions: pw.listRegions().length, locked: !!document.getElementById('editor-lock-overlay') };
    });
    expect(before.regions).toBe(1);
    expect(before.locked).toBe(true);

    // Import an STL and route it to a brand-new part (→ applyImportWrapper).
    await page.locator('#import-wrapper input[type="file"]').setInputFiles({
      name: 'widget.stl',
      mimeType: 'application/octet-stream',
      buffer: buildCubeSTL(),
    });
    await page.getByRole('dialog').locator('[data-target="new-part"]').click();

    // A second part appears, and the new part starts clean: no inherited paint.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { partwright: { listParts: () => unknown[] } }).partwright.listParts().length))
      .toBe(2);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { partwright: { listRegions: () => unknown[] } }).partwright.listRegions().length))
      .toBe(0);

    // ...and the editor is no longer locked.
    await expect(page.locator('#editor-lock-overlay')).toHaveCount(0);
    const code = await page.evaluate(() => (window as unknown as { partwright: { getCode: () => string } }).partwright.getCode());
    expect(code).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
