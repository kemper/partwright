// Regression: a model whose colors are declared IN CODE (api.label / api.paint,
// e.g. the Christmas Tree catalog entry) must stay colored after switching to
// another part and back.
//
// The leak was in loadVersionIntoEditor's cache-hit branch: it called
// updateMesh(cachedEntry.meshData) on the uncolored base mesh and relied on
// rehydrateColorRegions to re-color. But rehydrateColorRegions returns early
// when there are no USER paint regions, so a model-colored part with no hand
// paint restored from cache showing the bare blue base — the color only
// "snapped back" once any paint op forced a re-render. The fix applies the
// model colors when rendering the cached mesh.

import { test, expect, type Page } from 'playwright/test';

interface API {
  listParts: () => { id: string; name: string }[];
  getModelColors: () => { count: number };
}

async function clickPart(page: Page, id: string) {
  await page.locator(`#parts-list [data-part-id="${id}"]`).click();
  await page.waitForTimeout(2000);
}

// Vertices in the displayed solid mesh whose color is NOT the default blue.
async function coloredVerts(page: Page) {
  return page.evaluate(async () => {
    const vp = await import('/src/renderer/viewport.ts');
    const group = (vp as { getMeshGroup: () => { children: unknown[] } }).getMeshGroup();
    const solid = group.children.find((c) => {
      const m = c as { isMesh?: boolean; name?: string };
      return m.isMesh && m.name !== 'wireframe' && m.name !== 'clip-cap';
    }) as { geometry?: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } | undefined } } | undefined;
    const attr = solid?.geometry?.getAttribute('color');
    if (!attr) return 0;
    const bR = 0x4a / 255, bG = 0x9e / 255, bB = 0xff / 255;
    let colored = 0;
    for (let i = 0; i < attr.count; i++) {
      if (Math.abs(attr.getX(i) - bR) > 0.05 || Math.abs(attr.getY(i) - bG) > 0.05 || Math.abs(attr.getZ(i) - bB) > 0.05) colored++;
    }
    return colored;
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('partwright-tour-completed', '1');
    try { localStorage.setItem('partwright-ai-settings-v1', JSON.stringify({ editorCollapsed: false })); } catch { /* ignore */ }
  });
});

test('in-code model colors survive a part switch round-trip', async ({ page }) => {
  await page.goto('/editor?catalog=christmas_tree.partwright.json');
  await page.waitForSelector('text=Ready', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createPart?: unknown } }).partwright?.createPart,
    { timeout: 25_000 },
  );
  await page.waitForTimeout(2500);

  // The tree declares its colors in code, so it renders colored from load.
  expect(await coloredVerts(page), 'colored verts on initial load').toBeGreaterThan(0);
  const treeId = await page.evaluate(() => (window as unknown as { partwright: API }).partwright.listParts()[0].id);

  // Add a couple of fresh parts (the user's flow), then switch away and back.
  await page.locator('#btn-add-part').click();
  await page.waitForTimeout(1200);
  await page.locator('#btn-add-part').click();
  await page.waitForTimeout(1200);
  const otherId = await page.evaluate(
    (tid) => (window as unknown as { partwright: API }).partwright.listParts().find((p) => p.id !== tid)!.id,
    treeId,
  );

  await clickPart(page, otherId);
  await clickPart(page, treeId);

  expect(await coloredVerts(page), 'colored verts after returning to the model-colored part').toBeGreaterThan(0);
});
