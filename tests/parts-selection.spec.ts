// Part selection like a file list and a 3D editor: in the object list,
// Shift-click selects a range and ⌘/Ctrl-click adds or removes one part; in the
// viewport, Shift-click toggles the part under the cursor and Shift-drag
// box-selects; ⌘/Ctrl-A selects every part, Esc clears, H hides (Shift-H
// shows them again), Delete deletes.

import { test, expect, type Page } from 'playwright/test';

type PW = Record<string, (...args: unknown[]) => unknown>;

const FOUR_PARTS = `const { Manifold } = api;
return Manifold.compose([
  api.label(Manifold.cube([10, 10, 10], true), 'a'),
  api.label(Manifold.cube([10, 10, 10], true).translate([20, 0, 0]), 'b'),
  api.label(Manifold.cube([10, 10, 10], true).translate([40, 0, 0]), 'c'),
  api.label(Manifold.cube([10, 10, 10], true).translate([60, 0, 0]), 'd'),
]);`;

async function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listObjectParts() as { selection: string[] }).selection);
}

test.describe('Part selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await page.waitForSelector('text=Ready', { timeout: 30_000 });
    await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('parts');
      await pw.runAndSave(code, 'four parts');
    }, FOUR_PARTS);
    await expect(page.locator('[data-object-part="part:d"]')).toBeVisible({ timeout: 20_000 });
  });

  test('object list: Shift-click selects a range, Ctrl/⌘-click toggles one', async ({ page }) => {
    await page.locator('[data-object-part="part:a"]').click();
    await page.locator('[data-object-part="part:c"]').click({ modifiers: ['Shift'] });
    expect(await selection(page)).toEqual(['part:a', 'part:b', 'part:c']);
    await page.locator('[data-object-part="part:d"]').click({ modifiers: ['ControlOrMeta'] });
    expect(await selection(page)).toEqual(['part:a', 'part:b', 'part:c', 'part:d']);
    await page.locator('[data-object-part="part:b"]').click({ modifiers: ['ControlOrMeta'] });
    expect(await selection(page)).toEqual(['part:a', 'part:c', 'part:d']);
    // A range runs from the last row clicked without Shift.
    await page.locator('[data-object-part="part:d"]').click({ modifiers: ['Shift'] });
    expect(await selection(page)).toEqual(['part:b', 'part:c', 'part:d']);
  });

  test('viewport: Shift-drag box-selects, Esc clears, ⌘/Ctrl-A selects all, H hides, Shift-H shows', async ({ page }) => {
    const canvas = page.locator('canvas#viewport');
    const box = (await canvas.boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 4 });
    await expect(page.locator('[data-part-box-select]')).toBeVisible();
    await page.screenshot({ path: 'test-results/parts-box-select.png' });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    expect((await selection(page)).sort()).toEqual(['part:a', 'part:b', 'part:c', 'part:d']);

    await page.locator('body').click({ position: { x: 1, y: 1 }, force: true }).catch(() => {});
    await canvas.focus().catch(() => {});
    await page.keyboard.press('Escape');
    expect(await selection(page)).toEqual([]);

    await page.keyboard.press('ControlOrMeta+a');
    expect((await selection(page)).length).toBe(4);
    await page.keyboard.press('h');
    await expect.poll(async () => page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listObjectParts() as { parts: { hidden?: boolean }[] }).parts.every(p => p.hidden))).toBe(true);
    await page.keyboard.press('Shift+H');
    await expect.poll(async () => page.evaluate(() => ((window as unknown as { partwright: PW }).partwright.listObjectParts() as { parts: { hidden?: boolean }[] }).parts.some(p => p.hidden))).toBe(false);
  });

  test('viewport: Shift-click toggles the part under the cursor', async ({ page }) => {
    // Look straight down so every cube is in view, then click the middle of the canvas
    // region where part "b" or "c" sits: whichever part is hit is toggled twice.
    const canvas = page.locator('canvas#viewport');
    const box = (await canvas.boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');
    const after1 = await selection(page);
    expect(after1.length).toBe(1);
    await page.keyboard.down('Shift');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up('Shift');
    expect(await selection(page)).toEqual([]);
  });
});
