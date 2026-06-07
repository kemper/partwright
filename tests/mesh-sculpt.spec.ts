import { test, expect } from 'playwright/test';

// Mesh Sculpt end-to-end. Exercises the interactive sculpt API
// (`activateMeshSculpt`, `setSculptTool`/`setSculptBrush`, `sculptAt`,
// `meshSculptUndo`/`Redo`, `commitMeshSculpt`) — the same surface the AI loop
// and the panel's pointer handler funnel into — against the real engine.

test.describe('mesh sculpt', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('a push dab deforms the mesh; undo/redo step it; commit bakes a version', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('manifold-js');
      // A plain cube: spans [0,10] on each axis, so the top face is at z=10.
      await pw.runAndSave(`const { Manifold } = api; return Manifold.cube([10,10,10]);`, 'cube', { isManifold: true, maxComponents: 1 });
      const before = (await pw.listVersions()).length;

      const act = pw.activateMeshSculpt();
      pw.setSculptTool('push');
      pw.setSculptBrush({ radius: 3, strength: 0.6 });
      // A point on the top face with its outward normal — exactly what
      // probePixel returns in real use.
      const dab = pw.sculptAt({ point: [5, 5, 10], normal: [0, 0, 1] });
      const undo = pw.meshSculptUndo();
      const redo = pw.meshSculptRedo();

      const commit = await pw.commitMeshSculpt({ preserveColor: true });
      const after = (await pw.listVersions()).length;
      const code = pw.getCode();
      const geo = pw.getGeometryData();
      return { act, dab, undo, redo, commit, before, after, code, geo };
    });

    // Activation auto-densifies the 12-triangle cube so the brush has vertices.
    expect(r.act.ok).toBe(true);
    expect(r.act.triangles).toBeGreaterThan(12);
    // The dab moved vertices under the brush.
    expect(r.dab.moved).toBe(true);
    expect(r.undo.undone).toBe(true);
    expect(r.redo.redone).toBe(true);
    // Commit bakes a new version with the Manifold.ofMesh wrapper, still manifold.
    expect(r.commit.ok).toBe(true);
    expect(r.after).toBe(r.before + 1);
    expect(r.code).toContain('Manifold.ofMesh(api.imports[0])');
    expect(r.geo.isManifold).toBe(true);
  });

  test('sculpt tools are gated to manifold-js; voxel sessions refuse', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().fillBox([0,0,0],[2,2,2], '#ffffff');`);
      const act = pw.activateMeshSculpt();
      return { act };
    });
    expect(r.act.error).toBeTruthy();
    expect(r.act.error).toContain('manifold-js');
  });
});
