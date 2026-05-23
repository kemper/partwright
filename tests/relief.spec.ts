// Relief Studio (HueForge-style) smoke coverage: generating a relief from an
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

  test('toolbar exposes the relief entry points', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);

    await expect(page.locator('#btn-relief')).toBeVisible();

    await page.locator('#btn-import').click();
    await expect(page.getByText('Image → Relief (HueForge)…')).toBeVisible();
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
    await page.getByText('Image → Relief (HueForge)…').click();
    await expect(page.getByText('Image → Relief (HueForge)', { exact: true })).toBeVisible();

    const input = page.locator('input[type="file"][accept="image/*"]');
    await input.setInputFiles({ name: 'grad.png', mimeType: 'image/png', buffer });

    // The wizard must react to the chosen image: live preview stat + an enabled
    // Create button. (Both were absent when the modal crashed mid-build.)
    await expect(page.locator('canvas.rounded + div')).toContainText('grid', { timeout: 5000 });
    const createBtn = page.getByRole('button', { name: 'Create relief' });
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
});
