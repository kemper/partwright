import { describe, it, expect } from 'vitest';
import { meshDiff, deviationColors } from '../../src/geometry/meshDiff';
import type { MeshData } from '../../src/geometry/types';

/** Axis-aligned box [x0,x1]×[y0,y1]×[z0,z1] as 12 triangles, offset by `base` vertices. */
function boxTris(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, base: number) {
  const v = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const f = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7].map(i => i + base);
  return { v, f };
}

/** Two disjoint boxes: "left" (triangles 0-11) and "right" (12-23). */
function twoBoxes(rightTop: number): MeshData {
  const l = boxTris(0, 10, 0, 10, 0, 10, 0);
  const r = boxTris(20, 30, 0, 10, 0, rightTop, 8);
  const vertProperties = new Float32Array([...l.v, ...r.v]);
  const triVerts = new Uint32Array([...l.f, ...r.f]);
  return { vertProperties, triVerts, numVert: 16, numTri: 24, numProp: 3 };
}

const labels = () => new Map<string, Set<number>>([
  ['left', new Set(Array.from({ length: 12 }, (_, i) => i))],
  ['right', new Set(Array.from({ length: 12 }, (_, i) => i + 12))],
]);

describe('meshDiff edit-locality check (#1093)', () => {
  it('identical meshes: nothing moved', () => {
    const { report } = meshDiff(twoBoxes(10), twoBoxes(10), { labelsA: labels(), labelsB: labels() });
    expect(report.maxDisplacement).toBeLessThan(1e-9);
    expect(report.changedBox).toBeNull();
    expect(report.changedFraction).toBe(0);
    expect(report.parts.every(p => !p.changed)).toBe(true);
  });

  it('flags only the part that moved, with its distance and box', () => {
    const { report, perTriB } = meshDiff(twoBoxes(10), twoBoxes(14), { labelsA: labels(), labelsB: labels() });
    expect(report.maxDisplacement).toBeCloseTo(4, 5);
    expect(report.parts.find(p => p.name === 'left')!.changed).toBe(false);
    const right = report.parts.find(p => p.name === 'right')!;
    expect(right.changed).toBe(true);
    expect(right.maxDisplacement).toBeCloseTo(4, 5);
    // Everything that moved sits in the right box.
    expect(report.changedBox!.min[0]).toBeGreaterThanOrEqual(20);
    expect(report.changedFraction).toBeGreaterThan(0);
    expect(report.changedFraction).toBeLessThan(0.5);
    // Heatmap: unmoved triangles are neutral grey, moved ones warm.
    const colors = deviationColors(perTriB, report.tolerance, report.maxDisplacement);
    expect([...colors.slice(0, 3)]).toEqual([170, 172, 178]);
    const top = perTriB.findIndex(d => d > 3.9);
    expect(colors[top * 3]).toBe(235);
  });

  it('reports parts that only exist on one side', () => {
    const a = new Map([['gone', new Set([0])]]);
    const b = new Map([['new', new Set([0])]]);
    const { report } = meshDiff(twoBoxes(10), twoBoxes(10), { labelsA: a, labelsB: b });
    expect(report.parts).toEqual([
      expect.objectContaining({ name: 'gone', in: 'a', changed: true }),
      expect.objectContaining({ name: 'new', in: 'b', changed: true }),
    ]);
  });
});
