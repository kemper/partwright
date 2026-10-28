// The Parts panel: arrange / copy / group the open object's parts as code
// lines (api.movePart & co.), with Undo, arrow-key nudges, and the console
// twin partwright.partAction.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => unknown>;

const FOUR_PARTS = `const { Manifold } = api;
return Manifold.compose([
  api.label(Manifold.cube([10, 10, 10], true), 'a'),
  api.label(Manifold.cube([10, 10, 10], true).translate([20, 0, 0]), 'b'),
  api.label(Manifold.cube([6, 6, 20], true).translate([40, 0, 10]), 'c'),
  api.label(Manifold.cube([10, 10, 10], true).translate([60, 0, 0]), 'd'),
]);`;

const pw = <T = unknown>(page: Page, method: string, ...args: unknown[]) =>
  page.evaluate(([m, a]) => (window as unknown as { partwright: PW }).partwright[m as string](...(a as unknown[])), [method, args] as const) as Promise<T>;

const opLines = async (page: Page) => (await pw<string>(page, 'getCode')).split('\n').filter(l => /^api\.(move|rotate|scale|mirror|copy|group|cutWith)Parts?\(/.test(l.trim()));

test.describe('Parts panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.evaluate(async (code) => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.createSession('parts');
      await p.runAndSave(code, 'four parts');
    }, FOUR_PARTS);
    await expect(page.locator('[data-object-part="part:d"]')).toBeVisible({ timeout: 20_000 });
  });

  test('arranges every part with nothing selected, copies, groups and undoes', async ({ page }) => {
    await page.evaluate(() => (window as unknown as { partwright: PW }).partwright.openTool('tool-parts'));
    const panel = page.locator('#parts-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-parts-target]')).toHaveText('All 4 parts — none selected');

    await panel.locator('[data-part-action="grid"]').click();
    await expect.poll(async () => (await opLines(page)).length).toBeGreaterThan(0);
    expect((await opLines(page)).every(l => l.startsWith('api.movePart('))).toBe(true);
    const geo = await pw<{ isManifold: boolean; componentCount: number }>(page, 'getGeometryData');
    expect(geo).toMatchObject({ isManifold: true, componentCount: 4 });
    await page.mouse.move(1200, 1000);
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/parts-panel-grid.png' });

    // Undo puts the code back.
    await panel.locator('[data-part-action="undo"]').click();
    await expect.poll(async () => (await opLines(page)).length).toBe(0);

    // Select two parts → copies and a group act on them only.
    await page.locator('[data-object-part="part:a"]').click();
    await page.locator('[data-object-part="part:b"]').click({ modifiers: ['Shift'] });
    await expect(panel.locator('[data-parts-target]')).toHaveText('2 parts selected');
    await panel.locator('[data-part-action="duplicate"]').click();
    await expect.poll(async () => (await pw<{ parts: { name: string }[] }>(page, 'listObjectParts')).parts.map(p => p.name).sort().join(','))
      .toBe('a,a 2,b,b 2,c,d');
    await panel.locator('[data-part-action="group"]').click();
    await page.locator('input[type="text"]').last().fill('pair');
    await page.getByRole('button', { name: 'Group', exact: true }).click();
    await expect.poll(async () => (await pw<{ parts: { name: string }[] }>(page, 'listObjectParts')).parts.map(p => p.name).sort().join(','))
      .toBe('a 2,b 2,c,d,pair');
    await expect(panel.locator('[data-part-action="ungroup"]')).toBeEnabled();
    await page.mouse.move(1200, 1000);
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/parts-panel-group.png' });

    // Deleting a copy removes it.
    const del = await pw<{ ok?: boolean; error?: string }>(page, 'deleteObjectPart', 'a 2');
    expect(del.error).toBeUndefined();
    expect((await pw<{ parts: { name: string }[] }>(page, 'listObjectParts')).parts.map(p => p.name)).not.toContain('a 2');
  });

  test('arrow keys nudge the selection; partAction aligns, lays flat and packs the bed', async ({ page }) => {
    await page.locator('[data-object-part="part:c"]').click();
    await page.locator('[data-open-parts-panel="part:c"]').click();
    await expect(page.locator('#parts-panel')).toBeVisible();
    await page.locator('#parts-panel [data-parts-target]').click();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => opLines(page)).toEqual(['api.movePart("c", [1, 0, 0]);']);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => opLines(page)).toEqual(['api.movePart("c", [2, 0, 0]);']);

    // Joined parts can't move on their own: a clear error, code untouched.
    const fused = await page.evaluate(async () => {
      const p = (window as unknown as { partwright: PW }).partwright;
      await p.runAndSave(`const { Manifold } = api;
return api.label(Manifold.cube([10, 10, 10]), 'x').add(api.label(Manifold.cube([10, 10, 10]).translate([5, 0, 0]), 'y'));`, 'fused');
      return p.partAction('move', { parts: ['x'], offset: [1, 0, 0] });
    });
    expect(fused).toMatchObject({ error: expect.stringContaining('joined to other geometry') });
    await page.evaluate(async (code) => (window as unknown as { partwright: PW }).partwright.runAndSave(code, 'back'), FOUR_PARTS);

    const aligned = await pw<{ ok?: boolean; error?: string }>(page, 'partAction', 'align', { parts: ['a', 'c'], axis: 'z', mode: 'max' });
    expect(aligned.error).toBeUndefined();
    const flat = await pw<{ ok?: boolean; error?: string; message?: string }>(page, 'partAction', 'layFlat', { parts: ['c'] });
    expect(flat.error).toBeUndefined();
    const bed = await pw<{ ok?: boolean; error?: string; message?: string }>(page, 'partAction', 'bed');
    expect(bed.error).toBeUndefined();
    expect(bed.message).toContain('onto the bed');
    expect(await pw(page, 'partAction', 'spin')).toMatchObject({ error: expect.stringContaining('partAction(action)') });
    const geo = await pw<{ isManifold: boolean; componentCount: number }>(page, 'getGeometryData');
    expect(geo).toMatchObject({ isManifold: true, componentCount: 4 });
  });
});
