// Region clean-up ops: growRegion / shrinkRegion / despeckleRegion /
// combineRegions edit a painted region in place (same id), are one undo step,
// and are reachable from the in-app AI as `editRegion`.

import { test, expect, type Page } from 'playwright/test';
import { openSharedEditor } from './helpers/sharedPage';

let page: Page;
test.beforeAll(async ({ browser }, testInfo) => {
  page = await openSharedEditor(browser, testInfo);
});
test.afterAll(async () => {
  await page?.context().close();
});

/** Fresh sphere + a "speckled" lower-hemisphere region: every 9th lower
 *  triangle is left out (pin-holes) and every 31st upper triangle is added
 *  (stray islands). Returns the region id. */
async function speckledRegion(): Promise<number> {
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pw = (window as any).partwright;
    pw.clearColors();
    await pw.run('return api.Manifold.sphere(10, 64);');
    const m = pw.getMesh();
    const ids: number[] = [];
    for (let t = 0; t < m.numTri; t++) {
      const z = m.centroids[t * 3 + 2];
      if (z < 0 ? t % 9 !== 0 : z > 3 && t % 31 === 0) ids.push(t);
    }
    return pw.paintFaces({ triangleIds: ids, color: [0.95, 0.95, 0.95], name: 'sock' }).id;
  });
}

test.describe('region clean-up ops', () => {
  test('despeckleRegion drops islands, fills holes, keeps the id, and is one undo step', async () => {
    const id = await speckledRegion();
    const r = await page.evaluate((id) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const before = pw.listRegions().find((x: { id: number }) => x.id === id);
      const res = pw.despeckleRegion({ region: 'sock', minIslandTriangles: 10, maxHoleTriangles: 10 });
      const after = pw.listRegions();
      const undo = pw.undoLastPaint();
      const undone = pw.listRegions().find((x: { id: number }) => x.id === id);
      const redo = pw.redoLastPaint();
      const redone = pw.listRegions().find((x: { id: number }) => x.id === id);
      return { before, res, after, undo, undone, redo, redone };
    }, id);

    expect(r.res.error).toBeUndefined();
    expect(r.res.id).toBe(id);
    expect(r.res.islandsRemoved).toBeGreaterThan(0);
    expect(r.res.holesFilled).toBeGreaterThan(0);
    // Islands lived above z=3; after despeckle nothing is left up there.
    expect(r.after).toHaveLength(1);
    expect(r.after[0].bbox.max[2]).toBeLessThan(1.5);
    // Undo restores the speckled original (same id, same count); redo re-applies.
    expect(r.undo.error).toBeUndefined();
    expect(r.undone.triangles).toBe(r.before.triangles);
    expect(r.redone.triangles).toBe(r.res.triangles);
  });

  test('grow / shrink move the border by rings; grow honours a zMax clamp', async () => {
    await speckledRegion();
    const r = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.despeckleRegion({ region: 'sock' });
      const base = pw.listRegions()[0];
      const grown = pw.growRegion({ region: 'sock', steps: 3 });
      const grownBox = pw.listRegions()[0].bbox;
      pw.undoLastPaint();
      const clamped = pw.growRegion({ region: 'sock', steps: 3, zMax: 0.5 });
      const clampedBox = pw.listRegions()[0].bbox;
      pw.undoLastPaint();
      const shrunk = pw.shrinkRegion({ region: 'sock', steps: 2 });
      return { base, grown, grownBox, clamped, clampedBox, shrunk };
    });
    expect(r.grown.triangles).toBeGreaterThan(r.base.triangles);
    expect(r.grown.removed).toBe(0);
    expect(r.grownBox.max[2]).toBeGreaterThan(1);
    expect(r.clamped.triangles).toBeGreaterThan(r.base.triangles);
    expect(r.clamped.triangles).toBeLessThan(r.grown.triangles);
    expect(r.clampedBox.max[2]).toBeLessThan(1.5);
    expect(r.shrunk.triangles).toBeLessThan(r.base.triangles);
    expect(r.shrunk.added).toBe(0);
  });

  test('combineRegions subtract / union / intersect only change the target', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      const big = pw.paintInBox({ box: { min: [-20, -20, -20], max: [20, 20, 20] }, color: [1, 0, 0], name: 'all' });
      const top = pw.paintInBox({ box: { min: [-20, -20, 9], max: [20, 20, 20] }, color: [0, 0, 1], name: 'top' });
      const sub = pw.combineRegions({ region: 'all', op: 'subtract', with: 'top' });
      const topAfter = pw.listRegions().find((x: { name: string }) => x.name === 'top');
      const uni = pw.combineRegions({ region: big.id, op: 'union', with: [top.id] });
      const inter = pw.combineRegions({ region: 'all', op: 'intersect', with: 'top' });
      const self = pw.combineRegions({ region: 'all', op: 'union', with: 'all' });
      return { big, top, sub, topAfter, uni, inter, self };
    });
    expect(r.big.triangles).toBe(12);
    expect(r.top.triangles).toBe(2);
    expect(r.sub.triangles).toBe(10);
    expect(r.topAfter.triangles).toBe(2);
    expect(r.uni.triangles).toBe(12);
    expect(r.inter.triangles).toBe(2);
    expect(r.self.error).toContain('itself');
  });

  test('editRegion AI tool dispatches ops and refuses smooth regions', async () => {
    await speckledRegion();
    const r = await page.evaluate(async () => {
      const tools = await import('/src/ai/tools.ts');
      const desp = await tools.executeTool('editRegion', { op: 'despeckle', region: 'sock' });
      // Gemini-style stringified id still resolves.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      const id = String(pw.listRegions()[0].id);
      const grow = await tools.executeTool('editRegion', { op: 'grow', region: id, steps: 1 });
      pw.paintSlab({ axis: 'z', offset: 5, thickness: 2, smooth: true, color: [0, 1, 0], name: 'band' });
      const smooth = await tools.executeTool('editRegion', { op: 'shrink', region: 'band' });
      const bad = await tools.executeTool('editRegion', { op: 'blur', region: 'sock' });
      return { desp: JSON.parse(desp.content), grow: JSON.parse(grow.content), smooth: JSON.parse(smooth.content), bad: JSON.parse(bad.content) };
    });
    expect(r.desp.op).toBe('despeckle');
    expect(r.desp.islandsRemoved).toBeGreaterThan(0);
    expect(r.grow.op).toBe('grow');
    expect(r.grow.added).toBeGreaterThan(0);
    expect(r.smooth.error).toContain('smooth');
    expect(r.bad.error).toContain('editRegion.op');
  });

  test('paintFaces + region edits on a smooth-refined mesh survive a later full rebuild', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.sphere(10, 24);');
      // A smooth slab subdivides the working mesh, so ids below are refined-space.
      pw.paintSlab({ axis: 'z', offset: -2, thickness: 4, smooth: true, color: [1, 0, 0], name: 'band' });
      const m = pw.getMesh();
      const cap: number[] = [];
      const foot: number[] = [];
      for (let t = 0; t < m.numTri; t++) {
        const z = m.centroids[t * 3 + 2];
        if (z > 7) cap.push(t);
        else if (z < -7) foot.push(t);
      }
      pw.paintFaces({ triangleIds: cap, color: [0, 0, 1], name: 'cap' });
      pw.paintFaces({ triangleIds: foot, color: [0, 1, 0], name: 'foot' });
      pw.growRegion({ region: 'foot', steps: 1 });
      // A second smooth region forces a full rebuild from the base mesh, which
      // re-resolves every `triangles` descriptor as base ids.
      pw.paintSlab({ axis: 'x', offset: -1, thickness: 2, smooth: true, color: [1, 1, 0], name: 'band2' });
      const byName = (n: string) => pw.listRegions().find((x: { name: string }) => x.name === n);
      return { cap: byName('cap'), foot: byName('foot') };
    });
    // Before the fix both came back with 0 triangles (refined ids read as base ids).
    expect(r.cap.triangles).toBeGreaterThan(0);
    expect(r.cap.bbox.min[2]).toBeGreaterThan(4);
    expect(r.foot.triangles).toBeGreaterThan(0);
    // Id-baked regions survive a rebuild at base-triangle granularity (the
    // same contract as the UI brush), so the grown foot snaps out to whole
    // base triangles — still well clear of the equator band.
    expect(r.foot.bbox.max[2]).toBeLessThan(-2);
  });

  test('undoing an edit after a re-run restores the original on the right faces, keeping later recolours', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      pw.paintRegion({ point: [0, 0, 10], normal: [0, 0, 1], color: [1, 0, 0], name: 'top' });
      pw.growRegion({ region: 'top', steps: 1 });
      pw.replaceColor({ from: [1, 0, 0], to: [0, 0, 1] });
      // Re-run with the cube flipped: every triangle id now means a different face.
      await pw.run('return api.Manifold.cube([20, 20, 20], true).rotate([180, 0, 0]);');
      const undo = pw.undoLastPaint();
      const top = pw.listRegions().find((x: { name: string }) => x.name === 'top');
      return { undo, top };
    });
    expect(r.undo.error).toBeUndefined();
    // The original is a coplanar seed fill: re-resolved, it lands on the top
    // face again (stale ids would have painted the bottom, z = -10).
    expect(r.top.triangles).toBe(2);
    expect(r.top.bbox.min[2]).toBeCloseTo(10, 4);
    // Undo reverts the triangle edit only — the later recolour sticks.
    expect(r.top.color).toEqual([0, 0, 1]);
  });

  test('despeckle on a low-poly cube leaves the rest of the cube alone', async () => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.clearColors();
      await pw.run('return api.Manifold.cube([20, 20, 20], true);');
      pw.paintRegion({ point: [0, 0, 10], color: [1, 0, 0], name: 'top' });
      return pw.despeckleRegion({ region: 'top' });
    });
    expect(r.holesFilled).toBe(0);
    expect(r.triangles).toBe(2);
  });
});
