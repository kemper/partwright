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
    // Dismiss the product tour up front so its backdrop can't intercept the
    // toolbar clicks the import-history test makes.
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('import dropdown has a dedicated "Image → voxel" row', async ({ page }) => {
    await page.locator('#btn-import').click();
    await expect(page.getByText('Image → voxel…')).toBeVisible();
  });

  test('voxel image import is remembered as voxel and reopens the voxel modal', async ({ page }) => {
    // Stand-in image fed straight to the shared import input (the file-drop /
    // "Image → voxel" path), which routes to the voxel parameter modal.
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      const x = c.getContext('2d')!;
      x.fillStyle = '#3399ff'; x.fillRect(0, 0, 8, 8);
      return c.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    await page.locator('#import-wrapper input[type="file"]').first()
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer });

    // The voxel modal (not the relief wizard) opens; commit it.
    await expect(page.getByText('Image → Voxel', { exact: true })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect.poll(async () => page.evaluate(
      () => (window as any).partwright.getActiveLanguage(), // eslint-disable-line @typescript-eslint/no-explicit-any
    ), { timeout: 10_000 }).toBe('voxel');

    // Recent Imports shows it tagged VOXEL with a thumbnail.
    await page.locator('#btn-import').click();
    const recent = page.locator('#import-recent-list button', { hasText: 'logo.png' }).first();
    await expect(recent).toBeVisible();
    await expect(recent.getByText('VOXEL', { exact: true })).toBeVisible();
    await expect(recent.locator('img')).toBeVisible();

    // Re-clicking the entry reopens the VOXEL modal — the bug was it opened relief.
    await recent.click();
    await expect(page.getByText('Image → Voxel', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Make a part from an image', { exact: true })).toHaveCount(0);
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

  test('importImageAsVoxels heightmap mode raises brighter pixels', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // 2×1 image: a white pixel (tall) and a black pixel (base only).
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = '#000000';
      ctx.fillRect(1, 0, 1, 1);
      const url = canvas.toDataURL('image/png');
      const imp = await pw.importImageAsVoxels(url, {
        mode: 'heightmap', maxHeight: 10, baseThickness: 1,
      });
      return { imp, geo: pw.getGeometryData() };
    });

    expect(result.imp.error).toBeFalsy();
    // White column = base(1) + 10 = 11, black column = base(1) + 0 = 1 → 12.
    expect(result.imp.voxelCount).toBe(12);
    expect(result.geo.isManifold).toBe(true);
  });

  test('importImageAsVoxels posterize + removeBackground produce a clean manifold', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // White border (background) with a 2×2 multi-shade green subject.
      const canvas = document.createElement('canvas');
      canvas.width = 4;
      canvas.height = 4;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 4, 4);
      const greens = ['#00c800', '#10d010', '#00b800', '#08c808'];
      let n = 0;
      for (let y = 1; y <= 2; y++) for (let x = 1; x <= 2; x++) { ctx.fillStyle = greens[n++]; ctx.fillRect(x, y, 1, 1); }
      const url = canvas.toDataURL('image/png');
      const imp = await pw.importImageAsVoxels(url, { removeBackground: true, posterizeColors: 2 });
      return { imp, geo: pw.getGeometryData() };
    });

    expect(result.imp.error).toBeFalsy();
    // Background dropped → only the 2×2 = 4 subject voxels remain (depth 1).
    expect(result.imp.voxelCount).toBe(4);
    expect(result.geo.isManifold).toBe(true);
  });

  test('smooth surfacing rounds the mesh while staying a manifold', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      const block = await pw.run(`
        const { voxels } = api;
        return voxels().fillBox([0,0,0],[5,5,5], '#3399ff');
      `);
      const smooth = await pw.run(`
        const { voxels } = api;
        return voxels().fillBox([0,0,0],[5,5,5], '#3399ff').smooth();
      `);
      return { block, smooth };
    });
    expect(result.block.error).toBeFalsy();
    expect(result.smooth.error).toBeFalsy();
    // The real-WASM proof: ofMesh accepts the smoothed mesh too.
    expect(result.smooth.isManifold).toBe(true);
    expect(result.smooth.componentCount).toBe(1);
    // detail 1 only moves vertices, so the triangle count matches the block mesh.
    expect(result.smooth.triangleCount).toBe(result.block.triangleCount);
    // Still a valid, positive-volume solid (Taubin's anti-shrink pass keeps the
    // size roughly stable rather than collapsing it).
    expect(result.smooth.volume).toBeGreaterThan(0);
  });

  test('smooth with higher detail densifies and stays manifold', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      return await pw.run(`
        const { voxels } = api;
        return voxels().cylinder([0,0,0], 4, 12, '#ff8c42').smooth({ iterations: 2, detail: 2 });
      `);
    });
    expect(result.error).toBeFalsy();
    expect(result.isManifold).toBe(true);
    expect(result.triangleCount).toBeGreaterThan(0);
  });

  test('hollow + smooth (thin shell) still produces a valid manifold', async ({ page }) => {
    // Smoothing preserves topology, so even a 1-voxel-thick shell stays a
    // topological manifold (it can self-intersect geometrically — documented —
    // but it must not error or crash the run).
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      return await pw.run(`
        const { voxels } = api;
        return voxels().fillBox([0,0,0],[7,7,7],'#88aaff').hollow(1).smooth();
      `);
    });
    expect(result.error).toBeFalsy();
    expect(result.isManifold).toBe(true);
  });

  test('exportVOXData round-trips a voxel model back through the parser', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`
        const { voxels } = api;
        const v = voxels();
        v.fillBox([0,0,0],[2,0,0], '#ff0000'); // 3 red
        v.set(0,0,1,'#00ff00');                // 1 green
        return v;
      `);
      const data = await pw.exportVOXData();
      // Decode the returned base64 and re-parse it with the production importer,
      // proving the bytes we wrote are a valid, readable .vox file.
      const bin = atob(data.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { parseVox } = await import('/src/import/parsers/vox');
      const grid = parseVox(bytes);
      const colors = new Set<number>();
      grid.forEach((_x: number, _y: number, _z: number, c: number) => colors.add(c));
      return { data, size: grid.size, colors: [...colors].sort((a, b) => a - b) };
    });

    expect(result.data.error).toBeFalsy();
    expect(result.data.filename).toMatch(/\.vox$/);
    expect(result.data.mimeType).toBe('application/octet-stream');
    expect(result.data.sizeBytes).toBeGreaterThan(0);
    expect(result.size).toBe(4);
    expect(result.colors).toEqual([0x00ff00, 0xff0000]);
  });

  test('exportVOXData reports a clear error outside a voxel session', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('manifold-js');
      return await pw.exportVOXData();
    });
    expect(result.error).toMatch(/voxel/i);
  });
});
