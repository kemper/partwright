import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildTriColors,
  addRegion,
  clearRegions,
  setModelColorRegions,
  clearModelColorRegions,
  hasModelColorRegions,
  getModelRegions,
  serialize,
  getRegions,
} from '../../src/color/regions';

// regions.ts is a singleton module store with no browser/WASM deps, so the
// pure compositing logic in buildTriColors can be exercised in the node tier.
// This locks in the model-declared-color layering contract: model colors are a
// derived underlay that renders/exports but never serializes, and manual paint
// always wins on overlap.

const painted = (buf: Uint8Array) =>
  (buf as Uint8Array & { _painted?: Uint8Array })._painted!;
const rgbAt = (buf: Uint8Array, t: number): [number, number, number] => [
  buf[t * 3],
  buf[t * 3 + 1],
  buf[t * 3 + 2],
];

describe('model-declared color compositing (buildTriColors)', () => {
  beforeEach(() => {
    clearRegions();
    clearModelColorRegions();
  });

  it('returns null when there are no regions at all', () => {
    expect(buildTriColors(4)).toBeNull();
  });

  it('renders a model-only underlay and marks its triangles painted', () => {
    setModelColorRegions([{ name: 'body', color: [1, 0, 0], triangles: new Set([0, 1]) }]);
    expect(hasModelColorRegions()).toBe(true);

    const buf = buildTriColors(3)!;
    expect(buf).not.toBeNull();
    expect(rgbAt(buf, 0)).toEqual([255, 0, 0]);
    expect(rgbAt(buf, 1)).toEqual([255, 0, 0]);
    // Triangle 2 was untouched — must read as unpainted so the renderer shows
    // the default material, not black.
    expect(painted(buf)[0]).toBe(1);
    expect(painted(buf)[1]).toBe(1);
    expect(painted(buf)[2]).toBe(0);
  });

  it('lets manual paint override the model color on overlapping triangles', () => {
    setModelColorRegions([{ name: 'body', color: [1, 0, 0], triangles: new Set([0, 1]) }]);
    // User paints triangle 1 blue — should win over the model's red there,
    // while triangle 0 keeps the model color.
    addRegion('accent', [0, 0, 1], 'paintbrush', { kind: 'triangles', ids: [1] }, new Set([1]));

    const buf = buildTriColors(3)!;
    expect(rgbAt(buf, 0)).toEqual([255, 0, 0]); // model red, no paint over it
    expect(rgbAt(buf, 1)).toEqual([0, 0, 255]); // user paint (0..1 → 0..255) wins
  });

  it('keeps model colors out of the serialized (persisted) paint sidecar', () => {
    setModelColorRegions([{ name: 'body', color: [1, 0, 0], triangles: new Set([0]) }]);
    addRegion('accent', [0, 0, 1], 'paintbrush', { kind: 'triangles', ids: [1] }, new Set([1]));

    // Only the user region serializes; the model underlay is derived from code.
    const serialized = serialize();
    expect(serialized).toHaveLength(1);
    expect(serialized[0].name).toBe('accent');
    expect(serialized.some((r) => r.source === 'model')).toBe(false);

    // ...and the model layer is invisible to the user-facing region list.
    expect(getRegions()).toHaveLength(1);
    expect(getModelRegions()).toHaveLength(1);
  });

  it('round-trips a 0..255 color byte through a region back to the same byte', () => {
    // Guards the surface-modifier color carry (main.ts buildCarriedColorRegions):
    // it reads 0..255 bytes off the baked mesh and must store region.color in
    // 0..1, so a region built from byte B renders back to byte B — no
    // 256's-complement inversion, and stable across repeated apply cycles.
    const bytes: [number, number, number] = [204, 51, 26];
    addRegion('carried', [bytes[0] / 255, bytes[1] / 255, bytes[2] / 255], 'face-pick', { kind: 'triangles', ids: [0] }, new Set([0]));
    const buf = buildTriColors(1)!;
    expect(rgbAt(buf, 0)).toEqual(bytes);
  });

  it('replaces the whole model layer on each set, and clears on []', () => {
    setModelColorRegions([{ name: 'a', color: [1, 0, 0], triangles: new Set([0]) }]);
    setModelColorRegions([{ name: 'b', color: [0, 1, 0], triangles: new Set([1]) }]);
    expect(getModelRegions().map((r) => r.name)).toEqual(['b']);

    setModelColorRegions([]);
    expect(hasModelColorRegions()).toBe(false);
    expect(buildTriColors(3)).toBeNull();
  });
});
