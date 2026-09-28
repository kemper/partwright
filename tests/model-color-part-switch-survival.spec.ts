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
import { waitFor } from './helpers/waitFor';

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

// The parts-list row click handler is fire-and-forget (`void cb.onSelectPart`),
// so poll for the active part to actually flip before proceeding — the real
// (if partial) completion signal. Callers that then assert on rendered colors
// additionally poll those colors directly (via expect.poll), since currentPart
// flips before loadPartIntoEditor's color restore finishes.
async function clickPart(page: Page, id: string) {
  await page.locator(`#parts-list [data-part-id="${id}"]`).click();
  await waitFor(
    () => page.evaluate(
      (pid) => (window as unknown as { partwright: { listParts: () => { id: string; isCurrent?: boolean }[] } }).partwright
        .listParts().find((p) => p.id === pid)?.isCurrent === true,
      id,
    ),
    { timeout: 10_000, message: 'the part row click to register' },
  );
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
  // The tree declares its colors in code, so it renders colored from load.
  // Poll for it directly (the catalog bake + first render) instead of
  // sleeping a guess before sampling once.
  await expect.poll(() => coloredVerts(page), { timeout: 15_000, message: 'colored verts on initial load' }).toBeGreaterThan(0);
  const treeId = await page.evaluate(() => (window as unknown as { partwright: API }).partwright.listParts()[0].id);

  // Add a couple of fresh parts (the user's flow), then switch away and back.
  // "+" is fire-and-forget (see part-unload-paint.spec.ts's waitForPartChange
  // note), so poll the part count instead of sleeping.
  await page.locator('#btn-add-part').click();
  await waitFor(() => page.evaluate(() => (window as unknown as { partwright: API }).partwright.listParts().length === 2), { timeout: 10_000, message: '2 parts to exist' });
  await page.locator('#btn-add-part').click();
  await waitFor(() => page.evaluate(() => (window as unknown as { partwright: API }).partwright.listParts().length === 3), { timeout: 10_000, message: '3 parts to exist' });
  const otherId = await page.evaluate(
    (tid) => (window as unknown as { partwright: API }).partwright.listParts().find((p) => p.id !== tid)!.id,
    treeId,
  );

  await clickPart(page, otherId);
  await clickPart(page, treeId);

  // clickPart only confirms the active-part flip; the color restore
  // (loadPartIntoEditor → rehydrateColorRegions) can still be settling, so
  // poll the actual rendered colors — the real completion signal, and
  // literally the condition under test.
  await expect.poll(() => coloredVerts(page), { timeout: 15_000, message: 'colored verts after returning to the model-colored part' }).toBeGreaterThan(0);
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

  // Every step above (createSession/runAndSave/saveVersion/createPart) is
  // awaited inside the evaluate() call, and paintStroke resolves its region
  // synchronously (the agent-API path bypasses the async Worker reconcile —
  // see reconcilePaintedGeometryAsync's doc comment in main.ts), so no extra
  // settle margin is needed before switching parts.

  // Switch away and back — cache-hit restore of the model+stroke part.
  await clickPart(page, idB);
  await clickPart(page, idA);

  // clickPart only confirms the active-part flip; poll the actual rendered
  // colors (the real completion signal for the color-restore path under test).
  await expect.poll(() => vertsNear(page, green), { timeout: 15_000, message: 'model (green) color after round-trip' }).toBeGreaterThan(0);
  await expect.poll(() => vertsNear(page, red), { timeout: 15_000, message: 'user stroke (red) color after round-trip' }).toBeGreaterThan(0);
});
