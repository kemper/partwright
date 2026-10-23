// #1049 follow-ups golden path: findFaces rejects an explicit undefined
// filter; probePixels batches probes; part triangles + seam loops + a smooth
// band painted along a seam (collar); the smooth-paint refined mesh persists
// with the version so a reload restores it without a rebuild; seed preview,
// capped seeds, focused/custom-angle renderParts and captioned compare sheets
// on an imported mesh.

import { test, expect, type Page } from 'playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

type PW = Record<string, (...args: unknown[]) => Promise<Record<string, unknown>> | Record<string, unknown>>;

function savePng(dataUrl: string, path: string): void {
  mkdirSync('test-results', { recursive: true });
  writeFileSync(path, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
}

async function waitForApi(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { partwright?: PW }).partwright);
  await page.waitForSelector('text=Ready', { timeout: 30_000 });
}

/** Two stacked labelled cylinders: "body" below z = 10, "neck" above. Their
 *  side walls meet in one closed ring at z = 10. */
const NECK_CODE = `const { Manifold } = api;
const body = api.label(Manifold.cylinder(10, 8, 8, 48), 'body');
const neck = api.label(Manifold.cylinder(6, 8, 8, 48).translate([0, 0, 10]), 'neck');
return body.add(neck);`;

test.describe('Part boundaries, batch probes and persisted smooth paint (#1049)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('partwright-tour-completed', '1'));
  });

  test('findFaces validation, probePixels, part triangles, seam loops and a collar band', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForApi(page);

    const out = await page.evaluate(async (code) => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('collar');
      await pw.run(code);
      const ffUndefined = pw.findFaces({ region: undefined });
      const ffUnknown = pw.findFaces({ regoin: 1 });
      const ffAll = pw.findFaces({}) as { count: number };
      const neck = pw.getPartTriangles('neck', { maxResults: 5 }) as { count: number; triangleIds: number[]; truncated?: boolean; bbox: { min: number[] } };
      const missingPart = pw.getPartTriangles('sleeve');
      const seam = pw.partBoundary('body', 'neck') as { count: number; loops: { closed: boolean; length: number; points: number[][] }[] };
      const view = { elevation: 0, azimuth: 0, size: 200 };
      const probes = pw.probePixels([[100, 100], { x: 100, y: 60 }, [2, 2]], view) as { hitCount: number; missCount: number; results: { hit: boolean; point?: number[] }[]; modelPixelBounds?: unknown };
      const probeBad = pw.probePixels([[500, 5]], view);
      const band = pw.paintAlongBoundary({ between: ['body', 'neck'], width: 2, color: [1, 0.1, 0.1], side: 'a', name: 'Collar' }) as { regions: { id: number; triangles: number }[]; loops: number; error?: string };
      const redOnNeck = pw.findFaces({ withinPart: 'neck', color: [1, 0.1, 0.1] }) as { count: number };
      const redOnBody = pw.findFaces({ withinPart: 'body', color: [1, 0.1, 0.1] }) as { count: number };
      // Ids are per paint mesh — fetch the neck's again after the band refined it.
      const neckNow = pw.getPartTriangles('neck', { maxResults: 5 }) as { triangleIds: number[] };
      const scoped = pw.paintFaces({ triangleIds: neckNow.triangleIds, color: [0, 0, 1], withinPart: 'body' });
      return { ffUndefined, ffUnknown, ffAll: ffAll.count, neck, missingPart, seam, probes, probeBad, band, redOnNeck: redOnNeck.count, redOnBody: redOnBody.count, scoped };
    }, NECK_CODE);

    expect(String(out.ffUndefined.error)).toMatch(/"region" was passed as undefined/);
    expect(String(out.ffUnknown.error)).toMatch(/unknown option "regoin"/);
    expect(out.ffAll).toBeGreaterThan(0);

    expect(out.neck.count).toBeGreaterThan(5);
    expect(out.neck.triangleIds).toHaveLength(5);
    expect(out.neck.truncated).toBe(true);
    expect(out.neck.bbox.min[2]).toBeGreaterThanOrEqual(9.99);
    expect(String((out.missingPart as { error?: string }).error)).toMatch(/no part "sleeve"/);

    expect(out.seam.count).toBe(1);
    expect(out.seam.loops[0].closed).toBe(true);
    expect(out.seam.loops[0].length).toBeGreaterThan(2 * Math.PI * 8 * 0.98);
    expect(out.seam.loops[0].length).toBeLessThan(2 * Math.PI * 8 * 1.01);
    for (const p of out.seam.loops[0].points) expect(p[2]).toBeCloseTo(10, 3);

    expect(out.probes.results).toHaveLength(3);
    expect(out.probes.results[0].hit).toBe(true);
    expect(out.probes.results[1].hit).toBe(true);
    expect(out.probes.results[2].hit).toBe(false);
    expect(out.probes.hitCount).toBe(2);
    expect(out.probes.modelPixelBounds).toBeTruthy();
    expect(String((out.probeBad as { error?: string }).error)).toMatch(/outside the 200×200 view/);

    expect(out.band.error).toBeUndefined();
    expect(out.band.loops).toBe(1);
    expect(out.band.regions[0].triangles).toBeGreaterThan(0);
    // side 'a' = the band lies on the body only.
    expect(out.redOnNeck).toBe(0);
    expect(out.redOnBody).toBeGreaterThan(0);
    // Neck ids clipped to the body part → nothing left → error.
    expect(String((out.scoped as { error?: string }).error)).toMatch(/nothing inside part "body"/);

    const img = await page.evaluate(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      return pw.renderView({ elevation: 15, azimuth: 30, size: 480 });
    }) as unknown as string | { image?: string };
    const dataUrl = typeof img === 'string' ? img : String(img.image);
    savePng(dataUrl, 'test-results/1049-collar-band.png');
  });

  test('the smooth-paint refined mesh persists with the version and a reload restores it', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/editor');
    await waitForApi(page);

    const saved = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.createSession('persist-refine');
      await pw.run(`const { Manifold } = api; return Manifold.cube([20, 20, 4], true);`);
      pw.paintStroke({ points: [[-4, 0, 2], [4, 0, 2]], radius: 3, maxEdge: 0.3, color: [0.2, 0.7, 1] });
      pw.paintStroke({ points: [[0, -6, 2], [0, 6, 2]], radius: 2, maxEdge: 0.3, color: [1, 0.6, 0.1] });
      const sv = await pw.saveVersion('painted') as { id: string };
      const db = await import('/src/storage/db.ts');
      const v = await db.getVersionById(sv.id) as { paintRefine?: { key?: string; mesh?: { numTri?: number; vertProperties?: unknown }; toRoot?: unknown } } | null;
      return {
        tris: (pw.getMesh() as { numTri: number }).numTri,
        regions: (pw.listRegions() as unknown as { triangles: number }[]).map((r) => r.triangles),
        key: v?.paintRefine?.key ?? '',
        persistedTris: v?.paintRefine?.mesh?.numTri ?? 0,
        typed: v?.paintRefine?.mesh?.vertProperties instanceof Float32Array && v?.paintRefine?.toRoot instanceof Int32Array,
      };
    });
    expect(saved.tris).toBeGreaterThan(12);
    expect(saved.key).toMatch(/^r1-/);
    expect(saved.persistedTris).toBe(saved.tris);
    expect(saved.typed).toBe(true);

    await page.reload();
    await waitForApi(page);
    await page.waitForFunction(() => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const regions = pw.listRegions() as unknown as { triangles: number }[];
      return regions.length === 2 && regions.every((r) => r.triangles > 0);
    }, undefined, { timeout: 30_000 });
    const after = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const { errorLog } = await import('/src/diagnostics/errorLog.ts');
      return {
        tris: (pw.getMesh() as { numTri: number }).numTri,
        regions: (pw.listRegions() as unknown as { triangles: number }[]).map((r) => r.triangles),
        restored: errorLog.getEntries().some((e) => /Restored smooth paint from the saved mesh/.test(e.message)),
      };
    });
    // The restore came from the persisted mesh, not a rebuild…
    expect(after.restored).toBe(true);
    // …and it is the same refined mesh and the same painted sets.
    expect(after.tris).toBe(saved.tris);
    expect(after.regions).toEqual(saved.regions);

    // Export embeds it (schema 1.21, base64), share links strip it, and an
    // import restores live typed arrays.
    const io = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const exported = await pw.exportSessionData() as { data: unknown };
      const payload = (typeof exported.data === 'string' ? JSON.parse(exported.data) : exported.data) as { partwright: string; versions: { paintRefine?: { key?: unknown; toRoot?: unknown } }[] };
      const { trimForShare } = await import('/src/share/shareLink.ts');
      const trimmed = trimForShare(payload as never) as { versions: Record<string, unknown>[] };
      const imported = await pw.importSessionData(exported.data) as { sessionId?: string; error?: string };
      const db = await import('/src/storage/db.ts');
      const re = imported.sessionId ? await db.getSessionLatestVersion(imported.sessionId) as { paintRefine?: { key?: string; toRoot?: unknown; mesh?: { vertProperties?: unknown } } } | null : null;
      const { SCHEMA_VERSION } = await import('/src/storage/sessionManager.ts');
      return {
        schema: payload.partwright,
        expected: SCHEMA_VERSION,
        exportedKey: typeof payload.versions.at(-1)?.paintRefine?.key === 'string',
        exportedBase64: typeof payload.versions.at(-1)?.paintRefine?.toRoot === 'string',
        sharedHasIt: trimmed.versions.some((v) => 'paintRefine' in v),
        importError: imported.error ?? null,
        reimportedTyped: re?.paintRefine?.toRoot instanceof Int32Array && re?.paintRefine?.mesh?.vertProperties instanceof Float32Array,
      };
    });
    expect(io.schema).toBe(io.expected);
    expect(io.exportedKey).toBe(true);
    expect(io.exportedBase64).toBe(true);
    expect(io.sharedHasIt).toBe(false);
    expect(io.importError).toBeNull();
    expect(io.reimportedTyped).toBe(true);
  });

  test('seed preview, capped seeds, focused renderParts and captioned comparisons on an import', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto('/editor');
    await waitForApi(page);
    const ok = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      await pw.runAndSave(`const { Manifold } = api;
return Manifold.cube([20, 20, 10]).add(Manifold.cube([10, 10, 10]).translate([5, 5, 10])).refine(4);`, 'block');
      const stl = await pw.exportSTLData() as { base64: string };
      return await pw.importMeshData(stl.base64, 'block.stl') as { error?: string };
    });
    expect(ok.error).toBeUndefined();
    await page.waitForFunction(() => /api\.imports\[0\]/.test(String((window as unknown as { partwright: PW }).partwright.getCode())));
    await page.waitForSelector('text=Ready', { timeout: 30_000 });

    const r = await page.evaluate(async () => {
      const pw = (window as unknown as { partwright: PW }).partwright;
      const preview = pw.previewSeeds([{ label: 'base', point: [10, 10, 0] }, { label: 'top', point: [10, 10, 40] }]) as { seeds: { onSurface: boolean; distance: number; triangle: number }[]; misses: number };
      const badSeed = pw.previewSeeds([{ label: 'x', point: [0, 0, 0], maxRadius: -1 }]);
      const det = await pw.detectParts({
        algorithm: 'crease-watershed',
        // The top seed may only grow 6 units: it can't reach the top cube's
        // far corners, which go to the base seed instead.
        seeds: [{ label: 'base', point: [10, 10, 0] }, { label: 'top', point: [10, 10, 20], maxRadius: 6 }],
      }) as { parts: { name: string; triCount: number }[]; seeds: { label: string; maxRadius?: number }[] };
      const pinned = pw.previewSeeds() as { seeds: { label: string; part?: { name: string } | null; maxRadius?: number }[] };
      const focused = pw.renderParts({ views: [{ azimuth: 90, elevation: 20 }], focus: 'top', size: 384 }) as { image?: string; views?: { azimuth: number }[]; focus?: string; error?: string };
      const both = pw.renderParts({ azimuth: 90, views: ['front'] });
      const cmp = await pw.comparePartDetectors([
        { algorithm: 'crease-watershed', seeds: [{ label: 'base', point: [10, 10, 0] }, { label: 'top', point: [10, 10, 20] }] },
        { algorithm: 'crease-watershed', seeds: [{ label: 'base', point: [10, 10, 0] }, { label: 'top', point: [10, 10, 20] }], params: { growth: 'summed', creaseWeight: 4 } },
      ], { size: 256 }) as { results: { caption: string }[]; image?: string };
      return { preview, badSeed, det, pinned, focused, both, cmp };
    });

    expect(r.preview.seeds[0].onSurface).toBe(true);
    expect(r.preview.seeds[1].onSurface).toBe(false);
    expect(r.preview.misses).toBe(1);
    expect(r.preview.seeds[1].distance).toBeCloseTo(20, 0);
    expect(String((r.badSeed as { error?: string }).error)).toMatch(/maxRadius must be/);

    const top = r.det.parts.find((p) => p.name === 'top')!;
    expect(top.triCount).toBeGreaterThan(0);
    expect(r.det.seeds.find((s) => s.label === 'top')?.maxRadius).toBe(6);
    expect(r.pinned.seeds.find((s) => s.label === 'top')?.part?.name).toBe('top');

    expect(r.focused.error).toBeUndefined();
    expect(r.focused.focus).toBe('top');
    expect(r.focused.views![0].azimuth).toBe(90);
    expect(String((r.both as { error?: string }).error)).toMatch(/either views or azimuth/);

    expect(r.cmp.results[0].caption).toBe('1. crease-watershed · creaseWeight=1 growth=hybrid');
    expect(r.cmp.results[1].caption).toBe('2. crease-watershed · creaseWeight=4 growth=summed');
    savePng(r.focused.image!, 'test-results/1049-renderParts-focus.png');
    savePng(r.cmp.image!, 'test-results/1049-compare-captions.png');
  });
});
