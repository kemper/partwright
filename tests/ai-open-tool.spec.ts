// "AI opens a tool for the user" (#1085): partwright.openTool(id, prefill,
// {note}) opens a panel with its fields pre-set and hands it over — it never
// applies anything — and getUiState() reports the open tool and its CURRENT
// values (what the user tweaked). Covers the Surface, Paint and Character
// Creator prefills, the "Suggested by AI" note, and rejection of bad keys.

import { test, expect, type Page } from 'playwright/test';
import { openAiPanel } from './helpers/aiPanel';

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

type Result = { ok?: boolean; error?: string; applied?: Record<string, unknown>; ignored?: string[] };
type UiState = {
  activeTool: string | null;
  mode: string | null;
  openModal: string | null;
  toolState: Record<string, unknown> | null;
  tab: string;
  codeView: string;
  camera: unknown;
};
type PW = {
  createSession: (n?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  getCode: () => string;
  openTool: (id: string, prefill?: Record<string, unknown>, opts?: { note?: string }) => Promise<Result>;
  closeTool: (id?: string) => { ok?: boolean; closed?: string | null };
  getUiState: () => UiState;
  getPaintState: () => Record<string, unknown>;
  getUndoState: () => Record<string, { undo: boolean; redo: boolean }>;
  listUiCommands: () => Array<{ id: string; kind: string; enabled: boolean; open: boolean; prefill: Record<string, unknown> | null }>;
  runUiCommand: (id: string) => Promise<Result>;
};

const SHOTS = 'test-results';

async function setup(page: Page, code: string): Promise<void> {
  await page.goto('/editor');
  await waitForEngine(page);
  await page.evaluate(async (src) => {
    const pw = (window as unknown as { partwright: PW }).partwright;
    await pw.createSession('ai-open-tool');
    await pw.run(src);
  }, code);
}

const SPHERE = 'const { Manifold } = api;\nreturn Manifold.sphere(10, 48);';

test.describe('AI opens a tool for the user', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('surface: knit prefilled, note shown, getUiState tracks a slider edit', async ({ page }) => {
    await setup(page, SPHERE);
    const codeBefore = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());

    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'tool-surface',
      { tab: 'knit', mode: 'whole', stitchWidth: 2, amplitude: 0.5, seed: 7 },
      { note: 'Knit at 2 mm stitches — drag Stitch width to taste, then Apply as code.' },
    ));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.applied).toMatchObject({ tab: 'knit', mode: 'whole', seed: 7 });
    expect(r.applied?.stitchWidth as number).toBeCloseTo(2, 2);

    // The panel is open on the Knit tab, with the AI note and the code-path Apply.
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Knit', exact: true })).toHaveClass(/bg-blue-600/);
    await expect(page.getByText('Suggested by AI:')).toBeVisible();
    await expect(page.getByText('Knit at 2 mm stitches')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply as code' })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Stitch width' })).toHaveValue(/^2(\.0+)?$/);

    const s1 = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState());
    expect(s1.activeTool).toBe('tool-surface');
    expect(s1.toolState).toMatchObject({ tab: 'knit', mode: 'whole', applies: 'code', seed: 7 });
    expect(s1.toolState?.stitchWidth as number).toBeCloseTo(2, 2);
    expect(s1.tab).toBe('interactive');

    // The user tweaks a field — getUiState reflects it.
    const box = page.getByRole('spinbutton', { name: 'Stitch width' });
    await box.fill('3.5');
    await box.press('Enter');
    const s2 = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState());
    expect(s2.toolState?.stitchWidth as number).toBeCloseTo(3.5, 2);

    // Wait for the live preview, then capture the hand-off.
    await expect(page.getByText('Previewing — Apply to save a version.')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/ai-open-tool-surface.png` });

    // Opening never applied anything.
    const codeAfter = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(codeAfter).toBe(codeBefore);
    expect(codeAfter).not.toContain('api.surface');

    // Bad keys / values are rejected and open nothing new.
    const bad = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return {
        unknown: await pw.openTool('tool-surface', { tab: 'knit', bogus: 1 }),
        wrongTab: await pw.openTool('tool-surface', { tab: 'fuzzy', stitchWidth: 2 }),
        range: await pw.openTool('tool-surface', { tab: 'knit', roundness: 5 }),
        unknownTool: await pw.openTool('no-such-tool'),
        stillOpen: pw.getUiState().toolState,
      };
    });
    expect(bad.unknown.error).toMatch(/unknown key "bogus"/);
    expect(bad.wrongTab.error).toMatch(/"stitchWidth" is not a fuzzy field/);
    expect(bad.range.error).toMatch(/roundness must be in \[0, 1\]/);
    expect(bad.unknownTool.error).toMatch(/unknown tool/);
    // The user's panel survived the rejected re-opens.
    expect(bad.stillOpen?.stitchWidth as number).toBeCloseTo(3.5, 2);

    const closed = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.closeTool());
    expect(closed).toEqual({ ok: true, closed: 'tool-surface' });
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(0);
  });

  test('paint: brush + colour + spray prefilled; getPaintState / getUndoState', async ({ page }) => {
    await setup(page, 'const { Manifold } = api;\nreturn Manifold.cube([20, 20, 20], true);');

    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'tool-paint',
      { tool: 'brush', color: '#ff3366', brush: { size: 2.5, spray: true, strength: 0.4 } },
      { note: 'Pink airbrush at 2.5 — spray the top edge.' },
    ));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);

    const panel = page.locator('#paint-picker-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Pink airbrush at 2.5')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Brush/ }).first()).toHaveClass(/bg-blue-500\/30/);
    await expect(page.locator('#brush-spray-toggle')).toHaveText(/Spray: On/);
    await expect(page.locator('#brush-spray-strength')).toHaveValue('40');

    const st = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return { ui: pw.getUiState(), paint: pw.getPaintState(), undo: pw.getUndoState() };
    });
    expect(st.ui.activeTool).toBe('tool-paint');
    expect(st.ui.mode).toBe('paint');
    expect(st.paint).toMatchObject({ active: true, tool: 'brush', brush: { size: 2.5, spray: true, strength: 0.4 } });
    const c = st.paint.color as number[];
    expect(c[0]).toBeCloseTo(1, 2); expect(c[1]).toBeCloseTo(0.2, 2); expect(c[2]).toBeCloseTo(0.4, 2);
    expect(st.ui.toolState).toMatchObject({ tool: 'brush' });
    expect(st.undo).toMatchObject({ paint: { undo: false, redo: false }, arrange: { undo: false }, annotations: { undo: false }, voxel: { undo: false } });
    await page.screenshot({ path: `${SHOTS}/ai-open-tool-paint.png` });

    // An unknown palette slot / part is rejected before anything changes.
    const bad = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return {
        slot: await pw.openTool('tool-paint', { slot: 'no-such-slot' }),
        part: await pw.openTool('tool-paint', { withinPart: 'hat' }),
        nested: await pw.openTool('tool-paint', { brush: { radius: 2 } }),
      };
    });
    expect(bad.slot.error).toMatch(/not in the palette/);
    expect(bad.part.error).toMatch(/not a part of this model/);
    expect(bad.nested.error).toMatch(/unknown key "brush\.radius"/);
  });

  test('character creator: spec shown unbuilt; listUiCommands + runUiCommand', async ({ page }) => {
    await setup(page, SPHERE);
    const codeBefore = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());

    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'character-creator',
      { spec: { body: { proportions: 'chibi' }, colors: { hair: '#aa3311', top: '#2266cc' } } },
      { note: 'A chibi with auburn hair — press Preview, then tweak.' },
    ));
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);

    const panel = page.getByRole('dialog', { name: 'Character Creator' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('A chibi with auburn hair')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
    await expect(panel.getByRole('group', { name: 'Proportions' }).getByRole('button', { name: 'Chibi', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const s = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState());
    expect(s.activeTool).toBe('character-creator');
    const spec = (s.toolState as { spec: { body: { proportions: string }; colors: { hair: string } } }).spec;
    expect(spec.body.proportions).toBe('chibi');
    expect(spec.colors.hair).toBe('#aa3311');
    await page.screenshot({ path: `${SHOTS}/ai-open-tool-character.png` });

    // Unbuilt: the editor wasn't touched.
    const codeAfter = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getCode());
    expect(codeAfter).toBe(codeBefore);

    const bad = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'character-creator', { spec: { body: { proportions: 'gigantic' } } }));
    expect(bad.error).toMatch(/proportions/);

    const listing = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.listUiCommands();
    });
    const surface = listing.find(c => c.id === 'tool-surface');
    expect(surface?.kind).toBe('tool');
    expect(surface?.prefill).toHaveProperty('stitchWidth');
    expect(listing.find(c => c.id === 'character-creator')?.open).toBe(true);
    expect(listing.find(c => c.id === 'export-stl')?.kind).toBe('command');

    // runUiCommand opens a tool unprefilled (replacing the open one).
    const ran = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.runUiCommand('tool-resize'));
    expect(ran).toEqual({ ok: true, id: 'tool-resize' });
    await expect(page.getByRole('heading', { name: 'Resize model' })).toBeVisible();
    const after = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState());
    expect(after.activeTool).toBe('tool-resize');
    expect(after.toolState).toMatchObject({ uniform: true, scale: [1, 1, 1] });
  });

  test('surface panel opened by the AI at phone width', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, SPHERE);
    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'tool-surface', { tab: 'fuzzy', mode: 'whole', amplitude: 0.4 }, { note: 'Light fuzzy skin — raise Amplitude for more grip.' }));
    expect(r.ok).toBe(true);
    await expect(page.getByText('Light fuzzy skin')).toBeVisible();
    const box = await page.getByRole('heading', { name: 'Surface modifiers' }).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    await page.screenshot({ path: `${SHOTS}/ai-open-tool-mobile.png` });
  });

  test('AI panel: stays beside the tool on desktop, steps aside on a phone', async ({ page }) => {
    await setup(page, SPHERE);
    await openAiPanel(page);
    const open = () => page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'tool-surface', { tab: 'fuzzy', mode: 'whole' }, { note: 'Fuzzy skin to start.' }));
    expect((await open()).ok).toBe(true);
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();
    await expect(page.locator('#ai-panel')).toBeVisible(); // desktop: side by side

    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.closeTool());
    await page.setViewportSize({ width: 375, height: 812 });
    await openAiPanel(page);
    expect((await open()).ok).toBe(true);
    // Phone: the full-screen chat steps aside so the tool isn't hidden behind it.
    await expect(page.locator('#ai-panel')).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/ai-open-tool-mobile-ai-panel.png` });
  });

  test('rejected prefills stage nothing: engrave, quality', async ({ page }) => {
    await setup(page, SPHERE);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      // One bad key → nothing staged, nothing opened.
      const bad = await pw.openTool('tool-surface', { tab: 'engrave', text: 'HI', font: 'italic', bogusRange: 1 } as Record<string, unknown>);
      const afterBad = pw.getUiState().activeTool;
      // A valid engrave prefill stages text + font together.
      const ok = await pw.openTool('tool-surface', { tab: 'engrave', text: 'HI', font: 'italic', raised: true });
      const state = pw.getUiState().toolState;
      pw.closeTool();
      // Quality: an out-of-range target for the requested mode opens nothing.
      const q = await pw.openTool('tool-quality', { mode: 'simplify', knob: 'count', targetTris: 10_000_000 });
      const afterQ = pw.getUiState().activeTool;
      return { bad, afterBad, ok, state, q, afterQ };
    });
    expect(out.bad.error).toMatch(/unknown key "bogusRange"/);
    expect(out.afterBad).toBeNull();
    expect(out.ok.ok).toBe(true);
    expect(out.state).toMatchObject({ tab: 'engrave', text: 'HI', font: 'italic', raised: true });
    expect(out.q.error).toMatch(/targetTris must be in/);
    expect(out.afterQ).toBeNull();
  });

  test('detect parts: a prefill on the open panel lands in place', async ({ page }) => {
    await setup(page, SPHERE);
    const first = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'detect-parts', { detector: 'crease-watershed' }, { note: 'Try crease watershed.' }));
    expect(first.error).toBeUndefined();
    const panel = page.getByRole('dialog', { name: 'Detect parts' });
    await expect(panel).toBeVisible();
    await panel.evaluate((el) => { (el as HTMLElement).dataset.marker = 'same-panel'; });

    const second = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'detect-parts', { params: { creaseWeight: 3 } }, { note: 'Raise the crease toll.' }));
    expect(second.error).toBeUndefined();
    // Same panel element (not closed + reopened), new note, params against the shown method.
    await expect(panel).toHaveAttribute('data-marker', 'same-panel');
    await expect(panel.getByText('Raise the crease toll.')).toBeVisible();
    await expect(panel.getByText('Try crease watershed.')).toHaveCount(0);
    const s = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState());
    expect(s.toolState).toMatchObject({ detector: 'crease-watershed', params: { creaseWeight: 3 } });
  });

  test('phone: re-opening an ALREADY-open tool still steps the chat aside', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await setup(page, SPHERE);
    // Surface already open, then the user brings the chat up over it.
    expect((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool('tool-surface', { tab: 'fuzzy' }))).ok).toBe(true);
    await openAiPanel(page);
    await expect(page.locator('#ai-panel')).toBeVisible();
    // The AI re-opens the same tool with new values: the chat steps aside.
    const r = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool(
      'tool-surface', { tab: 'knit', mode: 'whole' }, { note: 'Switched to knit.' }));
    expect(r.ok).toBe(true);
    await expect(page.locator('#ai-panel')).toBeHidden();
    await expect(page.getByText('Switched to knit.')).toBeVisible();

    // Same for a persistent panel that's already open (Quality).
    expect((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool('tool-quality'))).ok).toBe(true);
    await openAiPanel(page);
    await expect(page.locator('#ai-panel')).toBeVisible();
    expect((await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool('tool-quality', { mode: 'simplify' }, { note: 'Simplify it.' }))).ok).toBe(true);
    await expect(page.locator('#ai-panel')).toBeHidden();
  });

  test('surface: re-opening while an engrave stamp is rasterizing tears the old panel down', async ({ page }) => {
    await setup(page, SPHERE);
    const out = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      // Fire both opens back to back: the first panel's stamp is still in flight
      // when the second replaces it.
      const first = pw.openTool('tool-surface', { tab: 'engrave', text: 'AB', font: 'bold' });
      const second = pw.openTool('tool-surface', { tab: 'engrave', text: 'CD', font: 'italic', raised: true });
      return { first: await first, second: await second };
    });
    expect(out.first.ok).toBe(true);
    expect(out.second.ok).toBe(true);
    // One panel, and it is the second one; its stamp previews (the dead panel's
    // late rasterization doesn't overwrite it).
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(1);
    await expect(page.getByText('Previewing — Apply to save a version.')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500); // let any late work from the first panel land
    const s = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.getUiState());
    expect(s.toolState).toMatchObject({ tab: 'engrave', text: 'CD', font: 'italic', raised: true });
    await expect(page.getByRole('heading', { name: 'Surface modifiers' })).toHaveCount(1);
    await expect(page.getByText(/Stamp error/)).toHaveCount(0);
    // Closing leaves the real model up (no stale preview mesh).
    const closed = await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.closeTool());
    expect(closed).toEqual({ ok: true, closed: 'tool-surface' });
    await expect(page.getByText('1,152 tris')).toBeVisible();
  });
});
