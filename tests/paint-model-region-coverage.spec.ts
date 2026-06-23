import { test, expect } from 'playwright/test';

// Regression for the model-region (api.label underlay) coverage collapse.
//
// `api.label(shape, name, { color })` creates a *model region* — the colored
// underlay beneath the paint layer — carrying a `byLabel` descriptor. Each smooth
// (edge-smoothing) brush stroke incrementally subdivides the working mesh, and
// `reresolveModelRegions` must carry the underlay's coverage across that split.
//
// The bug: it re-resolved the `byLabel` descriptor from `currentLabelMap`, which
// indexes the BASE mesh, but remapped those ids through the CURRENT-mesh
// parent→children map. After the 2nd incremental stroke the stale base ids no
// longer line up, so the underlay's coverage collapsed onto a shrinking, wrong
// cluster of triangles (observed 6033 → 2372 → 773 on a coarse pyramid). Wherever
// paint didn't cover, the label underlay then leaked through (e.g. purple
// triangles near a coarse pyramid's apex). It also broke live==reload determinism
// (a reload re-resolves to full coverage).
//
// The fix carries explicit/byLabel model regions forward via parent→children like
// the paint regions already do, so coverage tracks the mesh instead of collapsing.

test('api.label underlay coverage does not collapse across incremental strokes', async ({ page }) => {
  test.setTimeout(120000);
  const code =
    "const { Manifold } = api;\n" +
    "return api.label(Manifold.cylinder(22, 14, 0, 4), 'pyramid', { color: '#a855f7' });\n";

  await page.goto('/editor');
  await page.waitForFunction(() => !!(window as unknown as { partwright?: unknown }).partwright, null, {
    timeout: 60000,
  });
  await page.evaluate(async (c) => { await (window as unknown as { partwright: { run: (s: string) => Promise<unknown> } }).partwright.run(c); }, code);
  await page.waitForTimeout(4000);

  // A smooth brush stroke on the +X+Y face climbing toward the apex (0,0,22).
  function faceStroke(zLo: number, zHi: number, j: number): [number, number, number][] {
    const s: [number, number, number][] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const z = zLo + (zHi - zLo) * t;
      const k = z / 22;
      s.push([7 * (1 - k) + j * Math.sin(i), 7 * (1 - k) - j * Math.cos(i), z]);
    }
    return s;
  }

  const coverage = async (): Promise<number> =>
    page.evaluate(async () => {
      const { getModelRegions } = await import('/src/color/regions.ts');
      return getModelRegions().reduce((n, r) => n + r.triangles.size, 0);
    });

  const series: number[] = [];
  for (let i = 0; i < 3; i++) {
    const samples = faceStroke(4 + i * 4, 9 + i * 4, 0.9);
    await page.evaluate(async (s) => {
      const { addRegion } = await import('/src/color/regions.ts');
      addRegion('S', [0.85, 0.8, 0.3], 'paintbrush',
        { kind: 'brushStroke', samples: s, radius: 1, shape: 'circle', maxEdge: 0.0625, surface: 'slab', depth: 0, wrapAngleDeg: 90 } as never,
        new Set<number>(), true);
    }, samples);
    await page.waitForTimeout(7000);
    series.push(await coverage());
  }

  // The label covers the whole shape, so its underlay must track the (growing)
  // subdivided mesh — never shrink. Pre-fix this collapsed (e.g. 6033→2372→773).
  expect(series.length).toBe(3);
  expect(series[0]).toBeGreaterThan(100);
  for (let i = 1; i < series.length; i++) {
    expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
  }
});
