import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper used by scripts/slicer-cli.mjs (no .d.ts)
import { buildChecks, parseViews, summarizeFile, summarizeSlicer } from '../../scripts/slicer-cli/report.mjs';

type Check = { name: string; ok: boolean; detail: string };

/** Two boxes as a parse3MF-shaped result: `a` (10×10×10 at z=0, slots 1+2) and
 *  `b` (4×4×2, lifted by `bLift`, slot 3). One triangle per corner fan is
 *  enough: only extents and colours matter here. */
function parsed(bLift = 0) {
  const box = (ox: number, sx: number, sy: number, sz: number, z0: number) => [
    ox, 0, z0, ox + sx, 0, z0, ox, sy, z0, ox + sx, sy, z0 + sz,
  ];
  const verts = [...box(0, 10, 10, 10, 0), ...box(50, 4, 4, 2, bLift)];
  return {
    mesh: { vertProperties: new Float32Array(verts), triVerts: new Uint32Array([0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6]), numVert: 8, numTri: 4, numProp: 3 },
    triColor: new Int32Array([0, 1, 2, 2]),
    palette: [{ hex: '#ffffff', name: 'F1' }, { hex: '#ff0000', name: 'F2' }, { hex: '#0000ff', name: 'F3' }, { hex: '#00ff00', name: 'F4 (unused)' }],
    colorSource: 'filaments',
    flavor: 'bambu',
    objects: [
      { name: 'a', triangleCount: 2, firstTriangle: 0, plate: 1 },
      { name: 'b', triangleCount: 2, firstTriangle: 2, plate: 2 },
    ],
    plates: [{ id: 1, name: 'Plate 1' }, { id: 2, name: 'Plate 2' }],
    skippedParts: 0,
    splitPaintedTriangles: 0,
  };
}

const okLoad = { return_code: 0, error_string: 'Success.' };
function sliceResult(overrides: { bSize?: [number, number, number]; slots?: number[] } = {}) {
  const [w, d, h] = overrides.bSize ?? [4, 4, 2];
  const filaments = (ids: number[]) => ids.map((id) => ({ id, main_used_g: 1.234, total_used_g: 2.5 }));
  const slots = overrides.slots ?? [1, 2, 3];
  return {
    return_code: 0,
    error_string: 'Success.',
    sliced_plates: [
      { id: 1, objects: [{ name: 'a', triangle_count: 2, bbox: { width: 10, depth: 10, height: 10, z: 0 } }], filaments: filaments(slots.filter((s) => s < 3)), filament_change_times: 7, main_predication: 600.4, warning_message: '' },
      { id: 2, objects: [{ name: 'b', triangle_count: 2, bbox: { width: w, depth: d, height: h, z: 0 } }], filaments: filaments(slots.filter((s) => s >= 3)), filament_change_times: 0, main_predication: 120, warning_message: '' },
    ],
  };
}
const failed = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => c.name);

describe('slicer-cli report', () => {
  it('summarises a parsed 3MF: sizes, bed contact and 1-based filament slots', () => {
    const f = summarizeFile(parsed());
    expect(f.objects).toEqual([
      { name: 'a', plate: 1, triangles: 2, size: [10, 10, 10], minZ: 0, filaments: [1, 2] },
      { name: 'b', plate: 2, triangles: 2, size: [4, 4, 2], minZ: 0, filaments: [3] },
    ]);
    expect(f.filaments.map((x: { slot: number; triangles: number }) => [x.slot, x.triangles])).toEqual([[1, 1], [2, 1], [3, 2], [4, 0]]);
    expect(f.uncolouredTriangles).toBe(0);
    expect(f.plates).toEqual([{ id: 1, name: 'Plate 1' }, { id: 2, name: 'Plate 2' }]);
  });

  it('summarises the slicer result and passes when it agrees with the file', () => {
    const s = summarizeSlicer(okLoad, sliceResult());
    expect(s.loaded).toBe(true);
    expect(s.sliced).toBe(true);
    expect(s.plates[0]).toMatchObject({ id: 1, filamentChanges: 7, printSeconds: 600, filaments: [{ slot: 1, grams: 1.23 }, { slot: 2, grams: 1.23 }] });
    const { checks, warnings } = buildChecks(summarizeFile(parsed()), s, { filaments: 3, objects: 2, plates: 2 });
    expect(failed(checks)).toEqual([]);
    expect(checks.map((c: Check) => c.name)).toEqual(['slicer-loads', 'slicer-slices', 'object-count', 'object-sizes', 'objects-on-bed', 'filaments-used', 'expect-filaments', 'expect-objects', 'expect-plates']);
    expect(warnings).toEqual([]);
  });

  it('fails the size check when the slicer sees a different object', () => {
    const { checks } = buildChecks(summarizeFile(parsed()), summarizeSlicer(okLoad, sliceResult({ bSize: [4, 4, 2.5] })));
    expect(failed(checks)).toEqual(['object-sizes']);
    expect(checks.find((c: Check) => c.name === 'object-sizes')!.detail).toContain('"b"');
  });

  it('fails when a painted filament is never extruded (paint lost on the way to the slicer)', () => {
    const { checks } = buildChecks(summarizeFile(parsed()), summarizeSlicer(okLoad, sliceResult({ slots: [1, 3] })), { filaments: 3 });
    expect(failed(checks)).toEqual(['filaments-used', 'expect-filaments']);
  });

  it('flags an object that does not sit on the bed', () => {
    const { checks } = buildChecks(summarizeFile(parsed(5)), summarizeSlicer(okLoad, sliceResult()));
    expect(failed(checks)).toEqual(['objects-on-bed']);
  });

  it('reports a load failure and skips the comparisons', () => {
    const s = summarizeSlicer({ return_code: -6, error_string: 'The input model file to the slicer can not be parsed.' }, null);
    expect(s).toMatchObject({ loaded: false, sliced: null, plates: [] });
    const { checks, warnings } = buildChecks(null, s);
    expect(checks).toEqual([{ name: 'slicer-loads', ok: false, detail: 'The input model file to the slicer can not be parsed. (code -6)' }]);
    expect(warnings.join(' ')).toContain('could not parse');
  });

  it('reports a slice failure after a clean load', () => {
    const s = summarizeSlicer(okLoad, { return_code: -50, error_string: 'Some objects are outside the plate.' });
    const { checks } = buildChecks(summarizeFile(parsed()), s);
    expect(failed(checks)).toEqual(['slicer-slices']);
  });

  it('falls back to the file for expectations when slicing was skipped', () => {
    const { checks } = buildChecks(summarizeFile(parsed()), summarizeSlicer(okLoad, null), { filaments: 3, objects: 2, plates: 2 });
    expect(failed(checks)).toEqual([]);
    expect(checks.find((c: Check) => c.name === 'expect-filaments')!.detail).toContain('not sliced');
  });

  it('surfaces slicer warnings without failing', () => {
    const r = sliceResult();
    r.sliced_plates[0].warning_message = 'Floating cantilever detected.';
    const { checks, warnings } = buildChecks(summarizeFile(parsed()), summarizeSlicer(okLoad, r));
    expect(failed(checks)).toEqual([]);
    expect(warnings).toEqual(['slicer, plate 1: Floating cantilever detected.']);
  });

  it('parses view lists by number or name and rejects unknown views', () => {
    expect(parseViews('0,1,left,iso-2')).toEqual([0, 1, 2, 11]);
    expect(() => parseViews('9')).toThrow(/unknown view/);
    expect(() => parseViews('bottom')).toThrow(/unknown view/);
  });
});
