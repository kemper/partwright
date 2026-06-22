// Golden path for the Hollow / vase-mode surface modifier. Covers the public
// API (applyHollow → thin watertight shell; open-top vase, cut-plane mask, drain
// holes) and the Surface panel UI wiring. Uses a TAPERED cylinder on purpose —
// that's the shape a surface-nets shell meshed non-manifold; the levelSet path
// must keep it printable.

import { test, expect, type Page } from 'playwright/test';

// levelSet meshing is a heavy op (~10–15s); give each case room.
test.describe.configure({ timeout: 90_000 });

async function waitForEngine(page: Page) {
  await page.waitForSelector('text=Ready', { timeout: 20_000 });
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    { timeout: 20_000 },
  );
}

// A tapered cylinder (frustum) = a real vase blank, and the shape that broke the
// old surface-nets path.
const TAPER = 'const { Manifold } = api;\nreturn Manifold.cylinder(40, 16, 11, 96);';

test.describe('Hollow / vase surface modifier', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
    await page.goto('/editor');
    await waitForEngine(page);
  });

  test('applyHollow bakes a watertight thin shell on a tapered shape', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-api');
      await pw.run(code);
      const before = pw.getGeometryData().volume;
      const r = await pw.applyHollow({ wallThickness: 2 });
      return { r, stats: pw.getGeometryData(), src: pw.getCode(), before };
    }, [TAPER]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.r.label).toBe('hollow / vase');
    // levelSet output is watertight/manifold even on the taper (the bug case).
    expect(result.stats.isManifold).toBe(true);
    // A sealed shell's inner + outer walls are two closed surfaces → 2 components.
    expect(result.stats.componentCount).toBe(2);
    // Hollowing removes the interior, so the shell uses far less material.
    expect(result.stats.volume).toBeLessThan(result.before * 0.6);
    // The Taubin rim-relax pass clears the degenerate sliver triangles the
    // marcher beads onto the sharp bottom edge (a 0-length edge = a sliver).
    expect(result.stats.minEdgeLength).toBeGreaterThan(0);
    expect(result.src).toContain('Manifold.ofMesh(api.imports[0])');
  });

  test('open-top vase is one printable manifold piece, cut below the top', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-open');
      await pw.run(code);
      const r = await pw.applyHollow({ wallThickness: 2, openTop: true, rimHeight: 6 });
      return { r, stats: pw.getGeometryData() };
    }, [TAPER]);

    expect(result.r.error).toBeUndefined();
    expect(result.stats.isManifold).toBe(true);
    // Outer + inner walls join at the rim → a single connected piece.
    expect(result.stats.componentCount).toBe(1);
    // The top is cut at ~ (40 - 6), so the shell no longer reaches the original top.
    expect(result.stats.boundingBox.z[1]).toBeLessThan(36);
  });

  test('cut-plane mask keeps one side as an open shell', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-mask');
      await pw.run(code);
      const r = await pw.applyHollow({ wallThickness: 2, open: { axis: 'y', offset: 0, side: 'max' } });
      return { r, stats: pw.getGeometryData() };
    }, [TAPER]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBe(1);
    // The +Y half was removed, so the shell no longer extends past the cut plane.
    expect(result.stats.boundingBox.y[1]).toBeLessThan(2);
  });

  test('drain holes open the base (a planter) without breaking manifoldness', async ({ page }) => {
    const result = await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-planter');
      await pw.run(code);
      const r = await pw.applyHollow({ wallThickness: 2, openTop: true, rimHeight: 6, drainHoles: 4, drainRadius: 2 });
      return { r, stats: pw.getGeometryData() };
    }, [TAPER]);

    expect(result.r.error).toBeUndefined();
    expect(result.r.ok).toBe(true);
    expect(result.stats.isManifold).toBe(true);
    expect(result.stats.componentCount).toBe(1);
  });

  test('Surface panel Hollow / vase tab applies on the whole model', async ({ page }) => {
    await page.evaluate(async ([code]) => {
      const pw = (window as unknown as { partwright: any }).partwright;
      await pw.createSession('hollow-ui');
      await pw.run(code);
    }, [TAPER]);

    // Open the Tools popover, then the Surface panel.
    await page.locator('#viewport-tools-group-btn').click();
    await page.locator('#surface-viewport-toggle').click();
    await expect(page.getByText('Surface modifiers')).toBeVisible();

    // Switch to the Hollow / vase tab (defaults to Open-top vase mode) and apply.
    await page.getByRole('button', { name: 'Hollow / vase', exact: true }).click();
    // Hollow is bake-only, so the footer button reads "Apply (bake)".
    await page.getByRole('button', { name: 'Apply (bake)', exact: true }).click();

    // Apply saves a new version that bakes the shell mesh.
    await expect.poll(async () =>
      page.evaluate(() => (window as unknown as { partwright: any }).partwright.getCode()),
      { timeout: 40_000 },
    ).toContain('Manifold.ofMesh(api.imports[0])');
  });
});
