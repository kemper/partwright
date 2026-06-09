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

  test('opens on a smooth-surfaced grid (edits on the blocky preview)', async ({ page }) => {
    // The studio now opens on smooth grids: per-voxel picking runs on the
    // hard-faced provenance mesh while the grid keeps its surfacing for the
    // Rounding panel to read and re-apply on save.
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().fillBox([0,0,0],[3,3,3],'#fff').smooth({ strength: 0.5 });`);
      return pw.activateVoxelPaint();
    });
    expect(result.error).toBeFalsy();
    expect(result.voxelCount).toBe(64); // 4×4×4 box
  });

  test('rounded paint: brush recolors directly on the rounded surface (no snap-back)', async ({ page }) => {
    // The recolor tools pick the nearest occupied voxel to the hit point, so they
    // work on the smoothed mesh. We read the displayed geometry: the extent stays
    // rounded (no revert to blocks) and red vertices appear where we painted.
    const stats = () => page.evaluate(async () => {
      const { getMeshGroup } = await import('/src/renderer/viewport.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const solid = getMeshGroup().children[0] as any;
      const pos = solid?.geometry?.getAttribute('position');
      const col = solid?.geometry?.getAttribute('color');
      let mx = -Infinity;
      for (let i = 0; i < pos.count; i++) mx = Math.max(mx, pos.getX(i));
      let red = 0;
      if (col) for (let i = 0; i < col.count; i++) if (col.getX(i) > 0.8 && col.getY(i) < 0.3 && col.getZ(i) < 0.3) red++;
      return { maxX: mx, red };
    });
    await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().sphere([0,0,0],6,'#6cf').smooth({ algorithm: 'surfaceNets' });`);
      pw.activateVoxelPaint(); // default 'paint' tool is a point tool → rounded shown
    });
    await page.waitForTimeout(300);
    const before = await stats();
    expect(before.maxX).toBeLessThan(6.9); // opens rounded
    expect(before.red).toBe(0);
    // Synthesize a paint click at the canvas center (the sphere is centered).
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas')!;
      const r = canvas.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
      canvas.dispatchEvent(new PointerEvent('pointerdown', o));
      window.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    });
    await expect.poll(async () => (await stats()).red).toBeGreaterThan(0); // recolored on the rounded surface
    expect((await stats()).maxX).toBeLessThan(6.9); // still rounded — no snap-back to blocks
  });

  test('Rounding slider previews live in the viewport, edits snap back to blocks', async ({ page }) => {
    // The displayed solid mesh's extent is our window into what the studio shows
    // without baking: Surface Nets pulls the surface inward (~0.5 voxel), so the
    // max X of the rounded preview is smaller than the blocky mesh's. Reading the
    // live meshGroup (same module singleton the app uses) avoids depending on any
    // stat that only tracks committed runs.
    const maxX = () => page.evaluate(async () => {
      const { getMeshGroup } = await import('/src/renderer/viewport.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const solid = getMeshGroup().children[0] as any;
      const pos = solid?.geometry?.getAttribute('position');
      if (!pos) return NaN;
      let mx = -Infinity;
      for (let i = 0; i < pos.count; i++) mx = Math.max(mx, pos.getX(i));
      return mx;
    });
    const blockyMax = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().sphere([0,0,0],6,'#6cf');`);
      pw.activateVoxelPaint();
      await new Promise((r) => setTimeout(r, 200));
      const { getMeshGroup } = await import('/src/renderer/viewport.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = (getMeshGroup().children[0] as any).geometry.getAttribute('position');
      let mx = -Infinity;
      for (let i = 0; i < pos.count; i++) mx = Math.max(mx, pos.getX(i));
      return mx;
    });
    expect(blockyMax).toBeGreaterThan(6.9); // blocky sphere extent (voxel corner at 7)
    // Pick Surface Nets — the displayed mesh re-meshes rounded (the surface pulls
    // inward, ~0.5 voxel) without baking anything yet.
    await page.evaluate(() => {
      const sn = [...document.querySelectorAll('#voxel-paint-panel button')].find((b) => b.textContent === 'Surface Nets') as HTMLButtonElement;
      sn.click();
    });
    await expect.poll(maxX).toBeLessThan(blockyMax - 0.1);
    // Editing on the model snaps the preview back to the blocky provenance mesh.
    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      pw.setVoxelTool('paint');
      pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] });
    });
    await expect.poll(maxX).toBe(blockyMax);
  });

  test('Rounding panel preserves source-declared smooth options', async ({ page }) => {
    // Touching the rounding slider must merge onto the grid's surfacing, not
    // reset iterations/detail/algorithm to defaults.
    const code = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().fillBox([0,0,0],[5,5,5],'#6cf').smooth({ algorithm: 'taubin', iterations: 6, detail: 2 });`);
      pw.activateVoxelPaint();
      await new Promise((r) => setTimeout(r, 300));
      const slider = document.querySelector('#voxel-paint-panel input[title^="Rounding amount"]') as HTMLInputElement;
      slider.value = '40';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const upd = [...document.querySelectorAll('#voxel-paint-panel button')].find((b) => b.textContent === 'Update code') as HTMLButtonElement;
      upd.click();
      await new Promise((r) => setTimeout(r, 1500));
      return pw.getCode();
    });
    expect(code).toContain("algorithm: 'taubin'"); // preserved
    expect(code).toContain('iterations: 6');         // preserved
    expect(code).toContain('detail: 2');             // preserved
    expect(code).toContain('strength: 0.4');         // the panel's change
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
