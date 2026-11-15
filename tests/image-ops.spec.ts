import { test, expect } from 'playwright/test';

// Image tools as code ops (#1256 Stage B): an attached image read by model
// code — api.imageTile / api.lithophane in manifold-js, api.voxelsFromImage in
// a voxel session. Uses a synthetic image drawn in the page.

async function syntheticImage(page: import('playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 160, 120);
    g.fillStyle = '#d2452b'; g.beginPath(); g.arc(60, 60, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f6fd0'; g.fillRect(96, 30, 44, 60);
    return c.toDataURL('image/png');
  });
}

test.describe('Image tools as code', () => {
  test('api.imageTile labels colour parts; api.lithophane and voxel fromImage build', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.runAndSave);
    await page.evaluate(async () => {
      const pw = (window as any).partwright;
      for (let i = 0; i < 60; i++) {
        const p = await pw.runAndSave('return api.Manifold.cube([1, 1, 1], true);', 'probe', {});
        if (p && !p.error && p.version) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
    const src = await syntheticImage(page);

    const res = await page.evaluate(async (src) => {
      const pw = (window as any).partwright;
      pw.setImages([{ src, id: 'opsimg' }]);
      const tile = await pw.runAndSave(`const img = api.image('opsimg');
return api.imageTile(img, { common: { widthMm: 50, resolution: 80 }, quantized: { clusters: 3 } });`, 'tile', { isManifold: true });
      const tileParts = pw.listObjectParts();
      const op = pw.getImageToolOp();
      const composed = await pw.run(`const t = api.imageTile(api.image('opsimg'), { common: { widthMm: 50, resolution: 80 }, quantized: { clusters: 3 } });
return t.add(api.Manifold.cube([4, 4, 8]).translate([-2, -2, 0]));`);
      const bad = await pw.run("return api.imageTile(api.image('opsimg'), { quantized: { clusterz: 3 } });");
      const litho = await pw.runAndSave("return api.lithophane(api.image('opsimg'), { common: { widthMm: 40, resolution: 60 }, luminance: { invert: true } });", 'litho', { isManifold: true });
      const lithoGeo = pw.getGeometryData();
      await pw.createObject('voxel art');
      await pw.setActiveLanguage('voxel');
      const vox = await pw.runAndSave("return api.voxelsFromImage(api.image('opsimg'), { maxSize: 24 });", 'vox', {});
      const voxGeo = pw.getGeometryData();
      return { tile, tileParts, op, composed, bad, litho, lithoGeo, vox, voxGeo, voxLang: pw.getActiveLanguage() };
    }, src);

    expect(res.tile.error ?? null).toBeNull();
    const names = res.tileParts.parts.map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(['colour-1', 'colour-2', 'colour-3']));
    for (const p of res.tileParts.parts.filter((x: any) => /^colour-/.test(x.name))) {
      expect(p.triangleCount).toBeGreaterThan(0);
      expect(p.colorSource).toBe('code');
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // The cream background is the largest region → colour-1.
    const c1 = res.tileParts.parts.find((p: any) => p.name === 'colour-1');
    expect(parseInt(c1.color.slice(1, 3), 16)).toBeGreaterThan(200);
    expect(res.op).toMatchObject({ tool: 'tile', image: 'opsimg', params: { quantized: { clusters: 3 } } });
    expect(res.composed.error ?? null).toBeNull();
    expect(String(res.bad.error)).toMatch(/unknown option "quantized\.clusterz"/);

    expect(res.litho.error ?? null).toBeNull();
    expect(res.lithoGeo.isManifold).toBe(true);

    expect(res.voxLang).toBe('voxel');
    expect(res.vox.error ?? null).toBeNull();
    expect(res.voxGeo.voxelCount).toBeGreaterThan(100);

    await page.screenshot({ path: 'test-results/image-ops.png' });
  });
});
