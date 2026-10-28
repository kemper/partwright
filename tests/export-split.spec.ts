import { test, expect, type Page } from 'playwright/test';
import { waitForEditorReady } from './helpers/aiPanel';

// Splitting one object into several export items: the export picker's
// Split menu (Whole / Pieces / Parts), its per-item rows, the Bambu Custom
// plate layout + plate preview, and the console twins (split / exclude /
// plates, listExportItems). The pure split + plate logic is unit-tested in
// tests/unit/exportSplit.test.ts and tests/unit/bambuPlateLayout.test.ts.

// One object of four separate solids: three labelled, one unlabeled tab.
const MODEL = `const { Manifold } = api;
const board = api.label(Manifold.cube([40, 40, 4]), 'board', { color: '#a0703c' });
const king = api.label(Manifold.cylinder(20, 5, 5, 32).translate([60, 10, 0]), 'King', { color: '#f2f2f2' });
const queen = api.label(Manifold.cylinder(16, 5, 5, 32).translate([80, 10, 0]), 'Queen', { color: '#222222' });
const tab = Manifold.cube([3, 3, 1]).translate([100, 10, 0]);
return board.add(king).add(queen).add(tab);`;

/** Names of the objects in a 3MF (Bambu: one object file per item). */
function bambuObjectFiles(text: string): string[] {
  return [...new Set([...text.matchAll(/3D\/Objects\/object_(\d+)\.model/g)].map(m => m[1]))];
}

async function setUp(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); localStorage.setItem('editor-auto-format', 'false'); } catch { /* ignore */ } });
  await page.goto('/editor');
  await waitForEditorReady(page);
  await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, { timeout: 20_000 });
  await page.evaluate(async (code) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    (await import('/src/geometry/units.ts')).setUnits('mm'); // skip the unitless export confirm
    const r = await pw.runAndSave(code, 'chess bits');
    if (r?.error) throw new Error(r.error);
    const cur = pw.listObjects().find((o: { isCurrent: boolean }) => o.isCurrent);
    await pw.renameObject(cur.id, 'Chess bits');
  }, MODEL);
}

test.describe('export split (pieces / parts)', () => {
  test('a single object of separate pieces splits across plates in the export picker', async ({ page }) => {
    test.setTimeout(90_000);
    await setUp(page);

    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('3MF — Bambu/Orca', { exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Export 3MF?' });
    const modal = page.getByRole('dialog', { name: /Export objects to 3MF/ });
    await expect(modal.or(confirm)).toBeVisible({ timeout: 10_000 });
    if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Export anyway' }).click();
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // The object is measured, then offers both splits.
    const split = modal.locator('select[data-split-for]');
    await expect(split).toBeVisible({ timeout: 15_000 });
    await expect(split.locator('option')).toHaveText(['Whole', 'Pieces (4)', 'Parts (4)']);

    await split.selectOption('pieces');
    const rows = modal.locator('[data-export-item]');
    await expect(rows).toHaveCount(4);
    await expect(modal.locator('[data-export-item="King"]')).toBeVisible();
    // Every piece is its own plate by default.
    await expect(modal.locator('[data-plate-preview] figure')).toHaveCount(4);
    await expect(modal.getByRole('button', { name: 'Export 4 items on 4 plates' })).toBeVisible();

    // Leave the tab out; pack the rest together.
    await modal.locator('[data-export-item="Piece 4"] input[type="checkbox"]').uncheck();
    await modal.getByText('Packed together').click();
    await expect(modal.locator('[data-plate-preview] figure')).toHaveCount(1);
    await expect(modal.getByRole('button', { name: /^Export 3 items$/ })).toBeVisible();

    // Custom: starts from the packed layout, then the board moves to plate 2.
    await modal.getByText('Custom', { exact: true }).click();
    const boardChip = modal.getByRole('combobox', { name: 'Plate for Chess bits · board' }).or(modal.locator('[data-export-item="board"] select'));
    await expect(boardChip.first()).toBeVisible();
    await boardChip.first().selectOption({ label: 'New plate' });
    await expect(modal.locator('[data-plate-preview] figure')).toHaveCount(2);
    await page.screenshot({ path: 'test-results/export-split-picker.png' });
    await modal.locator('[data-plate-preview]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/export-split-plates.png' });

    const download = page.waitForEvent('download', { timeout: 30_000 });
    await modal.getByRole('button', { name: 'Export 3 items on 2 plates' }).click();
    const colors = page.getByRole('dialog', { name: 'Filament colors' });
    await expect(colors).toBeVisible({ timeout: 10_000 });
    await colors.locator('[data-action="export-colors"]').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.3mf$/);
    const text = new TextDecoder('utf-8').decode(new Uint8Array(await (await import('node:fs/promises')).readFile((await file.path())!)));
    expect(bambuObjectFiles(text)).toHaveLength(3);
    expect(text).toContain('Chess bits · King');
    expect(text).not.toContain('Piece 4');
  });

  test('console API: listExportItems, split / exclude / custom plates, and strict errors', async ({ page }) => {
    test.setTimeout(90_000);
    await setUp(page);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const decode = (b64: string) => new TextDecoder('latin1').decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)));
      const listing = await pw.listExportItems();
      const bambu = await pw.export3MFObjectsData(undefined, 'chess', {
        split: { 'Chess bits': 'pieces' }, exclude: ['Chess bits · Piece 4'],
        plateLayout: 'custom', plates: { 'Chess bits · King': 1, 'Chess bits · Queen': 1, 'Chess bits · board': 2 },
      });
      const parts = await pw.export3MFObjectsData(undefined, 'chess', { bambu: false, split: { 'Chess bits': 'parts' } });
      const stl = await pw.exportSTLObjectsData(undefined, 'chess', { split: { 'Chess bits': 'pieces' } });
      const whole = await pw.export3MFObjectsData(undefined, 'chess', { bambu: false });
      return {
        listing,
        bambu: { objects: bambu.objects, items: bambu.items, text: decode(bambu.base64) },
        parts: { objects: parts.objects, items: parts.items },
        stl: { objects: stl.objects, error: stl.error },
        whole: { objects: whole.objects, items: whole.items },
        errors: {
          badMode: (await pw.export3MFObjectsData(undefined, 'x', { split: { 'Chess bits': 'halves' } })).error,
          badExclude: (await pw.export3MFObjectsData(undefined, 'x', { split: { 'Chess bits': 'pieces' }, exclude: ['Nope'] })).error,
          platesNotCustom: (await pw.export3MFObjectsData(undefined, 'x', { plates: { 'Chess bits': 1 } })).error,
          badObject: (await pw.exportOBJObjectsData(undefined, 'x', { split: { Nope: 'pieces' } })).error,
        },
      };
    });

    const obj = out.listing.objects[0];
    expect(obj.pieceCount).toBe(4);
    expect(obj.splits).toEqual(['whole', 'pieces', 'parts']);
    expect(obj.pieces.map((p: { name: string }) => p.name)).toEqual(['Chess bits · board', 'Chess bits · King', 'Chess bits · Queen', 'Chess bits · Piece 4']);
    expect(obj.parts.map((p: { name: string }) => p.name)).toEqual(['Chess bits · board', 'Chess bits · King', 'Chess bits · Queen', 'Chess bits · Unlabeled']);

    expect(out.bambu.objects).toBe(3);
    expect(out.bambu.items).toEqual(['Chess bits · board', 'Chess bits · King', 'Chess bits · Queen']);
    expect(bambuObjectFiles(out.bambu.text)).toHaveLength(3);
    // Two plates: King + Queen share one, the board has its own.
    expect([...out.bambu.text.matchAll(/<metadata key="plater_id" value="(\d+)"/g)].length).toBe(2);

    expect(out.parts.objects).toBe(4);
    expect(out.stl).toEqual({ objects: 4 });
    expect(out.whole).toEqual({ objects: 1 });

    expect(out.errors.badMode).toMatch(/split\["Chess bits"\] must be one of/);
    expect(out.errors.badExclude).toMatch(/exclude names "Nope".*Chess bits · king/i);
    expect(out.errors.platesNotCustom).toMatch(/plates needs/);
    expect(out.errors.badObject).toMatch(/split names "Nope"/);
  });

  test('a one-piece object offers no split and an impossible split is an error', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('partwright-tour-completed', '1'); } catch { /* ignore */ } });
    await page.goto('/editor');
    await waitForEditorReady(page);
    await page.waitForFunction(() => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run, { timeout: 20_000 });
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.runAndSave('return api.Manifold.cube([10,10,10], true);', 'cube');
      const listing = await pw.listExportItems();
      const err = (await pw.export3MFObjectsData(undefined, 'x', { split: { [listing.objects[0].name]: 'pieces' } })).error;
      return { splits: listing.objects[0].splits, err };
    });
    expect(r.splits).toEqual(['whole']);
    expect(r.err).toMatch(/can't split by pieces — it is one solid piece/);
  });
});
