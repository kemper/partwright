// Airbrush: sprays a soft speckle whose edge fades out via a stochastic
// per-triangle dither (NOT colour blending — every triangle is painted fully or
// not, so the result stays one printable colour per triangle). It honours the
// active surface mode: slab by default (gated by depth, like the rest of the
// brush) with geodesic available for curved/gap-separated surfaces. Driven
// through paintAirbrush (same path as the UI spray).

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

async function openEditor(page: Page) {
  await page.goto('/editor');
  await page.waitForSelector('text=Ready', { timeout: 15000 });
  await page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 10], true);`);
  });
}

// Shared-page equivalent of openEditor's reset. paintAirbrush is a pure
// console API call (fully self-parameterized), but a plain pw.run() does NOT
// clear pre-existing paint regions — it re-resolves them onto the fresh mesh
// by design — so an explicit clearColors() after the run gives each test the
// same "regions start at 0" guarantee a brand-new page would give it.
async function resetCube(page: Page, dims: [number, number, number] = [20, 20, 10]) {
  await page.evaluate(async (d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    await pw.run(`const { Manifold } = api; return Manifold.cube([${d[0]}, ${d[1]}, ${d[2]}], true);`);
    pw.clearColors();
  }, dims);
}

let page: Page;
// The shared page lives only inside this describe, so it is closed before the
// per-test UI describes run (never two WASM editor pages alive at once —
// the reason playwright.config.ts pins workers: 1).
test.describe('airbrush — shared page', () => {
  test.beforeAll(async ({ browser }, testInfo) => {
    page = await openSharedEditor(browser, testInfo);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test.describe('airbrush', () => {
    test('paintAirbrush sprays a region, subdivides for speckle, light by default', async () => {
      await resetCube(page);
      const out = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (window as any).partwright;
        const before = pw.getMesh().numTri;
        const r = pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, seed: 1, color: [0.9, 0.2, 0.2] });
        return { r, before, after: pw.getMesh().numTri, regions: pw.listRegions().length };
      });
      expect(out.r.error).toBeFalsy();
      expect(out.r.strength).toBe(0.4);              // light spackle by default
      expect(out.r.triangles).toBeGreaterThan(0);
      expect(out.after).toBeGreaterThan(out.before); // feather refined for fine speckle
      expect(out.regions).toBe(1);
    });

    test('higher strength covers strictly more (fixed seed → superset, non-flaky)', async () => {
      await resetCube(page);
      const out = await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (window as any).partwright;
        const spray = (strength: number) => {
          pw.clearColors();
          return pw.paintAirbrush({ points: [[0, 0, 5]], radius: 5, strength, softness: 0.5, seed: 1, maxEdge: 0.2, color: [1, 0, 0] }).triangles;
        };
        return { light: spray(0.3), heavy: spray(0.9) };
      });
      expect(out.light).toBeGreaterThan(0);
      expect(out.heavy).toBeGreaterThan(out.light);
    });

    test('spray stays on the surface: slab gated by depth, geodesic by connectivity', async () => {
      await resetCube(page);
      const out = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (window as any).partwright;
        // Thin plate: top z=1, bottom z=-1 (2 units thick). A radius-6 spray at the
        // top centre must stay on the top — the bottom is the back of the wall.
        await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 2], true);`);
        const minZ = (opts: Record<string, unknown>) => {
          pw.clearColors();
          pw.paintAirbrush({ points: [[0, 0, 1]], radius: 6, strength: 1, softness: 0.5, seed: 1, color: [1, 0, 0], ...opts });
          return pw.listRegions()[0].bbox.min[2];
        };
        return {
          slabShallow: minZ({ surface: 'slab', depth: 0.5 }), // hugs the top face
          slabDeep: minZ({ surface: 'slab', depth: 5 }),      // depth > plate → reaches back
          geodesic: minZ({ surface: 'geodesic' }),            // follows the surface, no depth
        };
      });
      expect(out.slabShallow).toBeGreaterThan(0); // shallow slab spray stayed on the top
      expect(out.geodesic).toBeGreaterThan(0);    // geodesic spray never bled through
      expect(out.slabDeep).toBeLessThan(0);       // a deep slab is the gate that lets it through
    });

    test('the speckle is deterministic across save + reload', async () => {
      await resetCube(page);
      const out = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (window as any).partwright;
        await pw.createSession('airbrush-persist');
        await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
        pw.paintAirbrush({ points: [[0, 0, 2]], radius: 5, strength: 0.6, softness: 0.5, seed: 3, maxEdge: 0.3, color: [0.2, 0.7, 1] });
        const paintedColored = pw.listRegions()[0].triangles;
        const sv = await pw.runAndSave(pw.getCode(), 'airbrush-v');
        await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
        await pw.loadVersion({ index: sv.version.index });
        return { paintedColored, reloadedColored: pw.listRegions()[0]?.triangles ?? 0, regions: pw.listRegions().length };
      });
      expect(out.paintedColored).toBeGreaterThan(0);
      expect(out.reloadedColored).toBe(out.paintedColored); // same speckle reproduced
      expect(out.regions).toBe(1);
    });

    test('overlapping sprays survive save + reload identically (multi-stroke determinism)', async () => {
      await resetCube(page);
      const out = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pw = (window as any).partwright;
        await pw.createSession('airbrush-multi');
        await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
        // Two overlapping sprays — the second appends onto the mesh the first
        // already refined; reload replays both from the base. The dither keys off
        // refined centroids, so both paths must converge.
        pw.paintAirbrush({ points: [[-3, 0, 2]], radius: 5, strength: 0.6, softness: 0.5, seed: 2, maxEdge: 0.3, color: [1, 0, 0] });
        pw.paintAirbrush({ points: [[3, 0, 2]], radius: 5, strength: 0.6, softness: 0.5, seed: 3, maxEdge: 0.3, color: [0, 0, 1] });
        const live = pw.listRegions().map((r: { triangles: number }) => r.triangles);
        const sv = await pw.runAndSave(pw.getCode(), 'multi-v');
        await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
        await pw.loadVersion({ index: sv.version.index });
        return { live, reloaded: pw.listRegions().map((r: { triangles: number }) => r.triangles) };
      });
      expect(out.live.length).toBe(2);
      expect(out.live[0]).toBeGreaterThan(0);
      expect(out.live[1]).toBeGreaterThan(0);
      expect(out.reloaded).toEqual(out.live); // both sprays reproduce exactly on reload
    });
  });
});

// The panel-toggle checks and the interactive spray drag need to open/click
// the paint picker panel without a symmetric teardown — safe on an isolated
// page but not stackable on the shared one (a second "open the panel" click
// would close a panel a prior test left open). Keep these on their own page.
test.describe('airbrush — UI interactions', () => {
  test('the brush panel has a Spray toggle that reveals strength/softness and keeps Slab available', async ({ page }) => {
    await openEditor(page);
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');

    const sprayToggle = page.locator('#brush-spray-toggle');
    await expect(sprayToggle).toBeVisible();
    await expect(sprayToggle).toContainText('Off');
    await expect(page.locator('#brush-spray-strength')).toBeHidden();
    // Slab is the default surface, so its depth slider shows before spraying too.
    await expect(page.locator('#brush-depth-wrap')).toBeVisible();

    await sprayToggle.dispatchEvent('click');
    await expect(sprayToggle).toContainText('On');
    await expect(page.locator('#brush-spray-strength')).toBeVisible();
    await expect(page.locator('#brush-spray-softness')).toBeVisible();
    // Spray now honours the surface mode, so Slab stays selectable while on and
    // the depth slider remains visible (the spray's slab thickness is tunable).
    const slabBtn = page.locator('#paint-picker-panel button[title*="thin shell"]');
    await expect(slabBtn).toBeEnabled();
    await expect(page.locator('#brush-depth-wrap')).toBeVisible();
  });

  test('a spray drag commits a speckled region and subdivides the mesh', async ({ page }) => {
    await openEditor(page);
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.run(`const { Manifold } = api; return Manifold.cube([40, 40, 3], true);`);
      pw.setBrushSize(5);
    });
    await page.locator('#paint-toggle').dispatchEvent('click');
    await page.waitForSelector('#paint-picker-panel:not(.hidden)');
    await page.locator('#paint-picker-panel button:has-text("Brush")').dispatchEvent('click');
    await page.locator('#brush-spray-toggle').dispatchEvent('click'); // spray on
    await page.waitForTimeout(150);
    const out = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.getMesh().numTri;
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (t: string, x: number, y: number) =>
        canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
      fire('pointermove', cx, cy);
      fire('pointerdown', cx, cy);
      for (let dx = 6; dx <= 24; dx += 6) fire('pointermove', cx + dx, cy);
      fire('pointerup', cx + 24, cy);
      // The interactive brush commits through the async (worker-backed) paint
      // pipeline; wait for the subdivision job to settle.
      await pw.waitForPaint();
      return { before, after: pw.getMesh().numTri, regions: pw.listRegions().length };
    });
    expect(out.regions).toBe(1);
    expect(out.after).toBeGreaterThan(out.before); // the spray subdivided for speckle
  });
});
