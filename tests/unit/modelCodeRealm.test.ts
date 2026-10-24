import { describe, it, expect, afterEach } from 'vitest';
import { voxelEngine, runVoxelGrid } from '../../src/geometry/engines/voxel';
import { manifoldJsEngine } from '../../src/geometry/engines/manifoldJs';
import { runReplicadAsync } from '../../src/geometry/engines/replicad';
import { VoxelGrid } from '../../src/geometry/voxel/grid';
import * as engine from '../../src/geometry/engine';

// #1090: model code may only be evaluated inside the sandboxed engine Worker.
// Every engine entry point that runs model code refuses in a document realm
// (the main thread), and the old synchronous main-thread `executeCode` is gone.
// Validation stays compile-only.

describe('model code never runs on the main thread', () => {
  const g = globalThis as { document?: unknown };
  afterEach(() => { delete g.document; });

  it('engine run entry points throw when a document is present', async () => {
    g.document = {};
    const code = 'globalThis.__ran = true; return api.voxels().set(0, 0, 0, "#fff");';
    expect(() => voxelEngine.run(code)).toThrow(/engine Worker/);
    expect(() => runVoxelGrid(code)).toThrow(/engine Worker/);
    expect(() => manifoldJsEngine.run(code)).toThrow(/engine Worker/);
    await expect(runReplicadAsync(code)).rejects.toThrow(/engine Worker/);
    expect((globalThis as { __ran?: unknown }).__ran).toBeUndefined();
  });

  it('validate stays compile-only (never invokes the code)', () => {
    g.document = {};
    const code = 'globalThis.__validated = true; return api.voxels();';
    expect(voxelEngine.validate(code).valid).toBe(true);
    expect(manifoldJsEngine.validate(code).valid).toBe(true);
    expect((globalThis as { __validated?: unknown }).__validated).toBeUndefined();
  });

  it('the synchronous main-thread executeCode entry point no longer exists', () => {
    expect((engine as Record<string, unknown>).executeCode).toBeUndefined();
    expect(typeof engine.executeCodeAsync).toBe('function');
    expect(typeof engine.runVoxelGridInWorker).toBe('function');
  });

  it('still runs outside a document realm (Worker / Node CLI)', () => {
    const r = voxelEngine.run('return api.voxels().set(0, 0, 0, "#fff");');
    expect(r.error).toBeNull();
    expect(r.voxelGrid).toBeTruthy();
  });
});

describe('VoxelGrid transfer', () => {
  it('round-trips cells and surfacing', () => {
    const grid = new VoxelGrid().fillBox([0, 0, 0], [2, 1, 0], '#336699').set(-5, 7, 3, '#ff0000');
    grid.smooth({ iterations: 3, strength: 0.5, flatBottom: true, lockBox: [[0, 0, 0], [1, 1, 0]] });
    const back = VoxelGrid.fromTransfer(grid.toTransfer());
    expect(back.size).toBe(grid.size);
    expect(back.get(-5, 7, 3)).toEqual(grid.get(-5, 7, 3));
    expect(back.surfacing()).toEqual(grid.surfacing());
  });

  it('rejects malformed transfer data from an untrusted Worker', () => {
    const ok = new VoxelGrid().set(0, 0, 0, '#fff').toTransfer();
    expect(() => VoxelGrid.fromTransfer(null)).toThrow();
    expect(() => VoxelGrid.fromTransfer({ ...ok, keys: [0] })).toThrow();
    expect(() => VoxelGrid.fromTransfer({ ...ok, keys: new Float64Array([-1]) })).toThrow(/out of range/);
    expect(() => VoxelGrid.fromTransfer({ ...ok, keys: new Float64Array([0.5]) })).toThrow(/out of range/);
    expect(() => VoxelGrid.fromTransfer({ ...ok, colors: new Uint32Array([0x1000000]) })).toThrow(/colour/);
    expect(() => VoxelGrid.fromTransfer({ ...ok, surfacing: { mode: 'evil' } })).toThrow(/surfacing/);
    expect(() => VoxelGrid.fromTransfer({ ...ok, surfacing: { mode: 'smooth', iterations: 999, detail: 1 } })).toThrow();
  });
});
