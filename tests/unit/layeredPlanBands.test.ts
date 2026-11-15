import { describe, it, expect } from 'vitest';
import { layeredPlanPreview } from '../../src/print/layeredPlanBands';
import { computeLadder } from '../../src/relief/layeredPrint/optics';
import type { LayeredPrintPlanRecord } from '../../src/relief/types';

// Black base, white from layer 5 (0-based), red from layer 12. 0.16 first layer, 0.08 after.
const PLAN: LayeredPrintPlanRecord = {
  blocks: [
    { name: 'Black', hex: '#000000', td: 0.6, startLayer: 0 },
    { name: 'White', hex: '#FFFFFF', td: 5, startLayer: 5 },
    { name: 'Red', hex: '#d01e1e', td: 2, startLayer: 12 },
  ],
  layerHeight: 0.08,
  firstLayerHeight: 0.16,
  totalLayers: 20,
  totalHeightMm: 1.68,
  widthMm: 60, depthMm: 40, meanDeltaE: 5,
};

describe('layeredPlanPreview', () => {
  it('turns the swap plan into the bands that print, at the plan\'s layer heights', () => {
    const p = layeredPlanPreview(PLAN, 1.68);
    expect(p.profile).toEqual({ layerHeight: 0.08, firstLayerHeight: 0.16 });
    expect(p.names).toEqual(['Black', 'White', 'Red']);
    expect(p.changes.map((c) => c.color)).toEqual(['#000000', '#ffffff', '#d01e1e']);
    expect(p.changes[0].z).toBe(0);
    // A block starting at layer s starts at the bottom of that layer.
    expect(p.changes[1].z).toBeCloseTo(0.16 + 4 * 0.08, 9);
    expect(p.changes[2].z).toBeCloseTo(0.16 + 11 * 0.08, 9);
    expect(p.bands.map((b) => [b.color, b.firstLayer, b.lastLayer])).toEqual([['#000000', 0, 4], ['#ffffff', 5, 11], ['#d01e1e', 12, 19]]);
  });

  it('a model taller than the plan keeps printing in the last filament', () => {
    const p = layeredPlanPreview(PLAN, 4);
    const last = p.bands[p.bands.length - 1];
    expect(last.color).toBe('#d01e1e');
    expect(last.lastLayer).toBe(p.layers - 1);
    expect(p.layers).toBeGreaterThan(PLAN.totalLayers);
  });

  it('hands over the solver\'s own predicted colour on top of each layer', () => {
    const p = layeredPlanPreview(PLAN, 1.68);
    const ladder = computeLadder(PLAN.blocks.map((b) => ({ filament: { name: b.name, hex: b.hex, td: b.td }, startLayer: b.startLayer })), p.layers, p.profile);
    const hex = (k: number) => '#' + [0, 1, 2].map((i) => Math.round(ladder[k * 3 + i] * 255).toString(16).padStart(2, '0')).join('');
    for (const k of [0, 4, 5, 8, 11, 12, 19]) expect(p.colorOnTopOf(k)).toBe(hex(k));
    // The base is opaque black; one thin white layer over it is a dark grey, not white.
    expect(p.colorOnTopOf(4)).toBe('#000000');
    const grey = parseInt(p.colorOnTopOf(5).slice(1, 3), 16);
    expect(grey).toBeGreaterThan(0);
    expect(grey).toBeLessThan(60);
    // Out-of-range layers clamp.
    expect(p.colorOnTopOf(-3)).toBe(p.colorOnTopOf(0));
    expect(p.colorOnTopOf(999)).toBe(p.colorOnTopOf(p.layers - 1));
  });

  it('copes with short or odd hex colours and unsorted blocks', () => {
    const odd: LayeredPrintPlanRecord = { ...PLAN, blocks: [{ name: 'Top', hex: 'f00', td: 1, startLayer: 6 }, { name: 'Base', hex: 'not-a-colour', td: 1, startLayer: 0 }] };
    const p = layeredPlanPreview(odd, 1.68);
    expect(p.names).toEqual(['Base', 'Top']);
    expect(p.changes.map((c) => c.color)).toEqual(['#808080', '#ff0000']);
  });
});
