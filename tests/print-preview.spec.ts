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
return base.add(dome);
`; // ends with a newline, as the editor's auto-format leaves it (see #1263)

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
  test('layer colours follow the open object, and the preview and its panel go together', async ({ page }) => {
    const first = await pw<{ id: string }>(page, 'getCurrentObject');
    // A second object with no layer colours of its own.
    const second = await pw<{ id: string }>(page, 'createObject', 'plain');
    expect(await pw(page, 'runAndSave', 'return api.Manifold.cube([10, 10, 10]);', 'plain cube')).toMatchObject({ geometry: { status: 'ok' } });
    expect(await pw(page, 'getLayerColors')).toMatchObject({ declared: false });

    // Back to the first (restored from the mesh cache, no re-run): its colours are its own again...
    await pw(page, 'changeObject', first.id);
    expect(await pw<Layers>(page, 'getLayerColors')).toMatchObject({ declared: true, totalLayers: 120 });
    // ...and the second still has none, so its 3MF project carries no layer switches.
    await pw(page, 'changeObject', second.id);
    expect(await pw(page, 'getLayerColors')).toMatchObject({ declared: false });
    const plain = await pw<{ base64: string }>(page, 'export3MFObjectsData', [second.id], 'plain', { bambu: true });
    expect(Buffer.from(plain.base64, 'base64').includes(Buffer.from('Metadata/custom_gcode_per_layer.xml'))).toBe(false);
    await pw(page, 'changeObject', first.id);

    // Turning the preview on from the API opens the panel, so the user can see and leave it.
    const panel = page.locator('#print-preview-panel');
    expect(await pw(page, 'setPrintPreview', { enabled: true })).toMatchObject({ enabled: true, showing: true });
    await expect(panel).toBeVisible();

    // An unsaved edit in the panel belongs to this object: switching away drops it.
    await panel.locator('[data-print-preview-add]').click();
    await expect(panel.locator('[data-print-preview-row]')).toHaveCount(4);
    await pw(page, 'changeObject', second.id);
    await expect(panel.locator('[data-print-preview-row]')).toHaveCount(1);
    await expect(panel.locator('[data-print-preview-apply]')).toBeDisabled();
    expect(await pw(page, 'getPrintPreview')).toMatchObject({ enabled: true, showing: false });
    await pw(page, 'changeObject', first.id);
    await expect(panel.locator('[data-print-preview-row]')).toHaveCount(3);
    await expect.poll(async () => (await pw<View>(page, 'getPrintPreview')).showing).toBe(true);

    // Opening another tool closes the panel and with it the preview, so
    // nothing ever picks triangles off the preview's re-split mesh.
    await pw(page, 'openTool', 'tool-paint');
    await expect(panel).toBeHidden();
    expect(await pw(page, 'getPrintPreview')).toMatchObject({ enabled: false, showing: false });

    // Off from the API closes the panel too; an empty list is the same as clearing.
    await pw(page, 'setPrintPreview', { enabled: true });
    await expect(panel).toBeVisible();
    await pw(page, 'setPrintPreview', { enabled: false });
    await expect(panel).toBeHidden();
    expect(await pw(page, 'setLayerColors', [])).toMatchObject({ ok: true });
    expect(await pw<string>(page, 'getCode')).not.toContain('layerColors');
    expect(await pw(page, 'getLayerColors')).toMatchObject({ declared: false });
  });
  test('the 3MF export dialog can show how an object will print, layer by layer', async ({ page }) => {
    // Open the Bambu/Orca export: its object picker has an optional Print preview block.
    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('3MF — Bambu/Orca', { exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByText(/Export .*to 3MF/i).first()).toBeVisible({ timeout: 10_000 });
    const block = modal.locator('[data-export-print-preview]');
    await expect(block).toBeVisible();
    // Off until asked for.
    await expect(block.locator('[data-export-print-preview-stage]')).toHaveCount(0);
    await block.locator('[data-export-print-preview-toggle]').click();
    await expect(block.locator('[data-export-print-preview-stage] canvas')).toBeVisible({ timeout: 20_000 });
    await expect(block.locator('[data-export-print-preview-readout]')).toHaveText('120 of 120, 24 mm');
    await expect(block.locator('[data-export-print-preview-caption]')).toContainText('Colours by layer height');
    await page.screenshot({ path: 'test-results/export-print-preview.png' });

    // Scrub to layer 45 and turn blending on: the frame is redrawn, the export choices are untouched.
    await block.locator('[data-export-print-preview-layer]').fill('45');
    await expect(block.locator('[data-export-print-preview-readout]')).toHaveText('45 of 120, 9 mm');
    // Typing a layer and pressing Enter is about the preview: it must not press Export.
    const box = block.locator('[data-export-print-preview-layer-input]');
    await box.fill('30');
    await box.press('Enter');
    await expect(block.locator('[data-export-print-preview-readout]')).toHaveText('30 of 120, 6 mm');
    await expect(modal).toBeVisible();
    await block.locator('[data-export-print-preview-layer]').fill('45');
    await expect(block.locator('[data-export-print-preview-readout]')).toHaveText('45 of 120, 9 mm');
    await block.locator('[data-export-print-preview-blend]').check();
    await expect(block.locator('[data-export-print-preview-stage] canvas')).toBeVisible();
    await page.screenshot({ path: 'test-results/export-print-preview-cut.png' });
    await expect(modal.getByRole('button', { name: /^Export/ }).last()).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    // Looking never turned the viewport's own preview on.
    expect(await pw(page, 'getPrintPreview')).toMatchObject({ enabled: false });
  });

  test('a layered photo print shows its swap plan in the preview, read-only', async ({ page }) => {
    test.setTimeout(180_000);
    // A synthetic picture drawn in the page (no third-party photo).
    const made = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 96; c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, '#f6e7c8'); grad.addColorStop(0.6, '#f08a3c'); grad.addColorStop(1, '#3a2a5c');
      g.fillStyle = grad; g.fillRect(0, 0, 96, 64);
      g.fillStyle = '#1b1b22'; g.beginPath(); g.arc(48, 34, 18, 0, Math.PI * 2); g.fill();
      const p = (window as unknown as { partwright: PW }).partwright;
      const created = await p.createLayeredPrint({ src: c.toDataURL('image/png'), colors: 4, widthMm: 40, pixelSizeMm: 0.8, maxHeightMm: 2, effort: 0.2, name: 'layered preview' }) as { error?: string; blocks?: unknown[] };
      return { error: created.error ?? null, blocks: created.blocks?.length ?? 0 };
    });
    expect(made.error).toBeNull();
    expect(made.blocks).toBeGreaterThanOrEqual(2);

    // The plan is the preview's source: bands and named swaps, with no api.print.layerColors call.
    const layers = await pw<Layers & { source: string; changes: { z: number; color: string; name?: string }[]; layerHeight: number }>(page, 'getLayerColors');
    expect(layers).toMatchObject({ declared: false, source: 'layeredPrint' });
    expect(layers.changes).toHaveLength(made.blocks);
    expect(layers.changes.every(c => typeof c.name === 'string' && c.name.length > 0)).toBe(true);
    expect(layers.bands.length).toBeGreaterThanOrEqual(2);
    expect(layers.bands[0].firstLayer).toBe(1);

    const on = await pw<View>(page, 'setPrintPreview', { enabled: true });
    expect(on).toMatchObject({ enabled: true, showing: true });
    expect(on.totalLayers).toBe(layers.totalLayers);
    const panel = page.locator('#print-preview-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-print-preview-row]')).toHaveCount(made.blocks);
    await page.screenshot({ path: 'test-results/print-preview-layered.png' });
    // Shown, not edited: the swaps belong to api.layeredPrint in the code.
    await expect(panel.locator('[data-print-preview-add]')).toBeDisabled();
    await expect(panel.locator('[data-print-preview-apply]')).toBeDisabled();
    await expect(panel.locator('[data-print-preview-row] input[type="color"]').first()).toBeDisabled();
    await expect(panel).toContainText('layered photo print');

    // The layer slider and the blending view work on it (blending uses the print's own prediction).
    const half = Math.max(2, Math.floor(layers.totalLayers / 2));
    expect(await pw(page, 'setPrintPreview', { layer: half, blend: true })).toMatchObject({ showing: true, layer: half, blend: true });
    await page.screenshot({ path: 'test-results/print-preview-layered-blend.png' });
    await pw(page, 'setPrintPreview', { enabled: false });
    await expect(panel).toBeHidden();
  });
});
