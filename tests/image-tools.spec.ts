import { test, expect } from 'playwright/test';

// Image tools (#1256 Stage A): attach an image once, make objects from it with
// a tool, read the stored record back, re-apply with tweaked settings. Uses a
// synthetic image drawn in the page.

async function syntheticImage(page: import('playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, 160, 120);
    g.fillStyle = '#d2452b'; g.beginPath(); g.arc(60, 60, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f6fd0'; g.fillRect(96, 30, 44, 60);
    g.fillStyle = '#1b1b22'; g.fillRect(20, 96, 120, 10);
    return c.toDataURL('image/png');
  });
}

test.describe('Image tools', () => {
  test('apply a tool, read its record, re-apply with merged settings, other tools', async ({ page }) => {
    test.setTimeout(240_000);
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.applyImageTool);
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
      const bad = await pw.applyImageTool({ tool: 'lithophanes', src });
      const tile = await pw.applyImageTool({ tool: 'tile', src, name: 'badge', params: { common: { widthMm: 50, resolution: 80 }, quantized: { clusters: 4 } } });
      const op1 = pw.getImageToolOp();
      const code1: string = pw.getCode();
      const versions1 = (await pw.listVersions()).length;
      const re = await pw.applyImageTool({ tool: 'tile', replace: true, params: { quantized: { clusters: 6 } } });
      const op2 = pw.getImageToolOp();
      const versions2 = (await pw.listVersions()).length;
      const imageId = op1.image;
      const vox = await pw.applyImageTool({ tool: 'voxel', image: imageId, params: { maxSize: 24 } });
      const voxLang = pw.getActiveLanguage();
      const voxOp = pw.getImageToolOp();
      const lp = await pw.applyImageTool({ tool: 'layeredPrint', image: imageId, params: { colors: 3, widthMm: 40, pixelSizeMm: 0.5, maxHeightMm: 1.6, effort: 0.2 } });
      const lpOp = pw.getImageToolOp();
      const plan = pw.getLayeredPrintPlan();
      return { bad, tile, op1, code1, versions1, re, op2, versions2, images: pw.getImages().length, vox, voxLang, voxOp, lp, lpOp, plan };
    }, src);

    expect(res.bad.error).toMatch(/tool/);
    expect(res.tile.error).toBeUndefined();
    expect(res.code1).toMatch(/^\/\/ @image-tool \{"tool":"tile"/);
    expect(res.op1.tool).toBe('tile');
    expect(res.op1.params.quantized.clusters).toBe(4);
    // Re-apply: a new version of the same object, settings merged.
    expect(res.re.error).toBeUndefined();
    expect(res.versions2).toBe(res.versions1 + 1);
    expect(res.op2.params.quantized.clusters).toBe(6);
    expect(res.op2.params.common.widthMm).toBe(50);
    expect(res.images).toBe(1);
    // Other engines from the same attached image.
    expect(res.vox.error).toBeUndefined();
    expect(res.voxLang).toBe('voxel');
    expect(res.voxOp.tool).toBe('voxel');
    expect(res.lp.error).toBeUndefined();
    expect(res.lpOp.tool).toBe('layeredPrint');
    expect(res.plan.error).toBeUndefined();

    // The panel: images, tools, and "re-apply" for the open object.
    await page.evaluate(() => (window as any).partwright.openImageTools());
    const panel = page.getByRole('dialog', { name: 'Image tools' });
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId('image-tools-current')).toContainText('Layered filament print');
    await expect(panel.getByTestId('image-tools-list').getByRole('button')).toHaveCount(6);
    await page.screenshot({ path: 'test-results/image-tools-panel.png' });

    // Picking a tool selects it and previews it; Open launches its wizard,
    // pre-loaded with the attached image.
    await panel.getByTestId('image-tools-list').getByRole('button', { name: /Keychain \/ colour tile/ }).click();
    await expect(panel.getByTestId('image-tools-list').getByRole('button', { name: /Keychain \/ colour tile/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByTestId('image-tools-preview-caption')).toContainText(/Preview · \d+×\d+ · \d+ colours/, { timeout: 15_000 });
    await panel.getByTestId('image-tools-open').click();
    await expect(page.getByRole('dialog', { name: 'Make a part from an image' })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/image-tools-wizard.png' });
    const before = await page.evaluate(() => (window as any).partwright.listObjects().length);
    await page.getByRole('dialog', { name: 'Make a part from an image' }).getByRole('button', { name: /^Create/ }).click();
    await expect(page.getByRole('dialog', { name: 'Make a part from an image' })).toBeHidden({ timeout: 60_000 });
    await page.waitForFunction((n) => (window as any).partwright.listObjects().length > n, before, { timeout: 60_000 });
    const viaWizard = await page.evaluate(() => (window as any).partwright.getImageToolOp());
    expect(viaWizard.tool).toBe('tile');
  });

  test('the Relief Studio follows the open object, not the session', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.applyImageTool);
    await page.evaluate(async () => {
      const pw = (window as any).partwright;
      for (let i = 0; i < 60; i++) {
        const p = await pw.runAndSave('return api.Manifold.cube([1, 1, 1], true);', 'probe', {});
        if (p && !p.error && p.version) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
    const src = await syntheticImage(page);
    const ids = await page.evaluate(async (src) => {
      const pw = (window as any).partwright;
      const tile = await pw.applyImageTool({ tool: 'tile', src, name: 'badge', params: { common: { resolution: 64 }, quantized: { clusters: 4 } } });
      const image = pw.getImageToolOp().image;
      const vox = await pw.applyImageTool({ tool: 'voxel', image, params: { maxSize: 20 } });
      return { tile: tile.object.id as string, vox: vox.object.id as string, err: tile.error ?? vox.error };
    }, src);
    expect(ids.err).toBeUndefined();
    const studio = page.locator('#relief-studio');
    // The voxel object (made from the same image) is open: no studio.
    await expect(studio).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('#relief-viewport-toggle')).toBeHidden();
    const blocked = await page.evaluate(() => (window as any).partwright.setReliefPreviewMode('ams'));
    expect(blocked.error).toMatch(/not a relief/);
    // Back to the tile object: the studio returns.
    await page.evaluate((id) => (window as any).partwright.changeObject(id), ids.tile);
    await expect(studio).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#relief-viewport-toggle')).toBeVisible();
    await page.screenshot({ path: 'test-results/image-tools-studio-tile.png' });
    // And away again.
    await page.evaluate((id) => (window as any).partwright.changeObject(id), ids.vox);
    await expect(studio).toBeHidden({ timeout: 15_000 });
  });

  test('prep an image (API + panel) and preview each tool', async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
    await page.goto('/editor');
    await page.waitForFunction(() => !!(window as any).partwright?.prepImage);
    const src = await syntheticImage(page);
    const res = await page.evaluate(async (src) => {
      const pw = (window as any).partwright;
      await pw.setImages([{ src, id: 'src1', label: 'poster.png' }]);
      const bad = await pw.prepImage({ image: 'src1', blur: 2 });
      const noop = await pw.prepImage({ image: 'src1' });
      const missing = await pw.prepImage({ image: 'nope', contrast: 0.1 });
      const ok = await pw.prepImage({ image: 'src1', crop: { left: 0.25, top: 0, right: 1, bottom: 1 }, contrast: 0.2, removeBackground: true });
      const imgs = pw.getImages().map((i: { id: string; label?: string }) => ({ id: i.id, label: i.label }));
      return { bad, noop, missing, ok, imgs };
    }, src);
    expect(res.bad.error).toMatch(/unknown option "blur"/);
    expect(res.noop.error).toMatch(/nothing to do/);
    expect(res.missing.error).toMatch(/no image attachment/);
    expect(res.ok.error).toBeUndefined();
    expect(res.ok.width).toBe(120);
    expect(res.ok.height).toBe(120);
    expect(res.ok.backgroundRemoved).toBe(true);
    expect(res.imgs).toContainEqual({ id: 'src1', label: 'poster.png' });
    expect(res.imgs).toContainEqual({ id: res.ok.image, label: 'poster (prepped)' });

    // Panel: select the original, preview tools, prep it, open a tool on the copy.
    await page.evaluate(() => (window as any).partwright.openImageTools());
    const panel = page.getByRole('dialog', { name: 'Image tools' });
    await panel.getByRole('button', { name: 'Use image poster.png' }).click();
    const caption = panel.getByTestId('image-tools-preview-caption');
    await expect(caption).toContainText(/colours/, { timeout: 15_000 });
    await panel.getByTestId('image-tools-list').getByRole('button', { name: /Voxel art/ }).click();
    await expect(caption).toContainText(/voxels/, { timeout: 15_000 });
    await panel.getByTestId('image-tools-list').getByRole('button', { name: /Layered filament print/ }).click();
    await expect(caption).toContainText(/solved in the dialog/, { timeout: 15_000 });
    await panel.getByTestId('image-tools-list').getByRole('button', { name: /Silhouette tile/ }).click();
    await panel.getByTestId('image-tools-prep').locator('summary').click();
    await panel.getByTestId('image-tools-prep-bg').check();
    await expect(caption).toContainText(/colours/, { timeout: 15_000 });
    await page.waitForTimeout(500);
    await panel.screenshot({ path: 'test-results/image-tools-prep-panel.png' });
    const before = await page.evaluate(() => (window as any).partwright.getImages().length);
    await panel.getByTestId('image-tools-open').click();
    // Opening with unsaved prep saves the prepped copy first, then the wizard opens on it.
    await expect(page.getByRole('dialog', { name: 'Make a part from an image' })).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => (window as any).partwright.getImages().length)).toBe(before + 1);
  });
});

