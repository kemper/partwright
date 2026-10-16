// Smooth bucket fills: `paintConnected` / `paintRegion` with `smooth: true`
// cut the mesh along a blurred version of the fill boundary instead of stopping
// on whole triangles, so a hem / hairline on a scan-like mesh is a clean line.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

// A lumpy capsule "leg" meshed by levelSet — irregular triangles, like a scan.
const LEG = `const { Manifold } = api;
const seg = (p) => { const z = Math.max(3, Math.min(27, p[2])); return Math.hypot(p[0], p[1], p[2] - z); };
return Manifold.levelSet(p => 5 + 0.4 * Math.sin(p[2] * 0.7 + p[0]) - seg(p), { min: [-7, -7, -3], max: [7, 7, 33] }, 1.1);`;

/** Paint a clamped "sock" on the leg and measure its boundary: total length of
 *  edges between painted and unpainted triangles, and the Z spread of those
 *  edges' vertices (how far the hem wanders from the clamp line). */
async function paintSock(smooth: boolean, extra: Record<string, unknown> = {}) {
  return page.evaluate(async ({ LEG, smooth, extra }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    pw.clearColors();
    await pw.run(LEG);
    const baseTris = pw.getMesh().numTri;
    const r = pw.paintConnected({ seed: { point: [0, 0, -2] }, maxDeviationDeg: 180, zMax: 13, color: [0.2, 0.35, 0.8], name: 'sock', smooth, ...extra });
    if (r.error) return { error: r.error as string };
    const m = pw.getMesh();
    const ids: number[] = pw.findFaces({ region: r.id, maxResults: 1e9 }).triangleIds;
    const inSet = new Set(ids);
    const pos = (v: number) => `${m.vertices[v * 3]},${m.vertices[v * 3 + 1]},${m.vertices[v * 3 + 2]}`;
    const owners = new Map<string, { a: number; b: number; ins: boolean[] }>();
    for (let t = 0; t < m.numTri; t++) {
      for (let k = 0; k < 3; k++) {
        const a = m.triangles[t * 3 + k], b = m.triangles[t * 3 + ((k + 1) % 3)];
        const pa = pos(a), pb = pos(b);
        const key = pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
        const e = owners.get(key) ?? { a, b, ins: [] };
        e.ins.push(inSet.has(t));
        owners.set(key, e);
      }
    }
    let perimeter = 0, zMin = Infinity, zMax = -Infinity;
    for (const { a, b, ins } of owners.values()) {
      if (!(ins.includes(true) && ins.includes(false))) continue;
      const ax = m.vertices[a * 3], ay = m.vertices[a * 3 + 1], az = m.vertices[a * 3 + 2];
      const bx = m.vertices[b * 3], by = m.vertices[b * 3 + 1], bz = m.vertices[b * 3 + 2];
      perimeter += Math.hypot(ax - bx, ay - by, az - bz);
      zMin = Math.min(zMin, az, bz); zMax = Math.max(zMax, az, bz);
    }
    return { id: r.id as number, triangles: r.triangles as number, smooth: r.smooth as boolean | undefined, baseTris, meshTris: m.numTri, perimeter, zSpread: zMax - zMin };
  }, { LEG, smooth, extra });
}

test.describe('smooth bucket fills', () => {
  test('smooth: true turns the sawtooth hem into a clean line', async () => {
    const raw = await paintSock(false);
    const smooth = await paintSock(true);
    if ('error' in raw || 'error' in smooth) throw new Error(JSON.stringify({ raw, smooth }));
    // Raw fill doesn't touch the tessellation; the smooth one only cuts the rim.
    expect(raw.meshTris).toBe(raw.baseTris);
    expect(smooth.meshTris).toBeGreaterThan(smooth.baseTris);
    expect(smooth.meshTris).toBeLessThan(smooth.baseTris * 1.2);
    expect(smooth.smooth).toBe(true);
    // The teeth are gone: a shorter boundary that hugs the clamp line.
    expect(smooth.perimeter).toBeLessThan(raw.perimeter * 0.8);
    expect(smooth.zSpread).toBeLessThan(raw.zSpread * 0.6);
  });

  test('a smooth fill resolves the same live and after save + reload, and undoes cleanly', async () => {
    const out = await page.evaluate(async (LEG) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.createSession('smooth-fill-persist');
      pw.clearColors();
      await pw.run(LEG);
      const baseTris = pw.getMesh().numTri;
      pw.paintConnected({ seed: { point: [0, 0, -2] }, maxDeviationDeg: 180, zMax: 13, color: [0.2, 0.35, 0.8], name: 'sock', smooth: true, smoothness: 6 });
      const live = { mesh: pw.getMesh().numTri, sock: pw.listRegions()[0].triangles };
      const sv = await pw.runAndSave(pw.getCode(), 'smooth-fill-v');
      await pw.run(LEG);
      const rerun = { mesh: pw.getMesh().numTri, sock: pw.listRegions().find((r: { name: string }) => r.name === 'sock')?.triangles ?? -1 };
      await pw.loadVersion({ index: sv.version.index });
      const reloaded = { mesh: pw.getMesh().numTri, sock: pw.listRegions().find((r: { name: string }) => r.name === 'sock')?.triangles ?? -1 };
      pw.undoLastPaint();
      const undone = pw.getMesh().numTri;
      pw.redoLastPaint();
      const redone = pw.getMesh().numTri;
      return { baseTris, live, rerun, reloaded, undone, redone };
    }, LEG);
    expect(out.rerun).toEqual(out.live);
    expect(out.reloaded).toEqual(out.live);
    expect(out.undone).toBe(out.baseTris);
    expect(out.redone).toBe(out.live.mesh);
  });

  test('a CAD face keeps its crisp edge: smooth paintRegion on a cube top', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      const res = pw.paintRegion({ point: [0, 0, 10], color: [1, 0, 0], smooth: true });
      return { res, mesh: pw.getMesh().numTri, bbox: pw.listRegions()[0]?.bbox };
    });
    expect(r.res.error).toBeUndefined();
    expect(r.res.triangles).toBe(2);
    expect(r.mesh).toBe(12); // nothing to cut — the edge already follows the crease
    expect(r.bbox.min[2]).toBeCloseTo(10, 5);
  });

  test('AI tools pass smooth through; bad smoothness and editRegion on a smooth fill are refused', async () => {
    const r = await page.evaluate(async (LEG) => {
      const tools = await import('/src/ai/tools.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run(LEG);
      const base = pw.getMesh().numTri;
      const ok = JSON.parse((await tools.executeTool('paintConnected', { seed: { point: [0, 0, -2] }, maxDeviationDeg: 180, zMax: 13, color: [0, 0, 1], name: 'sock', smooth: true })).content);
      const cut = pw.getMesh().numTri > base;
      const edit = JSON.parse((await tools.executeTool('editRegion', { op: 'grow', region: 'sock' })).content);
      const noSmooth = pw.paintConnected({ seed: { point: [0, 0, -2] }, color: [0, 1, 0], smoothness: 3 });
      const tooBig = pw.paintConnected({ seed: { point: [0, 0, -2] }, color: [0, 1, 0], smooth: true, smoothness: 99 });
      return { ok, cut, edit, noSmooth, tooBig };
    }, LEG);
    expect(r.ok.smooth).toBe(true);
    expect(r.ok.triangles).toBeGreaterThan(0);
    expect(r.cut).toBe(true);
    expect(r.edit.error).toContain('smooth');
    expect(r.noSmooth.error).toContain('smoothness only applies');
    expect(r.tooBig.error).toContain('smoothness must be');
  });
});
