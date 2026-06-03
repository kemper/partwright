// Customizer parameter layer: models declare tweakable knobs via
// `api.params({...})`, which surfaces a viewport Parameters panel and is
// drivable via partwright.getParams()/setParams() and the getParams/setParams
// chat tools. Overrides persist per version. This exercises the whole loop in a
// real browser (the sandbox + worker round-trip can't run in the unit tier).

import { test, expect, type Page } from 'playwright/test';

const PARAM_MODEL = `const { Manifold } = api;
const p = api.params({
  width:  { type: 'number',  default: 20, min: 10, max: 100, step: 1, unit: 'mm', label: 'Width' },
  height: { type: 'number',  default: 20, min: 5,  max: 80 },
  hollow: { type: 'boolean', default: false, label: 'Hollow' },
  style:  { type: 'select',  default: 'a', options: ['a', 'b'] },
});
let m = Manifold.cube([p.width, p.width, p.height], true);
if (p.hollow) m = m.subtract(Manifold.cube([p.width - 4, p.width - 4, p.height + 2], true));
return m;`;

const PLAIN_MODEL = `const { Manifold } = api; return Manifold.cube([10, 10, 10], true);`;

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code?: string) => Promise<Record<string, unknown>>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  saveVersion: (label?: string) => Promise<unknown>;
  loadVersion: (t: { index?: number; id?: string }) => Promise<unknown>;
  getParams: () => { schema: Array<{ key: string; type: string }>; values: Record<string, unknown> };
  setParams: (v: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getGeometryData: () => Record<string, unknown>;
};
function xDim(geo: Record<string, unknown>): number {
  const bb = geo.boundingBox as { dimensions?: number[] } | null;
  return bb?.dimensions?.[0] ?? -1;
}

/** Current geometry's X bounding dimension, read inside the page (so the live
 *  window.partwright methods are callable — they can't cross page.evaluate). */
function currentXDim(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bb = (window as unknown as { partwright: { getGeometryData: () => Record<string, unknown> } })
      .partwright.getGeometryData().boundingBox as { dimensions?: number[] } | null;
    return bb?.dimensions?.[0] ?? -1;
  });
}

test.describe('Customizer parameters', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('captures schema, shows the panel, and setParams / Reset re-run the model', async ({ page }) => {
    // Plain model first: no schema → panel hidden.
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PLAIN_MODEL);
    await expect(page.locator('#params-panel')).toBeHidden();

    // Parametric model: schema captured, panel visible with one row per param.
    const after = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PW }).partwright;
      const geo = await api.run(code);
      return { params: api.getParams(), x: (geo.boundingBox as { dimensions?: number[] }).dimensions?.[0] };
    }, PARAM_MODEL);
    expect(after.params.schema.map(s => s.key)).toEqual(['width', 'height', 'hollow', 'style']);
    expect(after.params.values).toMatchObject({ width: 20, height: 20, hollow: false, style: 'a' });
    expect(after.x).toBeCloseTo(20, 1);

    await expect(page.locator('#params-panel')).toBeVisible();
    // One widget row per declared parameter. Number params pair the slider with
    // an editable number field (the exact-entry feature).
    await expect(page.locator('#params-panel input[type="range"]')).toHaveCount(2); // width + height
    await expect(page.locator('#params-panel input[type="number"]')).toHaveCount(2); // width + height fields
    await expect(page.locator('#params-panel input[type="checkbox"]')).toHaveCount(1); // hollow
    await expect(page.locator('#params-panel select')).toHaveCount(1); // style

    // setParams (console / tool path) changes geometry.
    const wide = await page.evaluate(async () =>
      (window as unknown as { partwright: PW }).partwright.setParams({ width: 80 }), );
    expect((wide.geometry as { boundingBox: { dimensions: number[] } }).boundingBox.dimensions[0]).toBeCloseTo(80, 1);
    expect((wide.params as Record<string, unknown>).width).toBe(80);

    // The panel's Reset button clears overrides and re-runs back to defaults.
    await page.locator('#params-panel button', { hasText: 'Reset' }).click();
    await expect.poll(() => currentXDim(page)).toBeCloseTo(20, 0);

    // Dragging a slider re-runs: set the Width slider to its max and fire change.
    await page.evaluate(() => {
      const panel = document.getElementById('params-panel')!;
      const slider = panel.querySelector('input[type="range"]') as HTMLInputElement; // first = width
      slider.value = slider.max; // 100
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => currentXDim(page)).toBeCloseTo(100, 0);
  });

  test('typing an exact value into a number field re-runs the model', async ({ page }) => {
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PARAM_MODEL);
    await expect(page.locator('#params-panel')).toBeVisible();

    // Type 47 into the Width number field (first number input) and commit with
    // a 'change' event — the model re-runs to the exact typed dimension, which a
    // slider's discrete steps may not land on as directly.
    await page.evaluate(() => {
      const panel = document.getElementById('params-panel')!;
      const field = panel.querySelector('input[type="number"]') as HTMLInputElement; // first = width
      field.value = '47';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect.poll(() => currentXDim(page)).toBeCloseTo(47, 0);

    // The paired slider tracked the typed value too.
    const sliderVal = await page.evaluate(() => {
      const panel = document.getElementById('params-panel')!;
      return (panel.querySelector('input[type="range"]') as HTMLInputElement).value;
    });
    expect(Number(sliderVal)).toBeCloseTo(47, 0);
  });

  test('parameters work in a voxel session (engine-agnostic)', async ({ page }) => {
    const VOXEL_PARAM_MODEL = `
const p = api.params({ size: { type: 'int', default: 4, min: 1, max: 20, label: 'Size' } });
const v = api.voxels();
v.fillBox([0, 0, 0], [p.size - 1, p.size - 1, p.size - 1], '#88aaff');
return v;`;

    const out = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PW & { setActiveLanguage: (l: string) => Promise<void> } }).partwright;
      await api.createSession('voxel-customizer');
      await api.setActiveLanguage('voxel');
      const geo = await api.run(code);
      const wide = await api.setParams({ size: 12 });
      return {
        schema: api.getParams().schema.map(s => s.key),
        defaultX: (geo.boundingBox as { dimensions?: number[] }).dimensions?.[0] ?? -1,
        wideX: (wide.geometry as { boundingBox: { dimensions: number[] } }).boundingBox.dimensions[0],
      };
    }, VOXEL_PARAM_MODEL);

    // Schema captured + panel shown for a voxel model, and setParams re-runs it.
    expect(out.schema).toEqual(['size']);
    expect(out.defaultX).toBeCloseTo(4, 0);
    expect(out.wideX).toBeCloseTo(12, 0);
    await expect(page.locator('#params-panel')).toBeVisible();
    await expect(page.locator('#customize-toggle')).toContainText('Customize (1)');
  });

  test('parameters work in a SCAD session (native customizer annotations)', async ({ page }) => {
    // OpenSCAD customizer annotations (// [min:max], bare true/false) are parsed
    // into the same schema; overrides apply through OpenSCAD's -D flag.
    const SCAD_PARAM_MODEL = [
      'width = 20; // [10:60]',
      'tall = false;',
      'cube([width, width, tall ? 40 : 10], center=true);',
    ].join('\n');

    const out = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PW & { setActiveLanguage: (l: string) => Promise<void> } }).partwright;
      await api.createSession('scad-customizer');
      await api.setActiveLanguage('scad');
      const geo = await api.run(code); // first SCAD run lazy-loads the WASM engine
      const wide = await api.setParams({ width: 50 });
      return {
        schema: api.getParams().schema.map(s => s.key),
        defaultX: (geo.boundingBox as { dimensions?: number[] }).dimensions?.[0] ?? -1,
        wideX: (wide.geometry as { boundingBox: { dimensions: number[] } }).boundingBox.dimensions[0],
      };
    }, SCAD_PARAM_MODEL);

    // Both top-level vars surfaced; width slider override re-runs via -D.
    expect(out.schema).toEqual(['width', 'tall']);
    expect(out.defaultX).toBeCloseTo(20, 0);
    expect(out.wideX).toBeCloseTo(50, 0);
    await expect(page.locator('#params-panel')).toBeVisible();
    await expect(page.locator('#customize-toggle')).toContainText('Customize (2)');
  });

  test('Customize toolbar pill toggles the panel, and close → reopen always works', async ({ page }) => {
    const pill = page.locator('#customize-toggle');
    const panel = page.locator('#params-panel');

    // Plain model: no parameters → neither the pill nor the panel show.
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PLAIN_MODEL);
    await expect(pill).toBeHidden();
    await expect(panel).toBeHidden();

    // Parametric model: pill appears (with the count) and the panel opens.
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PARAM_MODEL);
    await expect(pill).toBeVisible();
    await expect(pill).toContainText('Customize (4)');
    await expect(panel).toBeVisible();

    // The panel's × closes it; the pill stays visible as the way back in.
    await panel.locator('button[aria-label="Close parameters"]').click();
    await expect(panel).toBeHidden();
    await expect(pill).toBeVisible();

    // Re-running the SAME model (e.g. a code edit) must NOT re-pop a panel the
    // user deliberately closed.
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PARAM_MODEL);
    await expect(panel).toBeHidden();

    // Clicking the pill reopens it — the discoverable reopen affordance.
    await pill.click();
    await expect(panel).toBeVisible();

    // Switching to a no-parameter model hides both again.
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PLAIN_MODEL);
    await expect(pill).toBeHidden();
    await expect(panel).toBeHidden();
  });

  test('getParams is always available; setParams is gated by the runCode scope and dispatches', async ({ page }) => {
    const result = await page.evaluate(async (code) => {
      const tools = await import('/src/ai/tools.ts');
      const toggles = {
        vision: { views: true, resolution: 'medium', angles: 'auto' },
        scope: { runCode: true, saveVersions: true, paintFaces: true, sessionNotes: true },
        autoRetry: 0, maxIterations: 'medium', maxSpend: 'high', thinking: 'off',
        provider: 'anthropic', anthropicModel: 'claude-haiku-4-5', localModel: null,
        openaiModel: 'gpt-5-mini', geminiModel: 'gemini-flash-latest',
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const names = (t: any) => tools.buildToolList(t).map((d) => d.name);
      const withRun = names(toggles);
      const withoutRun = names({ ...toggles, scope: { ...toggles.scope, runCode: false } });

      const api = (window as unknown as { partwright: PW }).partwright;
      await api.createSession('customizer-tools');
      await api.run(code);
      const getExec = await tools.executeTool('getParams', {});
      const setExec = await tools.executeTool('setParams', { values: { width: 60 } });
      return {
        getAlways: withRun.includes('getParams') && withoutRun.includes('getParams'),
        setGated: withRun.includes('setParams') && !withoutRun.includes('setParams'),
        getExec, setExec,
      };
    }, PARAM_MODEL);

    expect(result.getAlways).toBe(true);
    expect(result.setGated).toBe(true);
    expect(result.getExec.isError).toBe(false);
    expect(JSON.parse(result.getExec.content).schema.map((s: { key: string }) => s.key)).toContain('width');
    expect(result.setExec.isError).toBe(false);
    expect(JSON.parse(result.setExec.content).geometry.boundingBox.dimensions[0]).toBeCloseTo(60, 1);
  });

  test('parameter overrides persist per version across navigation', async ({ page }) => {
    const out = await page.evaluate(async (code) => {
      const api = (window as unknown as { partwright: PW }).partwright;
      await api.createSession('customizer-persist');
      // v1 at defaults.
      await api.runAndSave(code, 'default');
      // Tweak then snapshot as v2 (saveVersion carries the current overrides).
      await api.setParams({ width: 80, hollow: true });
      await api.saveVersion('wide-hollow');
      // Move current state somewhere else, then rewind to v2 and v1.
      await api.setParams({ width: 30 });
      await api.loadVersion({ index: 2 });
      const v2 = { params: api.getParams().values, geo: api.getGeometryData() };
      await api.loadVersion({ index: 1 });
      const v1 = { params: api.getParams().values, geo: api.getGeometryData() };
      return { v2, v1 };
    }, PARAM_MODEL);

    // v2 restored its saved overrides and matching geometry.
    expect(out.v2.params).toMatchObject({ width: 80, hollow: true });
    expect(xDim(out.v2.geo)).toBeCloseTo(80, 0);
    // v1 came back at the model defaults.
    expect(out.v1.params).toMatchObject({ width: 20, hollow: false });
    expect(xDim(out.v1.geo)).toBeCloseTo(20, 0);
  });

  test('the panel header is a drag handle that repositions it (and keeps it on-screen)', async ({ page }) => {
    await page.evaluate((code) => (window as unknown as { partwright: PW }).partwright.run(code), PARAM_MODEL);
    const panel = page.locator('#params-panel');
    await expect(panel).toBeVisible();

    const before = await panel.boundingBox();
    if (!before) throw new Error('no panel box');

    // Grab the header (the "Customize" title area) and drag it down-and-left —
    // the panel starts top-right, so there's room that way without clamping.
    // Pointer/mouse events route to the header's drag handler.
    const title = panel.locator('text=Customize').first();
    const titleBox = await title.boundingBox();
    if (!titleBox) throw new Error('no title box');
    const grabX = titleBox.x + titleBox.width / 2;
    const grabY = titleBox.y + titleBox.height / 2;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX - 80, grabY + 80, { steps: 8 });
    await page.mouse.up();

    const after = await panel.boundingBox();
    if (!after) throw new Error('no panel box after drag');
    // It followed the pointer (moved down and left) and stayed fully on screen.
    expect(after.y).toBeGreaterThan(before.y + 20);
    expect(after.x).toBeLessThan(before.x - 10);
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.x).toBeGreaterThanOrEqual(0);
  });
});
