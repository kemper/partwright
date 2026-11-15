import { describe, it, expect } from 'vitest';
import { APP_CONFIG_FIELD_BOUNDS } from '../../src/config/appConfigBounds';
import {
  bandsToSlicerEntries, estimateTopColor, layerBottomZ, layerCount, layerIndexAt, layerOpacity, layerTopZ,
  parseLayerEntriesXml, resolveLayerBands, serializeLayerEntriesXml, slicerEntriesToChanges, startLayerFor,
  LAYER_HEIGHT_MAX_MM, LAYER_HEIGHT_MIN_MM, MAX_LAYER_COLOR_CHANGES, parseLayerColorsSpec, splitBaseColor,
  type SlicerLayerEntry,
} from '../../src/print/layerColors';

const P = { layerHeight: 0.2, firstLayerHeight: 0.2 };
const THICK_FIRST = { layerHeight: 0.2, firstLayerHeight: 0.3 };
const WHITE = '#f0f0f0', RED = '#dc1e1e', BLUE = '#1e50dc';

describe('layer geometry', () => {
  it('places layer boundaries from the first-layer and layer heights', () => {
    expect(layerBottomZ(0, THICK_FIRST)).toBe(0);
    expect(layerTopZ(0, THICK_FIRST)).toBeCloseTo(0.3);
    expect(layerBottomZ(1, THICK_FIRST)).toBeCloseTo(0.3);
    expect(layerTopZ(2, THICK_FIRST)).toBeCloseTo(0.7);
  });

  it('counts whole layers the way the slicer does (24 mm at 0.2 mm = 120)', () => {
    expect(layerCount(24, P)).toBe(120);
    expect(layerCount(0.1, P)).toBe(1);
    expect(layerCount(0, P)).toBe(0);
    expect(layerCount(1.04, THICK_FIRST)).toBe(5); // 0.3 + 3.7 layers of 0.2 → 4 more
    expect(layerCount(0.94, THICK_FIRST)).toBe(4); // 0.3 + 3.2 layers of 0.2 → 3 more
  });

  it('maps a height to its layer, with a boundary belonging to the layer below', () => {
    expect(layerIndexAt(0.05, P)).toBe(0);
    expect(layerIndexAt(0.2, P)).toBe(0);
    expect(layerIndexAt(0.21, P)).toBe(1);
    expect(layerIndexAt(8, P)).toBe(39);     // 7.8-8.0
    expect(layerIndexAt(8.01, P)).toBe(40);  // 8.0-8.2
  });

  it('snaps a requested change height to the nearest layer boundary', () => {
    expect(startLayerFor(0, P)).toBe(0);
    expect(startLayerFor(0.05, P)).toBe(0);
    expect(startLayerFor(0.15, P)).toBe(1);  // nearer 0.2 than 0
    expect(startLayerFor(8, P)).toBe(40);
    expect(startLayerFor(8.09, P)).toBe(40);
    expect(startLayerFor(8.11, P)).toBe(41);
  });
});

describe('resolveLayerBands', () => {
  it('splits the model into bands at the snapped heights', () => {
    const bands = resolveLayerBands(WHITE, [{ z: 16, color: BLUE }, { z: 8, color: RED }], 24, P);
    expect(bands).toEqual([
      { color: WHITE, firstLayer: 0, lastLayer: 39, fromZ: 0, toZ: expect.closeTo(8, 6) },
      { color: RED, firstLayer: 40, lastLayer: 79, fromZ: expect.closeTo(8, 6), toZ: expect.closeTo(16, 6) },
      { color: BLUE, firstLayer: 80, lastLayer: 119, fromZ: expect.closeTo(16, 6), toZ: expect.closeTo(24, 6) },
    ]);
  });

  it('with no changes is one band of the base colour', () => {
    expect(resolveLayerBands('F0F0F0', [], 24, P)).toEqual([{ color: WHITE, firstLayer: 0, lastLayer: 119, fromZ: 0, toZ: expect.closeTo(24, 6) }]);
  });

  it('drops changes above the model, repeats of the current colour, and all but the last on one layer', () => {
    const bands = resolveLayerBands(WHITE, [
      { z: 30, color: BLUE },      // above the 24 mm model
      { z: 4, color: WHITE },      // already printing white
      { z: 8.02, color: BLUE },    // same layer as the next one…
      { z: 8.05, color: RED },     // …which wins
    ], 24, P);
    expect(bands.map((b) => [b.color, b.firstLayer])).toEqual([[WHITE, 0], [RED, 40]]);
  });

  it('a change at height 0 replaces the base colour', () => {
    expect(resolveLayerBands(WHITE, [{ z: 0, color: RED }], 2, P).map((b) => b.color)).toEqual([RED]);
  });

  it('rejects bad input', () => {
    expect(() => resolveLayerBands(WHITE, [{ z: -1, color: RED }], 24, P)).toThrow(/non-negative/);
    expect(() => resolveLayerBands(WHITE, [{ z: 1, color: 'red' }], 24, P)).toThrow(/#rrggbb/);
    expect(() => resolveLayerBands(WHITE, [], 24, { layerHeight: 0, firstLayerHeight: 0.2 })).toThrow(/positive/);
  });
});

describe('parseLayerColorsSpec', () => {
  it('accepts the same layer heights as the Advanced Settings fields', () => {
    const b = APP_CONFIG_FIELD_BOUNDS.renderer;
    expect(b.printLayerHeightMm).toMatchObject({ min: LAYER_HEIGHT_MIN_MM, max: LAYER_HEIGHT_MAX_MM });
    expect(b.printFirstLayerHeightMm).toMatchObject({ min: LAYER_HEIGHT_MIN_MM, max: LAYER_HEIGHT_MAX_MM });
    expect(() => parseLayerColorsSpec([], { layerHeight: LAYER_HEIGHT_MIN_MM / 2 })).toThrow(/between/);
    expect(() => parseLayerColorsSpec([], { firstLayerHeight: LAYER_HEIGHT_MAX_MM * 2 })).toThrow(/between/);
  });

  it('normalises and sorts valid input', () => {
    expect(parseLayerColorsSpec([{ z: 8, color: 'DC1E1E' }, { z: 0, color: '#F0F0F0' }], { layerHeight: 0.16 })).toEqual({
      changes: [{ z: 0, color: WHITE }, { z: 8, color: RED }],
      layerHeight: 0.16,
    });
    expect(parseLayerColorsSpec([])).toEqual({ changes: [] });
  });

  it('rejects bad shapes with a message that names the problem', () => {
    expect(() => parseLayerColorsSpec({ z: 0, color: WHITE })).toThrow(/array/);
    expect(() => parseLayerColorsSpec([[0, WHITE]])).toThrow(/change 0 must be an object/);
    expect(() => parseLayerColorsSpec([{ z: 0, color: WHITE, slot: 2 }])).toThrow(/unknown key "slot"/);
    expect(() => parseLayerColorsSpec([{ z: '8', color: WHITE }])).toThrow(/non-negative number/);
    expect(() => parseLayerColorsSpec([{ z: 8, color: 'red' }])).toThrow(/#rrggbb/);
    expect(() => parseLayerColorsSpec([], { layerHeight: 0 })).toThrow(/layerHeight/);
    expect(() => parseLayerColorsSpec([], { nozzle: 0.4 })).toThrow(/unknown option "nozzle"/);
    expect(() => parseLayerColorsSpec([], [])).toThrow(/options must be an object/);
    expect(() => parseLayerColorsSpec(Array.from({ length: MAX_LAYER_COLOR_CHANGES + 1 }, (_, i) => ({ z: i, color: WHITE })))).toThrow(/at most/);
  });

  it('splits off the base colour: an entry on the bed, else the fallback', () => {
    const spec = parseLayerColorsSpec([{ z: 0, color: WHITE }, { z: 8, color: RED }]);
    expect(splitBaseColor(spec, P, '#d9d9d9')).toEqual({ base: WHITE, changes: [{ z: 8, color: RED }] });
    const noBase = parseLayerColorsSpec([{ z: 8, color: RED }]);
    expect(splitBaseColor(noBase, P, 'D9D9D9')).toEqual({ base: '#d9d9d9', changes: [{ z: 8, color: RED }] });
    // 0.05 mm still snaps to the bed at 0.2 mm layers.
    expect(splitBaseColor(parseLayerColorsSpec([{ z: 0.05, color: BLUE }]), P, '#d9d9d9').base).toBe(BLUE);
  });
});

describe('slicer project file entries', () => {
  const slotOf = (c: string) => ({ [WHITE]: 1, [RED]: 2, [BLUE]: 3 })[c]!;

  it('writes one filament switch per band after the first, at the TOP of its first layer', () => {
    const bands = resolveLayerBands(WHITE, [{ z: 8, color: RED }, { z: 16, color: BLUE }], 24, P);
    // Measured against a real slice: top_z 8.2 makes the 8.0-8.2 layer the first red one.
    expect(bandsToSlicerEntries(bands, P, slotOf)).toEqual([
      { topZ: 8.2, kind: 'filament', slot: 2, color: RED },
      { topZ: 16.2, kind: 'filament', slot: 3, color: BLUE },
    ]);
  });

  it('round-trips entries back to the requested changes', () => {
    const changes = [{ z: 8, color: RED }, { z: 16, color: BLUE }];
    const entries = bandsToSlicerEntries(resolveLayerBands(WHITE, changes, 24, P), P, slotOf);
    expect(slicerEntriesToChanges(entries, P)).toEqual(changes);
  });

  it('serialises per plate in the slicer\'s format and parses it back', () => {
    const plates = new Map<number, SlicerLayerEntry[]>([
      [2, [{ topZ: 16.2, kind: 'filament', slot: 3, color: BLUE }, { topZ: 8.2, kind: 'filament', slot: 2, color: RED }]],
      [1, []],
    ]);
    const xml = serializeLayerEntriesXml(plates);
    expect(xml).toContain('<plate_info id="2"/>');
    expect(xml).not.toContain('<plate_info id="1"/>');
    expect(xml).toContain('<layer top_z="8.2" type="2" extruder="2" color="#DC1E1E" extra="" gcode="tool_change"/>');
    expect(xml).toContain('<mode value="MultiAsSingle"/>');
    expect(xml.indexOf('top_z="8.2"')).toBeLessThan(xml.indexOf('top_z="16.2"')); // sorted by height
    expect(parseLayerEntriesXml(xml)).toEqual(new Map([[2, [
      { topZ: 8.2, kind: 'filament', slot: 2, color: RED },
      { topZ: 16.2, kind: 'filament', slot: 3, color: BLUE },
    ]]]));
  });

  it('writes nothing when no plate has an entry', () => {
    expect(serializeLayerEntriesXml(new Map([[1, []]]))).toBe('');
  });

  it('parses a slicer-written file: skips pauses, reads manual swaps, tolerates 8-digit colours', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<custom_gcodes_per_layer>
<plate>
<plate_info id="1"/>
<layer top_z="2.4" type="1" extruder="1" color="" extra="" gcode="M400 U1"/>
<layer top_z="4" type="0" extruder="1" color="#00AE42FF" extra="" gcode=""/>
<layer top_z="9.6" type="2" extruder="4" color="#FFFFFF" extra="" gcode="tool_change"/>
<mode value="MultiAsSingle"/>
</plate>
</custom_gcodes_per_layer>`;
    expect(parseLayerEntriesXml(xml).get(1)).toEqual([
      { topZ: 4, kind: 'swap', slot: 1, color: '#00ae42' },
      { topZ: 9.6, kind: 'filament', slot: 4, color: '#ffffff' },
    ]);
    expect(parseLayerEntriesXml('<custom_gcodes_per_layer/>').size).toBe(0);
  });
});

describe('estimated blending', () => {
  const opaque = () => 0.01;

  it('one layer is more opaque the shorter the transmission distance', () => {
    expect(layerOpacity(0.2, 0.2)).toBeCloseTo(0.9);
    expect(layerOpacity(0.2, 2)).toBeCloseTo(1 - Math.pow(0.1, 0.1));
    expect(layerOpacity(0.2, 0)).toBe(1);
    expect(layerOpacity(0.2, 0.4)).toBeGreaterThan(layerOpacity(0.2, 4));
  });

  it('opaque filaments show only the top layer\'s colour', () => {
    const bands = resolveLayerBands(WHITE, [{ z: 8, color: RED }], 24, P);
    expect(estimateTopColor(bands, 7.9, P, opaque, 12)).toBe(WHITE);
    expect(estimateTopColor(bands, 8.1, P, opaque, 12)).toBe(RED);
  });

  it('a thin translucent top band lets the colour under it show through', () => {
    // Black base, one 0.2 mm white layer on top of a 1 mm part.
    const bands = resolveLayerBands('#000000', [{ z: 0.8, color: '#ffffff' }], 1, P);
    const tdOf = (c: string) => (c === '#ffffff' ? 2 : 0.1); // white lets light through, black doesn't
    const seen = estimateTopColor(bands, 1, P, tdOf, 12)!;
    const grey = parseInt(seen.slice(1, 3), 16);
    expect(grey).toBeGreaterThan(20);    // not black…
    expect(grey).toBeLessThan(120);      // …and far from white: one thin layer barely covers
    // More white layers on top → closer to white.
    const thicker = resolveLayerBands('#000000', [{ z: 0.2, color: '#ffffff' }], 1, P);
    expect(parseInt(estimateTopColor(thicker, 1, P, tdOf, 12)!.slice(1, 3), 16)).toBeGreaterThan(grey);
  });

  it('stops looking after maxLayers and treats the rest as opaque', () => {
    const bands = resolveLayerBands('#000000', [{ z: 0.2, color: '#ffffff' }], 4, P);
    expect(estimateTopColor(bands, 4, P, () => 100, 1)).toBe('#ffffff');
    expect(estimateTopColor([], 1, P, opaque, 12)).toBeNull();
  });
});
