// Regression: a model whose colors are declared IN CODE (api.label / api.paint,
// e.g. the Christmas Tree catalog entry) must stay colored after switching to
// another part and back.
//
// The leak was in loadVersionIntoEditor's cache-hit branch: it called
// updateMesh(cachedEntry.meshData) on the uncolored base mesh and relied on
// rehydrateColorRegions to re-color. But that returned early when there were no
// USER paint regions, so a model-colored part with no hand paint restored from
// cache showing the bare blue base — the color only "snapped back" once any
// paint op forced a re-render. The fix makes rehydrateColorRegions the single
// authority that finalizes a restored part's colors (model underlay + user
// paint) for every load path, so no branch can forget to apply them.

import { test, expect, type Page } from 'playwright/test';

interface API {
  listParts: () => { id: string; name: string }[];
  getModelColors: () => { count: number };
  createSession: (name?: string) => Promise<{ id: string }>;
  runAndSave: (code: string, label?: string) => Promise<unknown>;
  run: (code: string) => Promise<unknown>;
  createPart: (name?: string) => Promise<{ id: string; name: string } | { error: string }>;
  paintStroke: (o: { points: number[][]; radius: number; color: number[]; maxEdge?: number; name?: string }) => unknown;
  saveVersion: (label?: string) => Promise<unknown>;
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

// Vertices whose displayed color is within `tol` of the target RGB (0..1).
async function vertsNear(page: Page, target: [number, number, number], tol = 0.18) {
  return page.evaluate(async ({ t, tol }) => {
    const vp = await import('/src/renderer/viewport.ts');
    const group = (vp as { getMeshGroup: () => { children: unknown[] } }).getMeshGroup();
    const solid = group.children.find((c) => {
      const m = c as { isMesh?: boolean; name?: string };
      return m.isMesh && m.name !== 'wireframe' && m.name !== 'clip-cap';
    }) as { geometry?: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } | undefined } } | undefined;
    const attr = solid?.geometry?.getAttribute('color');
    if (!attr) return 0;
    let n = 0;
    for (let i = 0; i < attr.count; i++) {
      if (Math.abs(attr.getX(i) - t[0]) < tol && Math.abs(attr.getY(i) - t[1]) < tol && Math.abs(attr.getZ(i) - t[2]) < tol) n++;
    }
    return n;
  }, { t: target, tol });
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

// The hardest case the unified color path must hold: a part with BOTH an
// in-code model color AND a user paint stroke that SUBDIVIDES the mesh
// (maxEdge set). The mesh cache stores the coarse base while the model-region
// indices are resolved against the refined mesh, so the cache-hit restore must
// re-resolve through rehydrateColorRegions rather than stamping model colors
// onto the coarse base — both layers must render correctly after a round-trip.
test('model color + a subdividing user stroke both survive a part switch', async ({ page }) => {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 25_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { createPart?: unknown } }).partwright?.createPart,
    { timeout: 25_000 },
  );

  const green: [number, number, number] = [0.1, 0.7, 0.1];
  const red: [number, number, number] = [0.95, 0.1, 0.1];

  const { idA, idB } = await page.evaluate(async () => {
    const pw = (window as unknown as { partwright: API }).partwright;
    await pw.createSession('model+stroke');
    // Part A: a cube whose body color is declared in code (model color).
    await pw.runAndSave(
      `const body = api.label(api.Manifold.cube([10,10,10], true), 'body', { color: [0.1, 0.7, 0.1] });\nreturn body;`,
      'A',
    );
    // A subdividing user stroke (maxEdge set) in red on the top face.
    pw.paintStroke({ points: [[0, 0, 5]], radius: 3, color: [0.95, 0.1, 0.1], maxEdge: 0.8, name: 'redtop' });
    await pw.saveVersion('A painted');
    // Part B to switch to.
    await pw.createPart('PartB');
    await pw.runAndSave(`const { Manifold } = api; return Manifold.cube([8,8,8], true);`, 'B');
    const parts = pw.listParts();
    return { idA: parts.find((p) => p.name !== 'PartB')!.id, idB: parts.find((p) => p.name === 'PartB')!.id };
  });

  await page.waitForTimeout(800);

  // Switch away and back — cache-hit restore of the model+stroke part.
  await clickPart(page, idB);
  await clickPart(page, idA);

  const greenVerts = await vertsNear(page, green);
  const redVerts = await vertsNear(page, red);
  expect(greenVerts, 'model (green) color after round-trip').toBeGreaterThan(0);
  expect(redVerts, 'user stroke (red) color after round-trip').toBeGreaterThan(0);
});
