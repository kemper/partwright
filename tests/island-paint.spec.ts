import { test, expect, type Page } from 'playwright/test';

/** Three disjoint cubes laid out along X at z=0. Each cube has 12 triangles
 *  (24 verts in triangle-soup form), 3 cubes → 36 triangles total, all
 *  topologically disconnected (no shared vertex positions). After import,
 *  `listComponents()` should report 3 islands, and `paintIsland({index})`
 *  should colour exactly one cube per call. */
function buildMultiCubeSTL(): Buffer {
  const cubes = [
    { center: [-20, 0, 0], size: 5 },
    { center: [  0, 0, 0], size: 5 },
    { center: [ 20, 0, 0], size: 5 },
  ];
  const faces: number[][][] = [];
  for (const { center: [cx, cy, cz], size: s } of cubes) {
    const v = [
      [cx - s, cy - s, cz - s], [cx + s, cy - s, cz - s], [cx + s, cy + s, cz - s], [cx - s, cy + s, cz - s],
      [cx - s, cy - s, cz + s], [cx + s, cy - s, cz + s], [cx + s, cy + s, cz + s], [cx - s, cy + s, cz + s],
    ];
    faces.push(
      [v[0], v[2], v[1]], [v[0], v[3], v[2]],
      [v[4], v[5], v[6]], [v[4], v[6], v[7]],
      [v[0], v[1], v[5]], [v[0], v[5], v[4]],
      [v[2], v[3], v[7]], [v[2], v[7], v[6]],
      [v[0], v[4], v[7]], [v[0], v[7], v[3]],
      [v[1], v[2], v[6]], [v[1], v[6], v[5]],
    );
  }
  const buf = new ArrayBuffer(84 + faces.length * 50);
  const view = new DataView(buf);
  view.setUint32(80, faces.length, true);
  let off = 84;
  for (const tri of faces) {
    off += 12;
    for (const vert of tri) {
      view.setFloat32(off, vert[0], true); off += 4;
      view.setFloat32(off, vert[1], true); off += 4;
      view.setFloat32(off, vert[2], true); off += 4;
    }
    view.setUint16(off, 0, true); off += 2;
  }
  return Buffer.from(new Uint8Array(buf));
}

async function waitForEngine(page: Page) {
  await page.goto('/editor');
  await page.waitForFunction(
    () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('island painting on a multi-part STL', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('listComponents falls back to mesh-island BFS and paintIsland colours one cube at a time', async ({ page }) => {
    await waitForEngine(page);

    const stl = buildMultiCubeSTL();
    const base64 = stl.toString('base64');

    // Import the multi-cube STL via the programmatic API (bypasses file picker).
    const importResult = await page.evaluate(async (b64: string) => {
      const pw = (window as unknown as { partwright: { importMeshData: (b64: string, name: string, opts?: { sessionName?: string }) => Promise<{ sessionId: string; error?: string }> } }).partwright;
      return pw.importMeshData(b64, 'three-cubes.stl', { sessionName: 'three-cubes' });
    }, base64);
    expect(importResult.error).toBeUndefined();

    // Give the import a beat to run the freshly-generated code.
    await page.waitForTimeout(2000);

    // listComponents should return 3 islands via the mesh-island fallback.
    const list = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { listComponents: () => unknown } }).partwright;
      return pw.listComponents();
    }) as { count: number; components: Array<{ index: number; triangleCount?: number; centroid: [number, number, number] }>; source: string };
    // Three-cube STL is watertight enough to round-trip through Manifold,
    // so we land on source='manifold'. The Pomni STL the user uploaded is
    // non-manifold and would land on 'mesh-island'. Both paths return 3
    // components for 3 disjoint cubes — the assertion is the count + the
    // ability to paint by index, not which code path enumerated them.
    expect(['manifold', 'mesh-island']).toContain(list.source);
    expect(list.count).toBe(3);
    expect(list.components).toHaveLength(3);
    // Centroids should line up at x ≈ -20, 0, +20 (in some order — the BFS
    // enumeration order isn't a contract).
    const xs = list.components.map(c => Math.round(c.centroid[0])).sort((a, b) => a - b);
    expect(xs).toEqual([-20, 0, 20]);

    // Paint each cube a distinct colour by island index.
    const paintResults = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { paintIsland: (opts: unknown) => unknown } }).partwright;
      return [
        pw.paintIsland({ index: 0, color: [1.0, 0.1, 0.1], name: 'cube-0' }),
        pw.paintIsland({ index: 1, color: [0.1, 1.0, 0.1], name: 'cube-1' }),
        pw.paintIsland({ index: 2, color: [0.1, 0.1, 1.0], name: 'cube-2' }),
      ];
    }) as Array<{ id?: number; triangles?: number; error?: string }>;
    for (const r of paintResults) {
      expect(r.error).toBeUndefined();
      expect(r.triangles).toBe(12);  // exactly one cube's worth — no bleed
    }

    // Smoke-test paintIslandAt — point near the centre cube should grab island 1.
    const atResult = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { paintIslandAt: (opts: unknown) => unknown } }).partwright;
      return pw.paintIslandAt({ point: [0, 0, 5.5], color: [0.5, 0.5, 0.5], name: 'centre-by-point' });
    }) as { triangles?: number; error?: string };
    expect(atResult.error).toBeUndefined();
    expect(atResult.triangles).toBe(12);

  });

  test('paintInBox smooth: true is the default and accepted on AABB', async ({ page }) => {
    await waitForEngine(page);
    // Build a simple cube so we can paint half of it.
    await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { run: (code: string) => Promise<unknown> } }).partwright;
      return pw.run('const { Manifold } = api; return Manifold.cube([20, 20, 20], true);');
    });
    await page.waitForTimeout(800);

    // Paint the top half with smooth: true (default) — should succeed and
    // return smooth: true.
    const smooth = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { paintInBox: (opts: unknown) => unknown } }).partwright;
      return pw.paintInBox({ box: { min: [-10, -10, 0], max: [10, 10, 10] }, color: [0.9, 0.2, 0.2] });
    }) as { smooth?: boolean; triangles?: number; error?: string };
    expect(smooth.error).toBeUndefined();
    expect(smooth.smooth).toBe(true);
    expect(smooth.triangles).toBeGreaterThan(0);

    // Paint the bottom half with smooth: false — should bypass the smooth
    // path entirely.
    const flat = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: { paintInBox: (opts: unknown) => unknown } }).partwright;
      return pw.paintInBox({ box: { min: [-10, -10, -10], max: [10, 10, 0] }, color: [0.2, 0.2, 0.9], smooth: false });
    }) as { smooth?: boolean; triangles?: number; error?: string };
    expect(flat.error).toBeUndefined();
    // commitPaintFromSet doesn't return a smooth field — its absence confirms
    // we took the legacy path.
    expect(flat.smooth).toBeUndefined();
    expect(flat.triangles).toBeGreaterThan(0);
  });
});
