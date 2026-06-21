// Regression: a viewport tool menu the user has open must survive a part
// switch. Switching to a part that declares parameters used to auto-pop the
// Customize panel, which — via the single-panel viewportPanelRegistry — stomped
// whatever menu the user already had open (Paint/Surface/Resize/…). The fix
// makes Customize defer to an already-open menu instead of auto-revealing over
// it: the part's knobs stay reachable from the Customize pill, but the user's
// current menu remains the current menu.

import { test, expect, type Page } from 'playwright/test';

const PLAIN = `const { Manifold } = api; return Manifold.cube([10,10,10], true);`;
const PARAM = `const { Manifold } = api;
const p = api.params({ width: { type:'number', default: 20, min:10, max:100, label:'Width' } });
return Manifold.cube([p.width, p.width, p.width], true);`;

interface API {
  createSession: (n?: string) => Promise<{ id: string }>;
  runAndSave: (c: string, l?: string) => Promise<unknown>;
  createPart: (n?: string) => Promise<unknown>;
  listParts: () => { id: string; name: string }[];
}

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createPart?: unknown } }).partwright?.createPart,
    { timeout: 20_000 },
  );
}
async function clickPart(page: Page, id: string) {
  await page.locator(`#parts-list [data-part-id="${id}"]`).click();
  await page.waitForTimeout(1800); // switch + recompile + rehydrate settle
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
});

test('an open tool menu survives a switch to a parametric part (no Customize stomp)', async ({ page }) => {
  await page.goto('/editor');
  await waitForEngine(page);

  // Part 1: plain (no params). Part 2: parametric (declares api.params).
  const { idPlain, idParam } = await page.evaluate(async ({ plain, param }) => {
    const pw = (window as unknown as { partwright: API }).partwright;
    await pw.createSession('menu-persist');
    await pw.runAndSave(plain, 'plain');
    const idPlain = pw.listParts()[0].id;
    await pw.createPart('ParamPart');
    await pw.runAndSave(param, 'param');
    const idParam = pw.listParts().find((p) => p.name === 'ParamPart')!.id;
    return { idPlain, idParam };
  }, { plain: PLAIN, param: PARAM });

  // On the plain part, open the Paint tool menu (it lives in the Tools popover).
  await clickPart(page, idPlain);
  await page.locator('#viewport-tools-group-btn').click();
  await page.locator('#paint-toggle').click();
  await expect(page.locator('#paint-picker-panel')).toBeVisible();
  await expect(page.locator('#params-panel')).toBeHidden();

  // Switch to the parametric part: Paint stays open, Customize does NOT pop over it.
  await clickPart(page, idParam);
  await expect(page.locator('#paint-picker-panel'), 'Paint menu stays open across the part switch').toBeVisible();
  await expect(page.locator('#params-panel'), 'Customize must not stomp the open Paint menu').toBeHidden();
});
