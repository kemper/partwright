import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../src/geometry/voxel/grid';
import { diffGrids, editOpCount, formatEditOps, appendVoxelEditsToCode, formatSurfacingCall } from '../../src/geometry/voxel/editCodegen';

describe('diffGrids', () => {
  it('captures added, recolored, and removed cells', () => {
    const before = new VoxelGrid();
    before.set(0, 0, 0, '#ffffff');
    before.set(1, 0, 0, '#ffffff');
    const after = before.clone();
    after.set(0, 0, 0, '#ff0000'); // recolor
    after.set(2, 0, 0, '#00ff00'); // add
    after.remove(1, 0, 0);         // remove
    const ops = diffGrids(before, after);
    expect(ops.set).toContainEqual([0, 0, 0, 0xff0000]);
    expect(ops.set).toContainEqual([2, 0, 0, 0x00ff00]);
    expect(ops.set).toHaveLength(2);
    expect(ops.remove).toEqual([[1, 0, 0]]);
    expect(editOpCount(ops)).toBe(3);
  });

  it('is empty when nothing changed', () => {
    const g = new VoxelGrid();
    g.fillBox([0, 0, 0], [2, 2, 2], '#abcdef');
    expect(editOpCount(diffGrids(g, g.clone()))).toBe(0);
  });
});

describe('formatEditOps', () => {
  it('emits set/remove statements with hex colors', () => {
    const src = formatEditOps({ set: [[1, 2, 3, 0xff8800]], remove: [[4, 5, 6]] }, 'v');
    expect(src).toContain("v.set(1, 2, 3, '#ff8800');");
    expect(src).toContain('v.remove(4, 5, 6);');
  });
});

describe('formatSurfacingCall', () => {
  const surf = (over: Partial<ReturnType<VoxelGrid['surfacing']>> = {}) =>
    ({ mode: 'smooth', algorithm: 'surfaceNets', iterations: 2, detail: 1, strength: 1, ...over }) as ReturnType<VoxelGrid['surfacing']>;

  it('emits an empty call for default smooth', () => {
    expect(formatSurfacingCall(surf())).toBe('.smooth()');
  });

  it('emits only non-default options', () => {
    expect(formatSurfacingCall(surf({ strength: 0.5, baseLayers: 2, flatBottom: true })))
      .toBe('.smooth({ strength: 0.5, flatBottom: true, baseLayers: 2 })');
    expect(formatSurfacingCall(surf({ algorithm: 'taubin', iterations: 4, detail: 2 })))
      .toBe(".smooth({ algorithm: 'taubin', iterations: 4, detail: 2 })");
  });

  it('blocky surfacing emits nothing unless explicit', () => {
    const blocks = { mode: 'blocks', iterations: 2, detail: 1 } as ReturnType<VoxelGrid['surfacing']>;
    expect(formatSurfacingCall(blocks)).toBe('');
    expect(formatSurfacingCall(blocks, true)).toBe('.blocky()');
  });

  it('round-trips through smooth(): emitted opts reproduce the surfacing', () => {
    const g = new VoxelGrid().fillBox([0, 0, 0], [3, 3, 3], '#888').smooth({ strength: 0.4, baseLayers: 2, flatBottom: true });
    const call = formatSurfacingCall(g.surfacing());
    const g2 = new VoxelGrid().fillBox([0, 0, 0], [3, 3, 3], '#888');
    // eslint-disable-next-line no-eval
    (new Function('g', `g${call}`))(g2);
    expect(g2.surfacing()).toEqual(g.surfacing());
  });
});

describe('appendVoxelEditsToCode', () => {
  const ops = { set: [[1, 0, 0, 0xff0000]] as [number, number, number, number][], remove: [[2, 0, 0]] as [number, number, number][] };

  it('wraps the final return and appends the ops', () => {
    const code = `const { voxels } = api;\nconst v = voxels();\nv.fillBox([0,0,0],[3,3,3],'#888');\nreturn v;`;
    const out = appendVoxelEditsToCode(code, ops)!;
    expect(out).toContain('const __voxStudio = v;');
    expect(out).toContain("__voxStudio.set(1, 0, 0, '#ff0000');");
    expect(out).toContain('__voxStudio.remove(2, 0, 0);');
    expect(out.trimEnd().endsWith('return __voxStudio;')).toBe(true);
    // The original procedural line is preserved.
    expect(out).toContain("v.fillBox([0,0,0],[3,3,3],'#888');");
  });

  it('handles a returned expression (no bare variable)', () => {
    const code = `return api.voxels().fillBox([0,0,0],[2,2,2],'#fff');`;
    const out = appendVoxelEditsToCode(code, ops)!;
    expect(out).toContain("const __voxStudio = api.voxels().fillBox([0,0,0],[2,2,2],'#fff');");
    expect(out).toContain("__voxStudio.set(1, 0, 0, '#ff0000');");
    expect(out.trimEnd().endsWith('return __voxStudio;')).toBe(true);
  });

  it('returns the code unchanged for an empty delta', () => {
    const code = `return api.voxels().set(0,0,0,'#fff');`;
    expect(appendVoxelEditsToCode(code, { set: [], remove: [] })).toBe(code);
  });

  it('returns null when there is no trailing return to hook onto', () => {
    expect(appendVoxelEditsToCode(`const v = api.voxels(); v.set(0,0,0,'#fff');`, ops)).toBeNull();
  });

  it('appends a surfacing call after the edits', () => {
    const code = `const v = api.voxels();\nv.fillBox([0,0,0],[3,3,3],'#888');\nreturn v;`;
    const out = appendVoxelEditsToCode(code, ops, '.smooth({ strength: 0.5, baseLayers: 2 })')!;
    expect(out).toContain('__voxStudio.smooth({ strength: 0.5, baseLayers: 2 });');
    // Surfacing comes after the edit ops, before the return.
    expect(out.indexOf("__voxStudio.set(1, 0, 0, '#ff0000');")).toBeLessThan(out.indexOf('__voxStudio.smooth('));
    expect(out.trimEnd().endsWith('return __voxStudio;')).toBe(true);
  });

  it('applies a surfacing-only change even with no edit ops', () => {
    const code = `return api.voxels().sphere([0,0,0],4,'#e7b');`;
    const out = appendVoxelEditsToCode(code, { set: [], remove: [] }, '.blocky()')!;
    expect(out).toContain('__voxStudio.blocky();');
    expect(out).not.toContain('Voxel Studio edits'); // no edit-op block when there are none
    expect(out.trimEnd().endsWith('return __voxStudio;')).toBe(true);
  });

  it('round-trips: appended code reproduces the edited grid', () => {
    // Baseline procedural grid.
    const before = new VoxelGrid();
    before.fillBox([0, 0, 0], [2, 2, 2], '#ffffff');
    const after = before.clone();
    after.set(0, 0, 0, '#ff0000');
    after.remove(2, 2, 2);
    after.set(5, 5, 5, '#00ff00');
    const delta = diffGrids(before, after);

    const code = `const { voxels } = api;\nconst v = voxels();\nv.fillBox([0,0,0],[2,2,2],'#ffffff');\nreturn v;`;
    const updated = appendVoxelEditsToCode(code, delta)!;
    // Execute the updated code the same way the engine does.
    const api = { voxels: Object.assign(() => new VoxelGrid(), { decode: () => new VoxelGrid(), color: () => 0 }) };
    const fn = new Function('api', `"use strict";\n${updated}`);
    const result = fn(api) as VoxelGrid;
    expect(result.size).toBe(after.size);
    expect(result.get(0, 0, 0)).toBe(0xff0000);
    expect(result.has(2, 2, 2)).toBe(false);
    expect(result.get(5, 5, 5)).toBe(0x00ff00);
  });
});
