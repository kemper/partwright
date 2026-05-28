import { test, expect } from 'playwright/test';

// Voxel engine integration smoke. The critical thing this covers that the unit
// tier can't: the voxel mesh, once built by the pure-JS mesher, is fed through
// the real main-thread `Manifold.ofMesh(mesh)` reconstruction (for stats /
// slicing / export). If the mesh weren't a watertight, consistently-wound
// 2-manifold, ofMesh would reject it and `isManifold` would be false (or the
// run would error) — so these assertions are the real-WASM proof the mesher is
// correct. Also exercises the image → voxel import through the DOM decode path.

test.describe('voxel engine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('switching to voxel renders a watertight, colored, manifold mesh', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      // A single unit voxel: 8 welded verts, 12 triangles, volume 1.
      const out = await pw.run(`
        const { voxels } = api;
        const v = voxels();
        v.set(0, 0, 0, '#ff0000');
        return v;
      `);
      return { lang: pw.getActiveLanguage(), out };
    });

    expect(result.lang).toBe('voxel');
    expect(result.out.error).toBeFalsy();
    // ofMesh accepted it → it's a real, closed manifold.
    expect(result.out.isManifold).toBe(true);
    expect(result.out.componentCount).toBe(1);
    expect(result.out.triangleCount).toBe(12);
    // A 1×1×1 voxel is one cubic unit.
    expect(result.out.volume).toBeCloseTo(1, 5);
  });

  test('a multi-voxel model stays a single manifold component', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      return await pw.run(`
        const { voxels } = api;
        const v = voxels();
        v.fillBox([0, 0, 0], [3, 3, 3], '#3399ff'); // solid 4×4×4 block
        return v;
      `);
    });

    expect(result.error).toBeFalsy();
    expect(result.isManifold).toBe(true);
    expect(result.componentCount).toBe(1);
    // Solid 4×4×4 block: only the shell survives. 6 faces × 16 quads × 2 = 192.
    expect(result.triangleCount).toBe(192);
    expect(result.volume).toBeCloseTo(64, 4);
  });

  test('returning a non-grid surfaces a targeted error', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      return await pw.run('return 42;');
    });
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/return.*grid/i);
  });

  test('importImageAsVoxels builds a voxel session from an image', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Build a 4×4 opaque-red image with one transparent corner pixel.
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 4, 4);
      ctx.clearRect(0, 0, 1, 1); // one transparent pixel
      const url = canvas.toDataURL('image/png');
      const imp = await pw.importImageAsVoxels(url, { depth: 1 });
      return { imp, lang: pw.getActiveLanguage(), geo: pw.getGeometryData() };
    });

    expect(result.imp.error).toBeFalsy();
    // 16 pixels − 1 transparent = 15 voxels.
    expect(result.imp.voxelCount).toBe(15);
    expect(result.lang).toBe('voxel');
    expect(result.geo.isManifold).toBe(true);
  });
});
