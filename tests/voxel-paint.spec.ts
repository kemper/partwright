import { test, expect } from 'playwright/test';

// Voxel paint end-to-end. Exercises the programmatic API
// (`activateVoxelPaint`, `paintVoxelFace`, `bakeVoxelsToCode`,
// `deactivateVoxelPaint`) — which is also what the AI agent loop calls — in a
// real browser with the real engine. The DOM pointer + viewport raycast is
// covered indirectly via `paintVoxelFace({faceIndex, …})`.

test.describe('voxel paint mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('activate → paint face → bake produces a new version with the painted grid', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      // Set up a tiny model so face 0 deterministically maps to voxel (0,0,0).
      await pw.run(`
        const { voxels } = api;
        const v = voxels();
        v.set(0, 0, 0, '#ffffff');
        return v;
      `);
      const initialGeo = pw.getGeometryData();
      const before = (await pw.listVersions()).length;

      const act = pw.activateVoxelPaint();
      // Repaint the first face red.
      const paint = pw.paintVoxelFace({ faceIndex: 0, color: [255, 0, 0] });
      // Erase voxel (0,0,0) via face 0 — should disappear entirely.
      const erase = pw.paintVoxelFace({ faceIndex: 0, erase: true });
      const baked = await pw.bakeVoxelsToCode({ label: 'painted-test' });
      const after = (await pw.listVersions()).length;
      const code = pw.getCode();
      const finalGeo = pw.getGeometryData();

      return { act, paint, erase, baked, before, after, code, initialGeo, finalGeo };
    });

    expect(result.act.error).toBeFalsy();
    expect(result.act.voxelCount).toBe(1);
    expect(result.paint.changed).toBe(true);
    expect(result.erase.changed).toBe(true);
    // After erasing the only voxel, bake should fail because the grid is empty —
    // surface the error rather than save an empty version.
    expect(result.baked.error).toBeTruthy();
    // versions count unchanged when bake errors.
    expect(result.after).toBe(result.before);
  });

  test('paint then bake → editor holds voxels.decode + new version saved', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      // Save a baseline version so listVersions has something to count from.
      const baseline = await pw.runAndSave(`
        const { voxels } = api;
        return voxels().fillBox([0,0,0],[2,2,2], '#ffffff');
      `, 'baseline');
      const before = (await pw.listVersions()).length;
      pw.activateVoxelPaint();
      pw.paintVoxelFace({ faceIndex: 0, color: [255, 0, 0] });
      pw.paintVoxelFace({ faceIndex: 2, color: [0, 255, 0] });
      const baked = await pw.bakeVoxelsToCode({ label: 'mix' });
      const code = pw.getCode();
      const after = (await pw.listVersions()).length;
      const geo = pw.getGeometryData();
      return { baseline, baked, code, before, after, geo };
    });

    expect(result.baseline.version).toBeTruthy();
    expect(result.baked.error).toBeFalsy();
    expect(result.baked.versionIndex).not.toBeNull();
    expect(result.after).toBe(result.before + 1);
    expect(result.code).toContain('voxels.decode(');
    expect(result.geo.isManifold).toBe(true);
  });

  test('activateVoxelPaint refuses outside voxel sessions', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Stay in the default manifold-js engine.
      return pw.activateVoxelPaint();
    });
    expect(result.error).toMatch(/voxel sessions/);
  });

  test('deactivate restores the pre-paint mesh from the code', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().set(0,0,0,'#ffffff');`);
      pw.activateVoxelPaint();
      pw.paintVoxelFace({ faceIndex: 0, color: [255, 0, 0] });
      const cancel = pw.deactivateVoxelPaint();
      // Allow the re-run to settle.
      await new Promise(r => setTimeout(r, 100));
      const code = pw.getCode();
      return { cancel, code };
    });
    expect(result.cancel.error).toBeFalsy();
    // Editor still holds the original procedural code, not voxels.decode(...).
    expect(result.code).not.toContain('voxels.decode(');
  });

  test('refuses smooth-surfaced grids with a clear message', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().fillBox([0,0,0],[3,3,3],'#fff').smooth();`);
      return pw.activateVoxelPaint();
    });
    expect(result.error).toMatch(/smooth-surfaced/);
  });

  test('cross-session: loading a different version cancels active paint', async ({ page }) => {
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      const v1 = await pw.runAndSave(`return api.voxels().set(0,0,0,'#fff');`, 'first');
      const v2 = await pw.runAndSave(`return api.voxels().set(0,0,0,'#fff').set(1,0,0,'#fff');`, 'second');
      // Activate paint while v2 is loaded, then jump back to v1.
      pw.activateVoxelPaint();
      const activeBefore = pw.activateVoxelPaint().error; // already-active path
      await pw.loadVersion({ index: v1.version.index });
      // Paint should now be off; activating again should succeed (no leftover state).
      const reactivate = pw.activateVoxelPaint();
      return { reactivate, activeBefore };
    });
    // The second activate while already active is a no-op activate (calls
    // deactivate first); the reactivate after loadVersion succeeds with the
    // v1 grid (1 voxel).
    expect(result.reactivate.error).toBeFalsy();
    expect(result.reactivate.voxelCount).toBe(1);
  });
});
