// Golden path for the Print preview: model code declares colours by layer
// height (api.print.layerColors), the panel shows them as bands, the layer
// slider cuts the model like a slicer's, blending toggles, and an edit made in
// the panel is written back to the code on Apply.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => unknown>;

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, { timeout: 30_000 });
}

const pw = <T = unknown>(page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(([m, a]) => (window as unknown as { partwright: PW }).partwright[m as string](...(a as unknown[])), [method, args] as const) as Promise<T>;

// A 24 mm tall block with a dome: 120 layers at the default 0.2 mm.
const MODEL = `const { Manifold } = api;
const base = Manifold.cube([40, 30, 12], true).translate([0, 0, 6]);
const dome = Manifold.sphere(12, 48).translate([0, 0, 12]);
api.print.layerColors([{ z: 0, color: '#f0f0f0' }, { z: 6, color: '#dc1e1e' }, { z: 14, color: '#1e50dc' }]);
return base.add(dome);`;

interface View { enabled: boolean; showing: boolean; layer: number; totalLayers: number; z: number | null; blend: boolean }
interface Layers { declared: boolean; changes: { z: number; color: string }[]; totalLayers: number; bands: { color: string; firstLayer: number; lastLayer: number }[] }

test.describe('Print preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async (code) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('print-preview');
      await p.runAndSave(code, 'layers');
    }, MODEL);
  });

  test('shows the declared bands, cuts at a layer, blends, and applies an edit to the code', async ({ page }) => {
    // The code's declaration reaches the app.
    const layers = await pw<Layers>(page, 'getLayerColors');
    expect(layers.declared).toBe(true);
    expect(layers.totalLayers).toBe(120);
    expect(layers.bands.map(b => [b.color, b.firstLayer, b.lastLayer])).toEqual([['#f0f0f0', 1, 30], ['#dc1e1e', 31, 70], ['#1e50dc', 71, 120]]);
    expect((await pw<View>(page, 'getPrintPreview')).enabled).toBe(false);

    // Open the panel from the Inspect menu.
    await page.locator('#viewport-inspect-group-btn').click();
    await page.locator('#print-preview-toggle').click();
    const panel = page.locator('#print-preview-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-print-preview-summary]')).toContainText('120 layers');
    await expect(panel.locator('[data-print-preview-row]')).toHaveCount(3);
    await expect.poll(async () => (await pw<View>(page, 'getPrintPreview')).showing).toBe(true);
    await page.screenshot({ path: 'test-results/print-preview-bands.png' });

    // Scrub the layer slider down to layer 45: the preview is cut at its top (9 mm).
    const slider = panel.locator('#print-preview-layer');
    await slider.fill('45');
    await expect(panel.locator('[data-print-preview-readout]')).toHaveText('45 of 120, 9 mm');
    expect(await pw<View>(page, 'getPrintPreview')).toMatchObject({ layer: 45, z: 9, totalLayers: 120 });
    await page.screenshot({ path: 'test-results/print-preview-cut.png' });

    // Back to the whole model, with estimated blending on.
    await slider.fill('120');
    await panel.locator('#print-preview-blend').check();
    await expect.poll(async () => (await pw<View>(page, 'getPrintPreview'))).toMatchObject({ layer: 120, z: null, blend: true });

    // Add a change (previewed from a draft, the code is untouched), then apply it.
    const codeBefore = await pw<string>(page, 'getCode');
    await panel.locator('[data-print-preview-add]').click();
    await expect(panel.locator('[data-print-preview-row]')).toHaveCount(4);
    expect(await pw<string>(page, 'getCode')).toBe(codeBefore);
    await panel.locator('[data-print-preview-apply]').click();
    await expect.poll(async () => (await pw<Layers>(page, 'getLayerColors')).changes.length).toBe(4);
    const code = await pw<string>(page, 'getCode');
    expect(code.match(/api\.print\.layerColors\(/g)).toHaveLength(1);
    expect(code).toContain("{ z: 12, color: '#f5c518' }");
    await page.screenshot({ path: 'test-results/print-preview-applied.png' });

    // Closing the panel puts the model's own look back.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    expect(await pw<View>(page, 'getPrintPreview')).toMatchObject({ enabled: false, showing: false });
  });

  test('the API drives the same preview, validates its arguments, and reports paint conflicts', async ({ page }) => {
    expect(await pw(page, 'setPrintPreview', { enabled: true, layer: 10 })).toMatchObject({ enabled: true, showing: true, layer: 10, z: 2 });
    expect(await pw(page, 'setPrintPreview', { layer: 3, z: 1 })).toMatchObject({ error: expect.stringContaining('layer or z') });
    expect(await pw(page, 'setPrintPreview', { bogus: true })).toMatchObject({ error: expect.any(String) });
    expect(await pw(page, 'setLayerColors', [{ z: 1, color: 'red' }])).toMatchObject({ error: expect.stringContaining('#rrggbb') });

    // The 3MF project export carries the layer colours: the per-layer file is in the package.
    const exported = await pw<{ base64: string; warnings?: string[] }>(page, 'export3MFObjectsData', undefined, 'layers', { bambu: true });
    expect(exported.warnings).toBeUndefined();
    expect(Buffer.from(exported.base64, 'base64').includes(Buffer.from('Metadata/custom_gcode_per_layer.xml'))).toBe(true);

    // setLayerColors rewrites the call in place; clearLayerColors removes it.
    const set = await pw<{ ok?: boolean; replaced?: boolean; layerColors?: Layers }>(page, 'setLayerColors', [{ z: 0, color: '#111111' }, { z: 10, color: '#ffffff' }]);
    expect(set).toMatchObject({ ok: true, replaced: true });
    expect(set.layerColors!.bands.map(b => b.color)).toEqual(['#111111', '#ffffff']);
    expect(await pw(page, 'clearLayerColors')).toMatchObject({ ok: true });
    expect(await pw<string>(page, 'getCode')).not.toContain('layerColors');
    expect(await pw(page, 'getLayerColors')).toMatchObject({ declared: false, changes: [] });
    // With nothing declared the preview has nothing to draw, and says so.
    expect(await pw(page, 'getPrintPreview')).toMatchObject({ enabled: true, showing: false, notes: [expect.stringContaining('declares no layer colours')] });
  });
});
