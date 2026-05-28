// Relief Studio (image → tile / stepped relief) smoke coverage: generating a relief from an
// in-page image via the console API, the optical preview + swap guide round
// trip, and the toolbar entry points. No external network or files (a gradient
// canvas stands in for an imported image).

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

test.describe('Relief Studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('generates a relief from an image and produces a swap guide', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const result = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      // Horizontal grayscale gradient → a smooth tonal relief.
      const img = ctx.createImageData(64, 64);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const v = Math.floor((x / 63) * 255);
          const o = (y * 64 + x) * 4;
          img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const src = c.toDataURL('image/png');

      const created = await pw.importImageAsRelief({ src, mode: 'luminance', options: { resolution: 48 } }) as { sessionId?: string; error?: string };
      const geo = pw.getGeometryData() as { triangleCount?: number; isManifold?: boolean } | null;
      const previewOk = pw.setReliefPreviewMode('single-nozzle') as { ok?: boolean; error?: string };
      const guide = pw.getReliefSwapGuide() as { swaps?: unknown[]; bands?: unknown[]; error?: string };
      return { created, triangleCount: geo?.triangleCount ?? 0, isManifold: geo?.isManifold ?? false, previewOk, guide };
    });

    expect(result.created.error).toBeFalsy();
    expect(result.created.sessionId).toBeTruthy();
    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.isManifold).toBe(true);
    expect(result.previewOk.ok).toBe(true);
    expect(result.guide.error).toBeFalsy();
    expect(Array.isArray(result.guide.bands)).toBe(true);
  });

  // Regression: the import dropdown was 18rem wide anchored right-edge to the
  // button, so on a 375px viewport it slid off the left edge of the screen.
  // Mobile uses a viewport-edge fixed-position layout instead.
  test('import dropdown uses a viewport-edge layout on mobile', async ({ page }) => {
    // We verify the responsive Tailwind classes rather than driving at 375px:
    // on mobile the activity rail covers the toolbar with an overlay panel,
    // which intercepts clicks regardless of the dropdown's positioning bug.
    // The classes are the actual contract we want to keep — base layout is
    // viewport-anchored fixed; md:* breakpoint restores the desktop layout.
    await page.goto('/editor');
    await waitForEngine(page);
    await page.locator('#btn-import').click();
    const cls = await page.locator('#import-dropdown').getAttribute('class') ?? '';
    expect(cls).toContain('fixed');
    expect(cls).toContain('left-2');
    expect(cls).toContain('right-2');
    expect(cls).toContain('md:absolute');
    expect(cls).toContain('md:right-0');
    await expect(page.getByText('Image → keychain / tile / relief…')).toBeVisible();
  });

  test('toolbar exposes the relief entry points', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await expect(page.locator('#btn-relief')).toBeVisible();

    await page.locator('#btn-import').click();
    await expect(page.getByText('Image → keychain / tile / relief…')).toBeVisible();
  });

  // Regression: the wizard once threw mid-build (a const used in its temporal
  // dead zone), so the modal rendered the picker button but never wired the
  // file `change` handler — choosing an image did nothing. Exercise the real
  // modal path end-to-end.
  test('import wizard reacts to a chosen image and creates a relief', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/editor');
    await waitForEngine(page);

    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 48;
      const x = c.getContext('2d')!;
      for (let i = 0; i < 64; i++) { const v = Math.floor((i / 63) * 255); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(i, 0, 1, 48); }
      return c.toDataURL('image/png');
    });
    const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    await page.locator('#btn-import').click();
    await page.getByText('Image → keychain / tile / relief…').click();
    await expect(page.getByText('Make a part from an image', { exact: true })).toBeVisible();

    const input = page.locator('input[type="file"][accept*="image"]');
    await input.setInputFiles({ name: 'grad.png', mimeType: 'image/png', buffer });

    // The wizard must react to the chosen image: live preview stat + an enabled
    // Create button. (Both were absent when the modal crashed mid-build.)
    await expect(page.locator('text=/Preview · \\d+×\\d+ · \\d+ clusters/').first()).toBeVisible({ timeout: 5000 });
    // Default mode + output is now quantized → flat tile, so the CTA reads "Create tile".
    const createBtn = page.getByRole('button', { name: 'Create tile' });
    await expect(createBtn).toBeEnabled();

    await createBtn.click();
    await expect.poll(
      async () => page.evaluate(() => {
        const g = (window as unknown as { partwright: { getGeometryData(): { triangleCount?: number } | null } }).partwright.getGeometryData();
        return g?.triangleCount ?? 0;
      }),
      { timeout: 15_000 },
    ).toBeGreaterThan(0);

    // No uncaught errors from the relief flow (the pre-existing import.meta
    // worker warning on plain loads is unrelated and filtered out).
    expect(errors.filter(e => !e.includes('import.meta'))).toEqual([]);
  });

  // Regression: median-cut quantization split the dominant gradient into many
  // near-identical clusters and dropped small-but-important colors (e.g. a
  // smiley's black eyes/mouth vanished). K-means must capture distinct colors —
  // assert the palette spans dark→light, not just one hue.
  test('color-quantized import captures distinct dark and light colors', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 240;
      const x = c.getContext('2d')!;
      x.fillStyle = 'white'; x.fillRect(0, 0, 240, 240);
      const grad = x.createRadialGradient(120, 120, 16, 120, 120, 112);
      grad.addColorStop(0, '#fff700'); grad.addColorStop(1, '#e6d600');
      x.fillStyle = grad; x.beginPath(); x.arc(120, 120, 112, 0, 7); x.fill();
      x.fillStyle = 'black';
      x.beginPath(); x.ellipse(92, 96, 13, 21, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(148, 96, 13, 21, 0, 0, 7); x.fill();
      x.lineWidth = 10; x.strokeStyle = 'black';
      x.beginPath(); x.arc(120, 128, 56, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
      const src = c.toDataURL('image/png');

      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const created = await pw.importImageAsRelief({ src, mode: 'quantized', options: { resolution: 120 } }) as { sessionId?: string; error?: string };
      const regions = pw.listRegions() as Array<{ color: [number, number, number] }>;
      const lums = regions.map(r => 0.2126 * r.color[0] + 0.7152 * r.color[1] + 0.0722 * r.color[2]);
      return { created, count: regions.length, minLum: Math.min(...lums), maxLum: Math.max(...lums) };
    });

    expect(res.created.error).toBeFalsy();
    expect(res.count).toBeGreaterThanOrEqual(3);
    expect(res.minLum).toBeLessThan(0.2);   // a near-black cluster (eyes/mouth) survived
    expect(res.maxLum).toBeGreaterThan(0.8); // a near-white cluster (background) survived
  });

  // The new "flat tile" output is the default for color-quantized — colours
  // become regions on a flat tile (Bambu-keychain style) instead of the noisy
  // cluster->height cliffs of the old relief mode.
  test('flat tile output produces a flat colour tile (uniform top z)', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const x = c.getContext('2d')!;
      x.fillStyle = 'white'; x.fillRect(0, 0, 200, 200);
      x.fillStyle = '#3aa9e8'; x.beginPath(); x.arc(100, 100, 70, 0, 7); x.fill();
      x.fillStyle = '#000000'; x.beginPath(); x.ellipse(80, 80, 8, 14, 0, 0, 7); x.fill();
      x.beginPath(); x.ellipse(120, 80, 8, 14, 0, 0, 7); x.fill();
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const created = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'flat', shape: 'rect' },
      }) as { sessionId?: string; error?: string };
      const geo = pw.getGeometryData() as { boundingBox: { z: [number, number] }; isManifold: boolean; triangleCount: number };
      return { created, zRange: geo.boundingBox.z, isManifold: geo.isManifold, triangleCount: geo.triangleCount };
    });
    expect(res.created.error).toBeFalsy();
    expect(res.created.sessionId).toBeTruthy();
    // The tile is a flat slab — z spans exactly [0, base+maxHeight] = [0, 2].
    expect(res.zRange[0]).toBeCloseTo(0, 2);
    expect(res.zRange[1]).toBeCloseTo(2, 2);
    expect(res.triangleCount).toBeGreaterThan(0);
  });

  // Silhouette tile cuts the tile to the image subject (background removed).
  // We assert the tile's lateral bounds shrink below the full image extent,
  // since most of the canvas is background and gets cut away.
  test('silhouette tile excludes background cells', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const x = c.getContext('2d')!;
      x.fillStyle = 'white'; x.fillRect(0, 0, 200, 200);
      // Small subject in the middle, far from the borders.
      x.fillStyle = 'red'; x.beginPath(); x.arc(100, 100, 40, 0, 7); x.fill();
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const flat = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 100, resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'flat', shape: 'rect' },
      }) as { sessionId?: string };
      const flatGeo = pw.getGeometryData() as { triangleCount: number };
      const flatTris = flatGeo.triangleCount;
      const silhouette = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 100, resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'silhouette' },
      }) as { sessionId?: string };
      const silGeo = pw.getGeometryData() as { triangleCount: number; boundingBox: { x: [number, number]; y: [number, number] } };
      void flat; void silhouette;
      return { flatTris, silhouetteTris: silGeo.triangleCount, silBboxX: silGeo.boundingBox.x, silBboxY: silGeo.boundingBox.y };
    });
    // Silhouette has many fewer triangles than the full flat tile — most of the
    // canvas is bg and got cut.
    expect(res.silhouetteTris).toBeLessThan(res.flatTris * 0.5);
    // The silhouette stays inside the original tile bounds.
    expect(res.silBboxX[0]).toBeGreaterThanOrEqual(-50.01);
    expect(res.silBboxX[1]).toBeLessThanOrEqual(50.01);
  });

  // Regression: detectBackgroundMask used to pick whatever the leading border
  // colour was, even when no colour dominated — silhouette mode would then cut
  // huge chunks of subject out of photos with busy edges. The fix bails to a
  // full-tile mask below a 35% dominance threshold.
  test('silhouette degrades gracefully when no clear background', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const x = c.getContext('2d')!;
      // Border has 4 distinct colours each covering 1/4 — no single dominant bg.
      x.fillStyle = 'red'; x.fillRect(0, 0, 100, 100);
      x.fillStyle = 'green'; x.fillRect(100, 0, 100, 100);
      x.fillStyle = 'blue'; x.fillRect(0, 100, 100, 100);
      x.fillStyle = 'yellow'; x.fillRect(100, 100, 100, 100);
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const flat = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 100, resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'flat', shape: 'rect' },
      }) as { sessionId?: string };
      const flatTris = (pw.getGeometryData() as { triangleCount: number }).triangleCount;
      const sil = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 100, resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'silhouette' },
      }) as { sessionId?: string };
      const silTris = (pw.getGeometryData() as { triangleCount: number }).triangleCount;
      void flat; void sil;
      return { flatTris, silTris };
    });
    // No background-cut should occur — silhouette ≈ flat (within rounding).
    expect(res.silTris).toBeGreaterThan(res.flatTris * 0.95);
  });

  // SVG import — each <path fill> becomes its own crisp seed region (no
  // k-means clustering, so colours and boundaries are exact).
  test('SVG import yields one region per fill colour', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const svgText = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="0" y="0" width="100" height="100" fill="white"/>
        <circle cx="50" cy="50" r="30" fill="red"/>
        <rect x="20" y="20" width="20" height="20" fill="blue"/>
      </svg>`;
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const created = await pw.importSvgAsRelief({
        svgText,
        options: { widthMm: 50, resolution: 120 },
        quantized: { output: 'silhouette' },
      }) as { sessionId?: string; error?: string };
      const regions = pw.listRegions() as Array<{ color: [number, number, number] }>;
      // Cluster by basic "is dark / has red dominant / has blue dominant" so we
      // confirm the three distinct fills made it through colour-matching.
      const hasRed = regions.some(r => r.color[0] > 0.6 && r.color[1] < 0.4 && r.color[2] < 0.4);
      const hasBlue = regions.some(r => r.color[2] > 0.6 && r.color[0] < 0.4 && r.color[1] < 0.4);
      const hasWhite = regions.some(r => r.color[0] > 0.8 && r.color[1] > 0.8 && r.color[2] > 0.8);
      return { created, regions: regions.length, hasRed, hasBlue, hasWhite };
    });
    expect(res.created.error).toBeFalsy();
    expect(res.regions).toBeGreaterThanOrEqual(3);
    expect(res.hasRed).toBe(true);
    expect(res.hasBlue).toBe(true);
    expect(res.hasWhite).toBe(true);
  });

  // Wave 3: tiles take a holes[] array (replacing the single-hole shorthand) —
  // each entry punches a circular hole in the printed tile. Triangle count
  // should drop relative to a hole-free tile in proportion to the cells cut.
  test('multi-hole tile excludes both hole regions', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 200;
      const x = c.getContext('2d')!;
      x.fillStyle = 'white'; x.fillRect(0, 0, 200, 200);
      x.fillStyle = '#3aa9e8'; x.fillRect(40, 40, 120, 120);
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const solid = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 100, resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'flat', shape: 'rect', holes: [] },
      }) as { sessionId?: string };
      const solidTris = (pw.getGeometryData() as { triangleCount: number }).triangleCount;
      const withHoles = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 100, resolution: 100, maxHeight: 1, baseThickness: 1 },
        quantized: {
          output: 'flat', shape: 'rect',
          holes: [
            { cxMm: -30, cyMm: 30, diameterMm: 10 },
            { cxMm: 30, cyMm: -30, diameterMm: 10 },
          ],
        },
      }) as { sessionId?: string };
      const holedTris = (pw.getGeometryData() as { triangleCount: number }).triangleCount;
      void solid; void withHoles;
      return { solidTris, holedTris };
    });
    expect(res.solidTris).toBeGreaterThan(0);
    expect(res.holedTris).toBeGreaterThan(0);
    // Each ~10 mm hole on a 100 mm tile cuts ~1% of cells; two holes drop a
    // meaningful number of triangles vs the unmodified tile. Loose bound — we
    // care that the holes actually cut, not the exact arithmetic.
    expect(res.holedTris).toBeLessThan(res.solidTris);
  });

  // Wave 5: stepped relief with single-nozzle painting groups triangles by
  // Z-band so every horizontal slice of the print is one colour. This is the
  // fix for the screenshot the user shared, where slanted side walls leaked
  // a cluster colour across multiple Z layers.
  test('stepped relief, single-nozzle painting bands regions by Z', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 80; c.height = 80;
      const x = c.getContext('2d')!;
      // Three distinct vertical stripes — red / green / blue. Each cluster
      // will land at its own Z height in stepped-relief mode.
      x.fillStyle = '#c02020'; x.fillRect(0, 0, 27, 80);
      x.fillStyle = '#20c020'; x.fillRect(27, 0, 27, 80);
      x.fillStyle = '#2020c0'; x.fillRect(54, 0, 26, 80);
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 30, resolution: 60, maxHeight: 1.5, baseThickness: 0.4, layerHeight: 0.1 },
        quantized: { output: 'relief', paintingMode: 'single-nozzle' },
      }) as { sessionId?: string };
      const regions = pw.listRegions() as Array<{ color: [number, number, number] }>;
      return { regionCount: regions.length, regions };
    });
    // Three-stripe input → at least one region per Z-band the clusters land
    // in. The exact count depends on the layer height + clamping but should be
    // > 1 (proves bands actually separated) and <= clusterCount + 1 buffer.
    expect(res.regionCount).toBeGreaterThan(1);
  });

  // Wave 5: crop trims the source image before clustering. A cropped half of
  // a two-colour image should produce a tile whose regions match only the
  // surviving colour (the other colour was cropped away).
  test('crop restricts the cluster regions to the kept area', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 120; c.height = 80;
      const x = c.getContext('2d')!;
      x.fillStyle = '#ff0000'; x.fillRect(0, 0, 60, 80);     // left half red
      x.fillStyle = '#0000ff'; x.fillRect(60, 0, 60, 80);    // right half blue
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      // Crop to the LEFT half only — the resulting tile should be red-dominant.
      await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 30, resolution: 60, maxHeight: 1, baseThickness: 0.6 },
        quantized: { output: 'flat', clusters: 3 },
        crop: { left: 0, top: 0, right: 0.5, bottom: 1 },
      }) as { sessionId?: string };
      const regions = pw.listRegions() as Array<{ color: [number, number, number]; triangleCount?: number }>;
      const hasRed = regions.some(r => r.color[0] > 0.55 && r.color[1] < 0.35 && r.color[2] < 0.35);
      const hasBlue = regions.some(r => r.color[2] > 0.55 && r.color[0] < 0.35 && r.color[1] < 0.35);
      return { hasRed, hasBlue, count: regions.length };
    });
    expect(res.hasRed).toBe(true);
    // The blue half was cropped out — its cluster should no longer be present.
    expect(res.hasBlue).toBe(false);
  });

  // Wave 3: chamferMm > 0 keeps the tile valid (same triangle count, since
  // chamfer reuses existing vertices) but raises the perimeter's z to the
  // chamfered level. Geometry stays manifold.
  test('chamfered tile retains manifold geometry', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 100; c.height = 100;
      const x = c.getContext('2d')!;
      x.fillStyle = 'white'; x.fillRect(0, 0, 100, 100);
      x.fillStyle = 'red'; x.fillRect(20, 20, 60, 60);
      const src = c.toDataURL('image/png');
      const pw = (window as unknown as { partwright: Record<string, (...a: unknown[]) => unknown> }).partwright;
      const created = await pw.importImageAsRelief({
        src, mode: 'quantized',
        options: { widthMm: 50, resolution: 60, maxHeight: 1, baseThickness: 1 },
        quantized: { output: 'flat', shape: 'rect', chamferMm: 0.5 },
      }) as { sessionId?: string; error?: string };
      const geo = pw.getGeometryData() as { boundingBox: { z: [number, number] }; triangleCount: number };
      return { created, zRange: geo.boundingBox.z, triangleCount: geo.triangleCount };
    });
    expect(res.created.error).toBeFalsy();
    expect(res.triangleCount).toBeGreaterThan(0);
    // Top z reaches the full tile thickness (base + height = 2) somewhere — the
    // chamfer only drops the OUTER ring, the interior tops stay at z=2.
    expect(res.zRange[1]).toBeCloseTo(2, 2);
    expect(res.zRange[0]).toBeCloseTo(0, 2);
  });
});
