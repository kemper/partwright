import { describe, it, expect } from 'vitest';
import { creaseEdgeSegments } from '../../src/renderer/creaseEdges';

/** Quad (a,b,c,d) as two triangles appended to `tris` (xyz soup). */
function quad(tris: number[], a: number[], b: number[], c: number[], d: number[]): void {
  tris.push(...a, ...b, ...c, ...a, ...c, ...d);
}
const segments = (soup: number[], minStep: number) => creaseEdgeSegments(Float32Array.from(soup), null, 30, minStep).length / 6;

/** A ledge strip along y: upper face (z=1, x∈[-1,0]), wall at x=0 down to
 *  z=1-h, lower face (z=1-h, x∈[0,1]). */
function ledge(h: number): number[] {
  const s: number[] = [];
  quad(s, [-1, 0, 1], [0, 0, 1], [0, 1, 1], [-1, 1, 1]);
  quad(s, [0, 0, 1], [0, 0, 1 - h], [0, 1, 1 - h], [0, 1, 1]);
  quad(s, [0, 0, 1 - h], [1, 0, 1 - h], [1, 1, 1 - h], [0, 1, 1 - h]);
  return s;
}

describe('crease edges without micro-steps (#1112)', () => {
  it('a cube shows its 12 edges (diagonals are coplanar)', () => {
    const s: number[] = [];
    const c = (x: number, y: number, z: number) => [x, y, z];
    quad(s, c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0));
    quad(s, c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1));
    quad(s, c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1));
    quad(s, c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0));
    quad(s, c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0));
    quad(s, c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1));
    expect(segments(s, 0)).toBe(12);
    expect(segments(s, 0.05)).toBe(12); // a real corner is never a step
  });

  it('drops the two lip lines of a hairline step, keeps a real one', () => {
    const open = (h: number, minStep: number) => segments(ledge(h), minStep);
    // Open strip: boundary edges + the two lips.
    expect(open(0.01, 0) - open(0.01, 0.05)).toBe(2);
    // A 0.2-deep step is deeper than minStep: both lips stay.
    expect(open(0.2, 0.05)).toBe(open(0.2, 0));
  });

  it('keeps the rim of a curved wall beside a sliver floor triangle', () => {
    // Two facets of a faceted pocket wall, 10° apart, standing on a sliver
    // floor triangle: the facets are near-parallel across a thin face, but
    // on the same side of it — not a step.
    const at = (deg: number, z: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), z];
    const s: number[] = [];
    quad(s, at(-10, 0), at(0, 0), at(0, 1), at(-10, 1));
    quad(s, at(0, 0), at(10, 0), at(10, 1), at(0, 1));
    s.push(...at(-10, 0), ...at(10, 0), ...at(0, 0));
    expect(segments(s, 0.05)).toBe(segments(s, 0));
  });
});
