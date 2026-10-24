// 3MF "Filament colors" step: every distinct painted colour becomes its own
// slicer filament, so the 3MF exports list the palette, pre-merge near-identical
// shades, and let the user re-assign them before writing. Export-only — the
// session's paint is untouched. The merge maths is unit-tested in
// tests/unit/exportColors.test.ts; this covers the UI + API wiring.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

// Two near-identical blacks (ΔE ≈ 6) + a red: 3 colours → 2 filaments at the
// default merge tolerance (10).
const MODEL = `const { Manifold } = api;
const a = api.label(Manifold.cube([20, 20, 20], true), 'body', { color: '#1b1b1b' });
const b = api.label(Manifold.cube([8, 8, 8], true).translate([0, 0, 13]), 'eyes', { color: '#0d0d0d' });
const c = api.label(Manifold.cylinder(6, 4, 4, 32).translate([0, 0, 16]), 'knob', { color: '#ff0000' });
return a.add(b).add(c);`;

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
  await page.evaluate(async (code) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    (await import('/src/geometry/units.ts')).setUnits('mm'); // skip the unitless export confirm
    pw.clearColors?.();
    const r = await pw.runAndSave(code, 'filament colours'); // saved → no unsaved-object confirm
    if (r?.error) throw new Error(r.error);
  }, MODEL);
});
test.afterAll(async () => {
  await page?.context().close();
});

/** Count the m:color entries in a generic 3MF (the zip is stored, so the XML is plain text). */
async function exportedColors(page: Page, opts?: Record<string, unknown>): Promise<string[]> {
  return page.evaluate(async (o) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (window as any).partwright.export3MFData(undefined, o);
    if (r.error) throw new Error(r.error);
    const text = new TextDecoder('latin1').decode(Uint8Array.from(atob(r.base64), ch => ch.charCodeAt(0)));
    return [...text.matchAll(/<m:color color="#([0-9A-F]{6})FF"/g)].map(m => m[1]);
  }, opts);
}

test.describe('3MF filament colors', () => {
  test('export dialog merges near-identical shades before writing', async () => {
    await page.locator('#btn-export').click();
    await page.locator('#export-dropdown').getByText('3MF', { exact: true }).click();

    // The shared page may still flag the object unsaved — export anyway.
    const modal = page.getByRole('dialog', { name: 'Filament colors' });
    const confirm = page.getByRole('dialog', { name: 'Export 3MF?' });
    await expect(modal.or(confirm)).toBeVisible({ timeout: 10_000 });
    if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Export anyway' }).click();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    await expect(modal.getByTestId('export-colors-summary')).toHaveText(/3 colours → 2 filaments/);
    await expect(modal.locator('[data-filament]')).toHaveCount(2);
    await expect(modal.getByText('body', { exact: true })).toBeVisible();

    // "Keep all colours" restores one filament per colour.
    await modal.locator('[data-action="keep-all"]').click();
    await expect(modal.getByTestId('export-colors-summary')).toHaveText(/3 colours → 3 filaments/);

    // Fine-tune: merge the red into the first filament by hand.
    await modal.getByText('Fine-tune merges').click();
    const red = modal.locator('select[data-source="#ff0000"]');
    await red.selectOption({ index: 1 }); // "Merge into <first other filament>"
    await expect(modal.getByTestId('export-colors-summary')).toHaveText(/3 colours → 2 filaments/);

    const download = page.waitForEvent('download', { timeout: 30_000 });
    await modal.locator('[data-action="export-colors"]').click();
    expect((await download).suggestedFilename()).toMatch(/\.3mf$/);
    await expect(modal).toBeHidden();
  });

  test('console API lists colours and applies merges, recolours and caps', async () => {
    const listing = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).partwright.listExportColors({ mergeColors: 10 });
    });
    expect(listing.colors.map((c: { hex: string }) => c.hex).sort()).toEqual(['#0d0d0d', '#1b1b1b', '#ff0000']);
    expect(listing.filaments).toBe(2);
    // The less-used black folds into the more-used one; red stays its own filament.
    const merges = Object.entries(listing.merges);
    expect(merges).toHaveLength(1);
    expect(merges[0].sort()).toEqual(['#0d0d0d', '#1b1b1b']);

    expect((await exportedColors(page)).sort()).toEqual(['0D0D0D', '1B1B1B', 'FF0000']);
    const merged = await exportedColors(page, { mergeColors: 10 });
    expect(merged).toHaveLength(2);
    expect(merged).toContain('FF0000');
    expect((await exportedColors(page, { maxColors: 1 }))).toHaveLength(1);
    expect((await exportedColors(page, { colorMap: { '#FF0000': '#00ff00' } })).sort()).toEqual(['00FF00', '0D0D0D', '1B1B1B']);

    // Bambu/Orca project: one AMS filament per remaining colour.
    const bambuFilaments = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (window as any).partwright.export3MFObjectsData(undefined, undefined, { bambu: true, mergeColors: 10 });
      if (r.error) throw new Error(r.error);
      const text = new TextDecoder('latin1').decode(Uint8Array.from(atob(r.base64), ch => ch.charCodeAt(0)));
      return /"filament_colour":\s*\[([^\]]*)\]/.exec(text)?.[1].split(',').length ?? -1;
    });
    expect(bambuFilaments).toBe(2);

    const bad = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).partwright.export3MFData(undefined, { colorMap: { red: '#000000' } });
    });
    expect(bad.error).toMatch(/colorMap/);
  });
});
