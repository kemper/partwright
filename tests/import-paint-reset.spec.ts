import { test, expect } from 'playwright/test';

// Regression: importing a fresh model must NOT inherit the previous painted
// model's color regions.
//
// Color regions live in module state the session layer doesn't own. The import
// chokepoints (importCodePayload / importMeshPayload) create a brand-new
// session but used to leave that state untouched, so the next runCodeSync
// re-resolved the old regions onto the freshly-imported mesh — a painted part's
// colors bleeding onto image→voxel art — and the editor opened locked. The
// fix drops paint state (dropPaintState() in src/main.ts) before running the
// imported code. See the `for the image to voxel feature` bug report.

test.describe('import resets stale paint state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('image→voxel import drops a painted model’s regions and unlocks the editor', async ({ page }) => {
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
});
