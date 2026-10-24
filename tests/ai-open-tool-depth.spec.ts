// Prefill depth for the remaining tool panels (#1085 PR6): every newly
// prefillable tool opens STAGED (nothing applied / saved / exported /
// imported), getUiState().toolState reflects the prefill keys, and an invalid
// prefill opens nothing. Plus the "[UI] user applied …" next-turn note.

import { test, expect, type Page } from 'playwright/test';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type Result = { ok?: boolean; error?: string; applied?: Record<string, unknown>; ignored?: string[]; pending?: boolean; message?: string };
type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  setActiveLanguage: (l: string) => Promise<unknown>;
  getCode: () => string;
  openTool: (id: string, prefill?: Record<string, unknown>, opts?: { note?: string; source?: 'ai' | 'api' }) => Promise<Result>;
  closeTool: (id?: string) => unknown;
  getUiState: () => { activeTool: string | null; openModal: string | null; toolState: Record<string, unknown> | null };
  getPaintState: () => Record<string, unknown>;
  getPrinterSettings: () => { bed: number[]; nozzleWidth: number; overhangAngleDeg: number };
  getRegions?: () => unknown[];
};

const SHOTS = process.env.PR6_SHOTS ?? 'test-results';
const CUBE = 'const { Manifold } = api;\nreturn Manifold.cube([20, 20, 20], true);';

async function setup(page: Page, code = CUBE, save = false): Promise<void> {
  await page.goto('/editor');
  await waitForEngine(page);
  await page.evaluate(async ({ src, save }) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession('ai-open-tool-depth');
    if (save) await pw.runAndSave(src, 'v1');
    else await pw.run(src);
  }, { src: code, save });
}

/** A small PNG data URL (red disc on white) made in the page. */
function makeDataUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 48, 48);
    g.fillStyle = '#dd2244'; g.beginPath(); g.arc(24, 24, 16, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png');
  });
}

const pw = (page: Page) => ({
  open: (id: string, prefill?: Record<string, unknown>, note?: string) => page.evaluate(
    ({ id, prefill, note }) => (window as unknown as { partwright: PW }).partwright.openTool(id, prefill, note ? { note } : undefined),
    { id, prefill, note }),
  ui: () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState()),
  close: () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.closeTool()),
});

test.describe('AI opens a tool — prefill depth', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('image paint: src + stamp settings staged, nothing stamped; bad src opens nothing', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    const bad = await api.open('tool-image-paint', { src: 'no-such-attachment' });
    expect(bad.error).toMatch(/src must be a data:image\/ URL/);
    // Plain http (e.g. localhost / LAN) is refused before any request.
    expect((await api.open('tool-image-paint', { src: 'http://localhost:9/x.png' })).error).toMatch(/https:\/\/ URL.*http: URL/);
    expect((await api.ui()).activeTool).toBeNull();

    const src = await makeDataUrl(page);
    const r = await api.open('tool-image-paint', { src, size: 12, rotationDeg: 45, smooth: false, bgColor: '#ffffff' },
      'Your logo at 12 units — hover the front face and click to stamp.');
    expect(r.error).toBeUndefined();
    expect(r.applied?.src).toBe('image (data URL)'); // never echoes the data URL
    const panel = page.locator('#image-paint-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Your logo at 12 units')).toBeVisible();
    await expect(panel.locator('[data-stamp-hint]')).toHaveText('Click on model to stamp');
    const s = await api.ui();
    expect(s.activeTool).toBe('tool-image-paint');
    expect(s.toolState).toMatchObject({ src: 'image (data URL)', size: 12, rotationDeg: 45, smooth: false, removeBackground: true, bgColor: [1, 1, 1] });
    const regions = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPaintState().regions);
    expect(regions).toBe(0);
    await page.screenshot({ path: `${SHOTS}/pr6-image-paint.png` });
  });

  test('palette: suggestions staged until the user clicks Apply; unknown palette rejected', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    expect((await api.open('tool-palette', { palette: 'No Such Palette' })).error).toMatch(/not found/);
    expect((await api.ui()).activeTool).toBeNull();

    const before = await api.open('tool-palette');
    expect(before.ok).toBe(true);
    const s0 = (await api.ui()).toolState as { palette: string; capacity: number; constrained: boolean };
    const cap = s0.capacity === 4 ? 6 : 4;
    const r = await api.open('tool-palette', { palette: s0.palette, capacity: cap, constrained: !s0.constrained }, 'Match your AMS.');
    expect(r.ok).toBe(true);
    const row = page.locator('[data-palette-suggestion]');
    await expect(row).toBeVisible();
    await expect(page.getByText('Match your AMS.')).toBeVisible();
    // Not saved yet.
    expect((await api.ui()).toolState).toMatchObject({ capacity: s0.capacity, constrained: s0.constrained });
    await row.getByRole('button', { name: 'Apply' }).click();
    expect((await api.ui()).toolState).toMatchObject({ capacity: cap, constrained: !s0.constrained });
    await expect(row).toHaveCount(0);
  });

  test('customize: values staged on the sliders; unknown key / wrong type rejected', async ({ page }) => {
    await setup(page, 'const p = api.params({ width: { type: "number", default: 20, min: 5, max: 60 }, round: { type: "boolean", default: false } });\nreturn api.Manifold.cube([p.width, 10, 10], true);');
    const api = pw(page);
    expect((await api.open('tool-customize', { values: { widht: 30 } })).error).toMatch(/unknown parameter "widht"/);
    expect((await api.open('tool-customize', { values: { width: 'big' } })).error).toMatch(/width must be a finite number/);
    await api.close();
    const r = await api.open('tool-customize', { values: { width: 42, round: true } }, 'Try 42 wide.');
    expect(r.error).toBeUndefined();
    await expect(page.locator('#params-panel')).toBeVisible();
    await expect(page.locator('#params-panel').getByText('Try 42 wide.')).toBeVisible();
    expect((await api.ui()).toolState).toEqual({ values: { width: 42, round: true } });
  });

  test('voxel studio: tool / colour / brush / level axis staged; bad block rejected', async ({ page }) => {
    await page.goto('/editor');
    await waitForEngine(page);
    await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('ai-open-tool-voxel');
      await p.setActiveLanguage('voxel');
      await p.run('const v = api.voxels();\nv.fillBox([0, 0, 0], [7, 7, 7], 0x4488ff);\nreturn v;');
    });
    const api = pw(page);
    expect((await api.open('tool-voxel-paint', { brush: { block: [0, 1, 1] } })).error).toMatch(/brush\.block/);
    expect((await api.ui()).activeTool).toBeNull();
    const r = await api.open('tool-voxel-paint', { tool: 'level', color: '#ff0000', brush: { radius: 2, shape: 'cube' }, levelAxis: 'y' });
    expect(r.error).toBeUndefined();
    await expect(page.locator('#voxel-paint-panel')).toBeVisible();
    expect((await api.ui()).toolState).toMatchObject({ tool: 'level', color: '#ff0000', brush: { radius: 2, shape: 'cube' }, levelAxis: 'y' });
  });

  test('print tools: settings staged (not saved) until "Use these"; check never auto-runs', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    const saved = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPrinterSettings());
    expect((await api.open('tool-print', { bed: [5, 200, 200] })).error).toMatch(/bed values/);
    expect((await api.ui()).activeTool).toBeNull();
    const r = await api.open('tool-print', { bed: [220, 220, 250], nozzleWidth: 0.6, overhangAngleDeg: 50 }, 'Ender 3 with a 0.6 nozzle.');
    expect(r.error).toBeUndefined();
    const panel = page.locator('#print-tools-panel');
    await expect(panel.locator('[data-print-staged]')).toBeVisible();
    await expect(panel.locator('#print-report')).toBeEmpty();
    expect((await api.ui()).toolState).toEqual({ bed: [220, 220, 250], nozzleWidth: 0.6, overhangAngleDeg: 50 });
    const still = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPrinterSettings());
    expect(still).toMatchObject({ bed: saved.bed, nozzleWidth: saved.nozzleWidth, overhangAngleDeg: saved.overhangAngleDeg });
    await page.screenshot({ path: `${SHOTS}/pr6-print-staged.png` });
    // Check printability checks the staged values WITHOUT saving them.
    await panel.getByRole('button', { name: 'Check printability' }).click();
    await expect(panel.locator('#print-report')).not.toBeEmpty();
    await expect(panel.locator('[data-print-staged]')).toBeVisible();
    const afterCheck = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPrinterSettings());
    expect(afterCheck).toMatchObject({ bed: saved.bed, nozzleWidth: saved.nozzleWidth, overhangAngleDeg: saved.overhangAngleDeg });
    await panel.getByRole('button', { name: 'Use these' }).click();
    const after = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPrinterSettings());
    expect(after).toMatchObject({ bed: [220, 220, 250], nozzleWidth: 0.6, overhangAngleDeg: 50 });
  });

  test('cross section: z staged in range; out-of-range z opens nothing', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    expect((await api.open('tool-cross-section', { z: 999 })).error).toMatch(/z must be in/);
    expect((await api.ui()).activeTool).toBeNull();
    const r = await api.open('tool-cross-section', { z: 2.5 });
    expect(r.ok).toBe(true);
    expect((await api.ui()).toolState).toEqual({ z: 2.5 });
  });

  test('settings: focus scrolls to + highlights a field; unknown key rejected', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    expect((await api.open('open-quality', { focus: 'renderer.nope' })).error).toMatch(/not a setting/);
    expect((await api.ui()).openModal).toBeNull();
    const r = await api.open('open-quality', { focus: 'renderer.fov' }, 'Widen the field of view here.');
    expect(r.ok).toBe(true);
    expect(r.ignored).toEqual([]);
    await expect(page.locator('[data-setting="renderer.fov"][data-setting-focus]')).toBeVisible();
    await expect(page.getByText('Widen the field of view here.')).toBeVisible();
    const s = await api.ui();
    expect(s.openModal).toBe('Settings');
    expect(s.toolState).toEqual({ focus: 'renderer.fov' });
    await page.screenshot({ path: `${SHOTS}/pr6-settings-focus.png` });
  });

  test('export dialogs: session options + object picker + publish open staged, never download', async ({ page }) => {
    await setup(page, CUBE, true);
    const api = pw(page);
    let downloads = 0;
    page.on('download', () => { downloads++; });

    expect((await api.open('export-session', { versions: [99] })).error).toMatch(/no version 99/);
    expect((await api.ui()).openModal).toBeNull();
    const es = await api.open('export-session', { includeChat: false, includeThumbnails: true }, 'Thumbnail on, chat off.');
    expect(es.error).toBeUndefined();
    const dlg = page.getByRole('dialog', { name: 'Export session' });
    await expect(dlg).toBeVisible();
    expect((await api.ui()).toolState).toMatchObject({ includeChat: false, includeThumbnails: true, includeNotes: true });
    // A stray Enter / Space (the user still typing in the chat) must not
    // export from a dialog the AI opened — Export isn't focused and Enter is
    // disarmed until the user interacts with the dialog.
    await expect(dlg.getByRole('button', { name: 'Export' })).not.toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();

    expect((await api.open('export-objects', { objects: ['nope'] })).error).toMatch(/"nope" is not an object/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await api.open('export-objects', { nozzle: '0.5' })).error).toMatch(/nozzle must be one of/);
    const eo = await api.open('export-objects', { format: '3mf-bambu', nozzle: '0.6', plateLayout: 'grid' }, 'Packed, 0.6 nozzle.');
    expect(eo.error).toBeUndefined();
    // A pre-export "unsaved objects" confirm can come first — openTool then
    // says so (pending) and a second staged open is refused; the confirm is
    // guarded too (stray Enter doesn't export). The user answers it; the
    // picker then opens with the staged values.
    const confirm = page.getByRole('dialog', { name: 'Export 3MF?' });
    if (await confirm.isVisible()) {
      expect(eo.pending).toBe(true);
      expect(eo.message).toMatch(/waiting for the user/);
      expect((await api.open('export-session')).error).toMatch(/still waiting for the user/);
      await page.keyboard.press('Enter');
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Export anyway' }).click();
    }
    const picker = page.getByRole('dialog', { name: /Export objects to 3MF/ });
    await expect(picker).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(picker).toBeVisible();    await expect(page.getByRole('dialog', { name: /Export objects to 3MF/ })).toBeVisible();
    expect((await api.ui()).toolState).toMatchObject({ format: '3mf-bambu', nozzle: '0.6', plateLayout: 'grid' });
    expect((await api.open('export-objects', { plateLayout: 'group' })).error).toMatch(/already open|grouped objects/);
    expect((await api.open('export-objects', { format: 'stl' })).error).toMatch(/already open|2\+ objects/);
    await page.getByRole('dialog', { name: /Export objects to 3MF/ }).getByRole('button', { name: 'Cancel' }).click();

    expect((await api.open('publish-model', { platform: 'thingiverse', format: '3mf-bambu' })).error).toMatch(/format must be one of/);
    const pub = await api.open('publish-model', { platform: 'printables', title: 'Desk cube', tags: ['cube', 'desk'] });
    expect(pub.error).toBeUndefined();
    const pdlg = page.getByRole('dialog', { name: 'Publish to a print site' });
    await expect(pdlg).toBeVisible();
    await expect(pdlg.getByPlaceholder('Model title')).toHaveValue('Desk cube');
    expect((await api.ui()).toolState).toMatchObject({ platform: 'printables', title: 'Desk cube', tags: ['cube', 'desk'] });
    await pdlg.getByRole('button', { name: 'Cancel' }).click();
    expect(downloads).toBe(0);
  });

  test('import wizards: relief + image→voxel open staged with the image; bad options rejected', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    const src = await makeDataUrl(page);
    expect((await api.open('import-relief', { src, crop: { left: 0.5, top: 0, right: 0.2, bottom: 1 } })).error).toMatch(/left < right/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const r = await api.open('import-relief', { src, mode: 'luminance', options: { widthMm: 60 }, luminance: { levels: 8 } }, 'A small lithophane.');
    expect(r.error).toBeUndefined();
    const wiz = page.getByRole('dialog', { name: 'Make a part from an image' });
    await expect(wiz).toBeVisible();
    await expect(wiz.getByText('A small lithophane.')).toBeVisible();
    const s = (await api.ui()).toolState as { mode: string; options: { widthMm: number }; luminance: { levels: number }; src: string };
    expect(s.mode).toBe('luminance');
    expect(s.options.widthMm).toBe(60);
    expect(s.luminance.levels).toBe(8);
    expect(s.src).toMatch(/\.png$/);
    await page.screenshot({ path: `${SHOTS}/pr6-relief.png` });
    await api.close();
    await expect(wiz).toHaveCount(0);

    expect((await api.open('import-image-voxel', { options: { mode: 'sideways' } })).error).toMatch(/options\.mode/);
    const v = await api.open('import-image-voxel', { src, options: { maxSize: 32, colorMode: 'flat', flatColor: '#ff0000' } });
    expect(v.error).toBeUndefined();
    await expect(page.getByRole('dialog', { name: 'Image → Voxel' })).toBeVisible();
    expect((await api.ui()).toolState).toMatchObject({ options: { maxSize: 32, colorMode: 'flat', flatColor: [255, 0, 0] } });
  });

  test('paint box + surface engrave placement prefills', async ({ page }) => {
    await setup(page);
    const api = pw(page);
    expect((await api.open('tool-paint', { tool: 'brush', box: { center: [0, 0, 0] } })).error).toMatch(/need tool "box"/);
    const r = await api.open('tool-paint', { box: { shape: 'sphere', center: [0, 0, 5], size: [6, 6, 6], rotation: [0, 0, 30] } });
    expect(r.error).toBeUndefined();
    const box = (await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getPaintState())).box as { shape: string; center: number[]; size: number[]; rotation: number[] };
    expect(box.shape).toBe('sphere');
    expect(box.center).toEqual([0, 0, 5]);
    expect(box.size).toEqual([6, 6, 6]);
    expect(box.rotation[2]).toBeCloseTo(30, 1);
    await api.close();

    expect((await api.open('tool-surface', { tab: 'engrave', posU: 2 })).error).toMatch(/posU must be/);
    const e = await api.open('tool-surface', { tab: 'engrave', text: 'HI', face: '-y', posU: 0.25, rotationDeg: 30, curve: 'v', curveAngle: 120 });
    expect(e.error).toBeUndefined();
    expect((await api.ui()).toolState).toMatchObject({ tab: 'engrave', face: '-y', posU: 0.25, rotationDeg: 30, curve: 'v', curveAngle: 120 });
  });

  test('[UI] note: applying from an AI-opened panel queues a next-turn note', async ({ page }) => {
    await setup(page);
    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'tool-surface', { tab: 'smooth', mode: 'whole', iterations: 3 }, { source: 'ai' }));
    expect(r.ok).toBe(true);
    await page.getByRole('button', { name: /^Apply/ }).last().click();
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0, { timeout: 30_000 });
    const notes = await page.evaluate(async () => (await import('/src/ui/toolRegistry.ts')).drainToolAppliedNotes());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/^\[UI · app note\] user applied Surface textures: smooth \{.*iterations: 3/);
  });

  test('image paint at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page);
    const src = await makeDataUrl(page);
    const r = await pw(page).open('tool-image-paint', { src, size: 10 }, 'Tap the model to stamp the logo.');
    expect(r.ok).toBe(true);
    const box = await page.locator('#image-paint-panel').boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    await page.screenshot({ path: `${SHOTS}/pr6-image-paint-mobile.png` });
  });
});
