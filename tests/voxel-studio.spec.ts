import { test, expect } from 'playwright/test';

// Voxel Studio end-to-end. Exercises the multi-tool editing API
// (`setVoxelTool`, `voxelStudioApply`, `voxelStudioUndo`/`Redo`) — which is
// also what the AI agent loop and the panel's pointer handler funnel into — in
// a real browser with the real engine.

test.describe('voxel studio', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/editor');
    await page.waitForFunction(
      () => !!(window as unknown as { partwright?: { run?: unknown } }).partwright?.run,
      undefined,
      { timeout: 30_000 },
    );
  });

  test('add tool places a cube on the clicked face; undo/redo step the grid', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().set(0,0,0,'#ffffff');`);
      pw.activateVoxelPaint();
      const setTool = pw.setVoxelTool('add');
      // Face 0 of a lone voxel is an exposed face; "add" stacks a neighbor.
      const added = pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] });
      const added2 = pw.voxelStudioApply({ faceIndex: 0 }); // adds on another exposed face
      const undone = pw.voxelStudioUndo();
      const afterUndo = pw.voxelStudioUndo();
      const redone = pw.voxelStudioRedo();
      return { setTool, added, added2, undone, afterUndo, redone };
    });
    expect(r.setTool.tool).toBe('add');
    expect(r.added.changed).toBe(true);
    expect(r.added.voxelCount).toBe(2);
    expect(r.added2.changed).toBe(true);
    expect(r.added2.voxelCount).toBe(3);
    // Undo twice walks back both adds to the original single voxel.
    expect(r.undone.voxelCount).toBe(2);
    expect(r.afterUndo.voxelCount).toBe(1);
    // Redo restores one step.
    expect(r.redone.redone).toBe(true);
    expect(r.redone.voxelCount).toBe(2);
  });

  test('bucket recolors a connected region; bake writes voxels.decode', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().fillBox([0,0,0],[2,2,2], '#ffffff');`);
      const before = (await pw.listVersions()).length;
      pw.activateVoxelPaint();
      pw.setVoxelTool('bucket');
      const filled = pw.voxelStudioApply({ faceIndex: 0, color: [0, 128, 255] });
      const baked = await pw.bakeVoxelsToCode({ label: 'bucketed' });
      const code = pw.getCode();
      const after = (await pw.listVersions()).length;
      const geo = pw.getGeometryData();
      return { filled, baked, code, before, after, geo };
    });
    expect(r.filled.changed).toBe(true);
    expect(r.filled.voxelCount).toBe(27); // 3×3×3 cube count preserved
    expect(r.baked.error).toBeFalsy();
    expect(r.after).toBe(r.before + 1);
    expect(r.code).toContain('voxels.decode(');
    expect(r.geo.isManifold).toBe(true);
  });

  test('box tools take two clicks (bank a corner, then complete)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      // A flat 4×1×4 plate gives several distinct exposed faces to click.
      await pw.run(`return api.voxels().fillBox([0,0,0],[3,0,3], '#888888');`);
      pw.activateVoxelPaint();
      // Re-pass the tool on BOTH calls — a natural AI/programmatic pattern that
      // must not re-bank the corner (regression guard: setTool is a no-op when
      // the tool is unchanged, so the box still completes on the second click).
      const first = pw.voxelStudioApply({ faceIndex: 0, tool: 'boxRemove' });
      const second = pw.voxelStudioApply({ faceIndex: 10, tool: 'boxRemove' });
      return { first, second };
    });
    // First click banks a corner: no change, a pending corner is set.
    expect(r.first.changed).toBe(false);
    expect(r.first.pendingBoxCorner).not.toBeNull();
    // Second click completes the box and clears the pending corner.
    expect(r.second.pendingBoxCorner).toBeNull();
  });

  test('add-block size stamps a footprint of voxels in one apply', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().set(0,0,0,'#ffffff');`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('add');
      // The add tool stamps a block sized by X/Y/Z (not the paint brush radius);
      // depth 1 sinks its near layer into the clicked voxel so the 3×3×3 block
      // overlaps the origin.
      const brush = pw.setVoxelBrush({ block: [3, 3, 3], depth: 1 });
      const added = pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] });
      return { brush, added };
    });
    expect(r.brush.block).toEqual([3, 3, 3]);
    expect(r.brush.depth).toBe(1);
    expect(r.added.changed).toBe(true);
    expect(r.added.voxelCount).toBe(27); // 3×3×3 block, near layer overlapping the origin
  });

  test('depth accepts a typed value past the slider max (no hard upper clamp)', async ({ page }) => {
    // The depth slider tops out at 16, but the typed number input has no max —
    // setAddDepth keeps whatever you type (>= 0). Drive both the API and the
    // panel's number input to prove neither re-clamps at 16.
    const viaApi = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().set(0,0,0,'#ffffff');`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('add');
      return pw.setVoxelBrush({ depth: 40 }).depth;
    });
    expect(viaApi).toBe(40); // not clamped to 16

    // Now the panel's number input: typing 50 and committing keeps 50, while the
    // range slider pins its thumb at its own max of 16.
    const input = page.locator('#voxel-paint-panel input[type="number"]').last();
    await input.fill('50');
    await input.press('Enter');
    await expect(input).toHaveValue('50');
    const storedDepth = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).partwright.setVoxelBrush({}).depth,
    );
    expect(storedDepth).toBe(50);
    const sliderVal = await page
      .locator('#voxel-paint-panel input[type="range"]')
      .last()
      .inputValue();
    expect(Number(sliderVal)).toBeLessThanOrEqual(16);
  });

  test('level tool recolors a whole axis layer without changing the count', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().fillBox([0,0,0],[2,2,2], '#ffffff');`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('level');
      pw.setVoxelLevelAxis(2);
      const leveled = pw.voxelStudioApply({ faceIndex: 0, color: [0, 200, 100] });
      const baked = await pw.bakeVoxelsToCode({ label: 'leveled' });
      return { leveled, baked };
    });
    expect(r.leveled.changed).toBe(true);
    expect(r.leveled.voxelCount).toBe(27); // recolor never adds/removes voxels
    expect(r.baked.error).toBeFalsy();
  });

  test('a stroke collapses many applies into one undo step', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().set(0,0,0,'#ffffff');`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('add');
      pw.setVoxelBrush({ radius: 0 });
      pw.voxelStudioBeginStroke();
      const a = pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] });
      const b = pw.voxelStudioApply({ faceIndex: 0 });
      const end = pw.voxelStudioEndStroke();
      const undone = pw.voxelStudioUndo();   // one undo reverts the whole stroke
      const redone = pw.voxelStudioRedo();
      return { a, b, end, undone, redone };
    });
    expect(r.a.voxelCount).toBe(2);
    expect(r.b.voxelCount).toBe(3);
    expect(r.end.voxelCount).toBe(3);
    expect(r.undone.undone).toBe(true);
    expect(r.undone.voxelCount).toBe(1); // back to the original single voxel
    expect(r.redone.voxelCount).toBe(3); // the whole stroke restored at once
  });

  test('touch pointer events drive the studio (mobile path)', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      // A chunky centered cube so a tap at the canvas center reliably hits it.
      await pw.run(`return api.voxels().fillBox([-3,-3,0],[3,3,6], '#cccccc');`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('boxAdd');

      // Let the freshly-activated mesh land in the scene + BVH build before the
      // raycast (mirrors a real user, who never taps within the same tick).
      await new Promise<void>((res) => setTimeout(res, 100));

      const canvas = document.querySelector('canvas.viewport-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const touch = (type: string, buttons: number) => new PointerEvent(type, {
        pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons,
        clientX: cx, clientY: cy, bubbles: true, cancelable: true, composed: true,
      });
      // A real touch tap over the model — this is the path that was swallowed by
      // the viewport's capture-phase OrbitControls suppressor before the fix.
      canvas.dispatchEvent(touch('pointerdown', 1));
      canvas.dispatchEvent(touch('pointerup', 0));

      const panelText = document.getElementById('voxel-paint-panel')?.textContent ?? '';
      return { panelText };
    });
    // The first box tap banked a corner — proving the touch pointerdown reached
    // the studio handler (not eaten by the suppressor) and a face was hit.
    expect(r.panelText).toContain('opposite corner');
  });

  test('Update code keeps the procedural source and appends edit ops', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`const { voxels } = api;\nconst v = voxels();\nv.fillBox([0,0,0],[2,2,2], '#ffffff');\nreturn v;`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('add');
      const added = pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] });
      const updated = await pw.updateVoxelCode({ label: 'tweaked' });
      const code = pw.getCode();
      const geo = pw.getGeometryData();
      return { added, updated, code, geo };
    });
    expect(r.added.changed).toBe(true);
    expect('error' in r.updated).toBe(false);
    // Procedural source preserved, edits appended — NOT a wholesale decode replace.
    expect(r.code).toContain('fillBox(');
    expect(r.code).toContain('Voxel Studio edits');
    expect(r.code).toMatch(/\.set\(/);
    expect(r.code).not.toContain('voxels.decode(');
    expect(r.geo.isManifold).toBe(true);
  });

  test('keyboard Ctrl/Cmd+Z undoes and Shift+Z redoes while the studio is active', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      await pw.setActiveLanguage('voxel');
      await pw.run(`return api.voxels().set(0,0,0,'#ffffff');`);
      pw.activateVoxelPaint();
      pw.setVoxelTool('add');
      pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] }); // -> 2
      pw.voxelStudioApply({ faceIndex: 0 });                     // -> 3
      const vp: any = await import('/src/color/voxelPaint.ts');
      const start = vp.voxelCount();
      const key = (shift: boolean) => document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'z', ctrlKey: true, metaKey: true, shiftKey: shift, bubbles: true, cancelable: true,
      }));
      key(false); const afterUndo1 = vp.voxelCount();
      key(false); const afterUndo2 = vp.voxelCount();
      key(true);  const afterRedo = vp.voxelCount();
      return { start, afterUndo1, afterUndo2, afterRedo };
    });
    expect(r.start).toBe(3);
    expect(r.afterUndo1).toBe(2);
    expect(r.afterUndo2).toBe(1);
    expect(r.afterRedo).toBe(2);
  });

  test('image-import voxel blob is editable: import → add → bake', async ({ page }) => {
    const r = await page.evaluate(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pw = (window as any).partwright;
      // Build a tiny opaque image as a data URL.
      const cv = document.createElement('canvas');
      cv.width = 4; cv.height = 4;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#33cc55';
      ctx.fillRect(0, 0, 4, 4);
      const url = cv.toDataURL('image/png');

      const imported = await pw.importImageAsVoxels(url, { maxSize: 4, depth: 1, alphaThreshold: 1 });
      const importedCount = imported.voxelCount;
      // The editor now holds voxels.decode(...) — a "blob", but a live grid.
      const codeHasDecode = pw.getCode().includes('voxels.decode(');
      const act = pw.activateVoxelPaint();
      pw.setVoxelTool('add');
      const added = pw.voxelStudioApply({ faceIndex: 0, color: [255, 0, 0] });
      const baked = await pw.bakeVoxelsToCode({ label: 'edited-import' });
      return { importedCount, codeHasDecode, act, added, baked };
    });
    expect(r.codeHasDecode).toBe(true);
    expect(r.act.error).toBeFalsy();
    expect(r.act.voxelCount).toBe(r.importedCount);
    expect(r.added.changed).toBe(true);
    expect(r.added.voxelCount).toBe(r.importedCount + 1);
    expect(r.baked.error).toBeFalsy();
  });
});
