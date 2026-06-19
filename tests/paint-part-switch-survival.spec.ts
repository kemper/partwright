// Regression: painting a part, switching to another part, and switching back
// must NOT lose the paint — the part returned completely uncolored.
//
// The leak was in preserveCurrentEditsIfNeeded (the part-switch chokepoint):
// it bailed early whenever the editor still held untouched starter code, so a
// part painted directly on its starter geometry (never run/saved into) had its
// paint silently dropped on switch — no version was written, and the part
// reopened with zero color regions. The fix lets the auto-save run when
// interactive paint exists, even on starter code.

import { test, expect, type Page } from 'playwright/test';

interface API {
  createSession: (name?: string) => Promise<{ id: string }>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  createPart: (name?: string) => Promise<{ id: string; name: string } | { error: string }>;
  listParts: () => { id: string; name: string; isCurrent: boolean }[];
  getCode: () => string;
  paintFaces: (o: { triangleIds: number[]; color: [number, number, number]; name?: string }) => unknown;
  listRegions: () => unknown[];
}

const cube = (m: string) => `// ${m}\nconst { Manifold } = api; return Manifold.cube([10,10,10], true);`;

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

const regionCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { partwright: API }).partwright.listRegions().length);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('partwright-tour-completed', '1');
    try { localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false })); } catch { /* ignore */ }
  });
});

test('paint on a starter-code part survives a switch away and back', async ({ page }) => {
  await page.goto('/editor');
  await waitForEngine(page);

  // Part 1 keeps its untouched starter code; Part B gets real code so there's
  // somewhere to switch to.
  const { id1, idB } = await page.evaluate(async ({ b }) => {
    const pw = (window as unknown as { partwright: API }).partwright;
    await pw.createSession('paint-part-switch');
    const id1 = pw.listParts()[0].id;
    await pw.createPart('PartB');
    await pw.runAndSave(b, 'partB');
    const idB = pw.listParts().find((p) => p.name === 'PartB')!.id;
    return { id1, idB };
  }, { b: cube('B') });

  // Go to the starter part, render its starter geometry, paint it.
  await clickPart(page, id1);
  await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: API }).partwright;
    await pw.run(pw.getCode());
    pw.paintFaces({ triangleIds: [0, 1, 2, 3], color: [1, 0, 0], name: 'redface' });
  });
  await page.waitForTimeout(500);
  expect(await regionCount(page)).toBe(1);

  // Switch away and back — the paint must still be there.
  await clickPart(page, idB);
  await clickPart(page, id1);
  expect(await regionCount(page), 'color regions after returning to the painted part').toBe(1);
});
