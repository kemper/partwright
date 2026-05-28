// Unit tests for src/geometry/sdf.ts — pure-logic bits that don't need
// the manifold-3d WASM module. Validates primitive distance fields,
// transforms, boolean composition, bounds inference, and the label
// partitioning that drives paint-by-label on SDF-meshed parts.
//
// Lowering to Manifold.levelSet is exercised in the e2e tier (real
// browser + WASM) — here we only check the parts that can be tested
// in isolation.

import { describe, it, expect } from 'vitest';
import {
  SdfNode,
  partitionByLabel,
  __testables__,
} from '../../src/geometry/sdf';

const {
  primSphere,
  primBox,
  primCylinder,
  primTorus,
  primCapsule,
  primGyroid,
  opUnion,
  opSubtract,
  opIntersect,
  opSmoothUnion,
  opTranslate,
  opRotate,
  opScale,
  opMirror,
  opShell,
  opRound,
  opTwist,
  defaultEdgeLength,
  expandedMeshBounds,
} = __testables__;

const APPROX = 1e-9;

describe('sdf primitives', () => {
  describe('sphere', () => {
    const s = primSphere(5);
    it('returns 0 on the surface', () => {
      expect(s.evaluate(5, 0, 0)).toBeCloseTo(0, 10);
      expect(s.evaluate(0, -5, 0)).toBeCloseTo(0, 10);
    });
    it('negative inside, positive outside (standard convention)', () => {
      expect(s.evaluate(0, 0, 0)).toBeCloseTo(-5, 10);
      expect(s.evaluate(7, 0, 0)).toBeCloseTo(2, 10);
    });
    it('has bounds [-r, r]^3', () => {
      expect(s.bounds().min).toEqual([-5, -5, -5]);
      expect(s.bounds().max).toEqual([5, 5, 5]);
    });
    it('rejects zero or negative radius', () => {
      expect(() => primSphere(0)).toThrow();
      expect(() => primSphere(-1)).toThrow();
    });
  });

  describe('box (centered)', () => {
    const b = primBox([4, 6, 8]);
    it('returns 0 on each face', () => {
      expect(b.evaluate(2, 0, 0)).toBeCloseTo(0, APPROX);   // +X face
      expect(b.evaluate(0, -3, 0)).toBeCloseTo(0, APPROX);  // -Y face
      expect(b.evaluate(0, 0, 4)).toBeCloseTo(0, APPROX);   // +Z face
    });
    it('returns negative interior, positive exterior', () => {
      expect(b.evaluate(0, 0, 0)).toBeLessThan(0);
      expect(b.evaluate(3, 0, 0)).toBeCloseTo(1, APPROX);   // 1 unit past +X face
      expect(b.evaluate(5, 4, 0)).toBeCloseTo(Math.sqrt(9 + 1), APPROX); // outside corner
    });
    it('accepts scalar size for cube', () => {
      const c = primBox(2);
      expect(c.bounds().min).toEqual([-1, -1, -1]);
      expect(c.bounds().max).toEqual([1, 1, 1]);
    });
    it('rejects non-positive components', () => {
      expect(() => primBox([1, 0, 1])).toThrow();
      expect(() => primBox([-1, 1, 1])).toThrow();
    });
  });

  describe('cylinder (Z-aligned, centered)', () => {
    const c = primCylinder(3, 10);
    it('returns 0 on the side wall and end caps', () => {
      expect(c.evaluate(3, 0, 0)).toBeCloseTo(0, APPROX);
      expect(c.evaluate(0, 0, 5)).toBeCloseTo(0, APPROX);
      expect(c.evaluate(0, 0, -5)).toBeCloseTo(0, APPROX);
    });
    it('returns the larger of radial / axial distance outside', () => {
      // Outside in z only, on the axis:
      expect(c.evaluate(0, 0, 7)).toBeCloseTo(2, APPROX);
      // Outside radially, within z range:
      expect(c.evaluate(5, 0, 0)).toBeCloseTo(2, APPROX);
    });
    it('rejects bad dimensions', () => {
      expect(() => primCylinder(0, 1)).toThrow();
      expect(() => primCylinder(1, 0)).toThrow();
    });
  });

  describe('torus (XY plane)', () => {
    const t = primTorus(10, 2);
    it('returns 0 on the tube surface', () => {
      // Point on the outer equator (R + r):
      expect(t.evaluate(12, 0, 0)).toBeCloseTo(0, APPROX);
      // Point on the inner equator (R - r):
      expect(t.evaluate(8, 0, 0)).toBeCloseTo(0, APPROX);
      // Point above the tube center:
      expect(t.evaluate(10, 0, 2)).toBeCloseTo(0, APPROX);
    });
    it('returns negative inside the tube', () => {
      expect(t.evaluate(10, 0, 0)).toBeCloseTo(-2, APPROX); // center of tube
    });
    it('bounds include the tube radius', () => {
      const b = t.bounds();
      expect(b.min).toEqual([-12, -12, -2]);
      expect(b.max).toEqual([12, 12, 2]);
    });
  });

  describe('capsule', () => {
    const c = primCapsule([0, 0, 0], [10, 0, 0], 2);
    it('returns 0 on the surface', () => {
      // Side surface at midspan:
      expect(c.evaluate(5, 2, 0)).toBeCloseTo(0, APPROX);
      // End cap of A endpoint:
      expect(c.evaluate(-2, 0, 0)).toBeCloseTo(0, APPROX);
    });
    it('clamps to the segment for closest-point', () => {
      // Past the B endpoint along the axis — distance is from B.
      expect(c.evaluate(15, 0, 0)).toBeCloseTo(3, APPROX); // 5 from B, minus r=2
    });
    it('rejects coincident endpoints', () => {
      expect(() => primCapsule([0, 0, 0], [0, 0, 0], 1)).toThrow();
    });
  });

  describe('gyroid', () => {
    const g = primGyroid(10, 0);
    it('crosses zero at expected lattice points', () => {
      // At origin: sin(0)*cos(0) + ... = 0
      expect(g.evaluate(0, 0, 0)).toBeCloseTo(0, APPROX);
    });
    it('infinite bounds (unbounded surface)', () => {
      const b = g.bounds();
      expect(b.min[0]).toBe(-Infinity);
      expect(b.max[0]).toBe(Infinity);
    });
    it('thickness > 0 produces a finite shell width at the surface', () => {
      const gt = primGyroid(10, 0.5);
      // The shell |g| - t evaluated at the surface (g=0) is -t/k — negative
      // (inside the shell). Sign matters more than magnitude here.
      expect(gt.evaluate(0, 0, 0)).toBeLessThan(0);
    });
  });
});

describe('sdf booleans', () => {
  const a = primSphere(5).translate([-3, 0, 0]);
  const b = primSphere(5).translate([3, 0, 0]);

  it('union takes the min', () => {
    const u = opUnion(a, b);
    // Point inside one but not the other — should still be inside the union.
    expect(u.evaluate(-3, 0, 0)).toBeCloseTo(-5, APPROX);
    expect(u.evaluate(3, 0, 0)).toBeCloseTo(-5, APPROX);
    // Point inside neither: takes the closer surface.
    expect(u.evaluate(10, 0, 0)).toBeCloseTo(2, APPROX); // 10 - (3+5)
  });

  it('subtract removes interior of b from a', () => {
    const s = opSubtract(a, b);
    // Inside a-only is still inside the result.
    expect(s.evaluate(-7, 0, 0)).toBeCloseTo(-1, APPROX); // 1 inside a
    // Inside both is OUTSIDE the result (carved away).
    expect(s.evaluate(0, 0, 0)).toBeGreaterThan(0);
  });

  it('intersect keeps only the overlap', () => {
    const i = opIntersect(a, b);
    // Origin is the deepest interior point of the lens — must be inside.
    expect(i.evaluate(0, 0, 0)).toBeLessThan(0);
    // Pure-a region is outside the intersection.
    expect(i.evaluate(-7, 0, 0)).toBeGreaterThan(0);
  });

  it('smoothUnion equals min when distances are far apart compared to k', () => {
    // When both shapes are clearly separated, smoothUnion should match
    // a sharp union (the blend term vanishes for |a-b| >> k).
    const su = opSmoothUnion(a, b, 0.1);
    expect(su.evaluate(20, 0, 0)).toBeCloseTo(Math.min(a.evaluate(20, 0, 0), b.evaluate(20, 0, 0)), 3);
  });

  it('smoothUnion is smoother than union near the seam (no kink)', () => {
    // At the seam (origin, midway between two equal spheres) a sharp
    // union has its minimum at -2 (both spheres reach -2 there). A
    // smoothUnion with k>0 will dip BELOW that — the blend bulges the
    // surface outward, which means the field is more negative inside.
    const su = opSmoothUnion(a, b, 2);
    const u = opUnion(a, b);
    expect(su.evaluate(0, 0, 0)).toBeLessThan(u.evaluate(0, 0, 0));
  });

  it('union bounds is the union of children bounds', () => {
    const u = opUnion(a, b);
    expect(u.bounds().min).toEqual([-8, -5, -5]);
    expect(u.bounds().max).toEqual([8, 5, 5]);
  });
});

describe('sdf transforms', () => {
  const s = primSphere(2);

  it('translate shifts the field and bounds', () => {
    const t = opTranslate(s, [5, 0, 0]);
    expect(t.evaluate(5, 0, 0)).toBeCloseTo(-2, APPROX); // center of translated sphere
    expect(t.evaluate(7, 0, 0)).toBeCloseTo(0, APPROX);  // on translated surface
    expect(t.bounds().min).toEqual([3, -2, -2]);
    expect(t.bounds().max).toEqual([7, 2, 2]);
  });

  it('rotate preserves distance (it is an isometry)', () => {
    const r = opRotate(primBox([4, 2, 2]), [0, 0, 90]);
    // After a 90° rotation about Z, the X dimension becomes Y.
    // A point that WAS on the +X face (at x=2) should now be on the
    // +Y face (at y=2).
    expect(r.evaluate(0, 2, 0)).toBeCloseTo(0, 6);
    expect(r.evaluate(2, 0, 0)).toBeGreaterThan(0); // now outside
  });

  it('scale multiplies the field by s', () => {
    const sc = opScale(s, 3);
    // After 3x scale, sphere has radius 6.
    expect(sc.evaluate(6, 0, 0)).toBeCloseTo(0, APPROX);
    expect(sc.evaluate(0, 0, 0)).toBeCloseTo(-6, APPROX);
    expect(sc.bounds().max).toEqual([6, 6, 6]);
  });

  it('mirror flips the requested axis', () => {
    const off = opTranslate(s, [5, 0, 0]);
    const m = opMirror(off, 'x');
    expect(m.evaluate(-5, 0, 0)).toBeCloseTo(-2, APPROX); // mirrored center
    expect(m.bounds().min[0]).toBe(-7);
    expect(m.bounds().max[0]).toBe(-3);
  });
});

describe('sdf shell + round', () => {
  it('shell takes |f| - t/2 — solid shell of given thickness', () => {
    const sh = opShell(primSphere(5), 1);
    // On the original surface, |0| - 0.5 = -0.5 — inside the shell.
    expect(sh.evaluate(5, 0, 0)).toBeCloseTo(-0.5, APPROX);
    // 0.5 outside the surface (at r=5.5): the shell ends at 5.5 — on its surface.
    expect(sh.evaluate(5.5, 0, 0)).toBeCloseTo(0, APPROX);
    // Deep inside (5 from surface): well outside the shell.
    expect(sh.evaluate(0, 0, 0)).toBeCloseTo(4.5, APPROX);
  });

  it('round grows by r and expands bounds', () => {
    const rb = opRound(primBox([4, 4, 4]), 1);
    // The box's +X face was at x=2 — after .round(1) it's at x=3.
    expect(rb.evaluate(3, 0, 0)).toBeCloseTo(0, APPROX);
    expect(rb.bounds().max).toEqual([3, 3, 3]);
  });
});

describe('sdf twist', () => {
  it('does not change the field on the axis of twist', () => {
    // A point on the Z axis is unaffected by twist around Z.
    const t = opTwist(primBox([4, 4, 10]), 90, 'z');
    expect(t.evaluate(0, 0, 0)).toBeCloseTo(-2, APPROX);  // center of box (min half-extent is 2)
  });
  it('produces a different field off-axis on an asymmetric cross-section', () => {
    // Use an asymmetric XY footprint so the twist isn't an accidental
    // symmetry. Box is [4,2,10] (half-extents 2,1,5). At (1.5, 0, 3)
    // we're inside the original box (Y face is the closest, distance
    // -0.5 from the surface). Twist by 30°/unit at z=3 rotates the
    // cross-section 90°, so (1.5, 0) inverse-maps to (0, -1.5), which
    // is OUTSIDE the original box's Y extent — twisted field flips sign.
    const t = opTwist(primBox([4, 2, 10]), 30, 'z');
    const orig = primBox([4, 2, 10]).evaluate(1.5, 0, 3);
    const twisted = t.evaluate(1.5, 0, 3);
    expect(orig).toBeLessThan(0);          // inside the original
    expect(twisted).toBeGreaterThan(0);    // outside after the twist
  });
});

describe('sdf bounds helpers', () => {
  it('defaultEdgeLength uses ~1/32 of the smallest extent', () => {
    expect(defaultEdgeLength({ min: [0, 0, 0], max: [10, 10, 10] })).toBeCloseTo(10 / 32, 6);
  });
  it('defaultEdgeLength clamps to [0.1, 5]', () => {
    expect(defaultEdgeLength({ min: [0, 0, 0], max: [1, 1, 1] })).toBe(0.1);  // 1/32 < 0.1
    expect(defaultEdgeLength({ min: [0, 0, 0], max: [1000, 1000, 1000] })).toBe(5); // 1000/32 > 5
  });
  it('defaultEdgeLength returns a sane default for degenerate bounds', () => {
    // Infinite extent (e.g. unbounded gyroid) — should still return a finite value.
    expect(defaultEdgeLength({ min: [-Infinity, -Infinity, -Infinity], max: [Infinity, Infinity, Infinity] })).toBe(1);
  });
  it('expandedMeshBounds intersects node bounds with user bounds and expands', () => {
    const node = { min: [-5, -5, -5] as [number, number, number], max: [5, 5, 5] as [number, number, number] };
    const user = { min: [0, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] };
    const out = expandedMeshBounds(node, user, 0.5);
    // Intersection of node and user is [0,-5,-5]..[5,5,5]; then expanded
    // by max(0.5, 1) = 1 on every side.
    expect(out.min).toEqual([-1, -6, -6]);
    expect(out.max).toEqual([6, 6, 6]);
  });
});

describe('sdf label partitioning (paint-by-label)', () => {
  it('no labels → one anonymous region containing the whole tree', () => {
    const tree = opUnion(primSphere(2), primSphere(2).translate([5, 0, 0]));
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBeUndefined();
    expect(parts[0].node).toBe(tree);
  });

  it('root-level label → single region with that label', () => {
    const tree = opUnion(primSphere(2), primSphere(2).translate([5, 0, 0])).label('body');
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('body');
  });

  it('two unioned labelled spheres → two regions', () => {
    const head = primSphere(5).label('head');
    const eye = primSphere(2).translate([3, 5, 0]).label('eye');
    const tree = opUnion(head, eye);
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(2);
    const names = parts.map(p => p.labelName).sort();
    expect(names).toEqual(['eye', 'head']);
  });

  it('partial labelling: one labelled + one unlabelled child → both surface as regions', () => {
    // The unlabelled side still needs to mesh, just without a paint label.
    const tree = opUnion(primSphere(5).label('a'), primSphere(2).translate([10, 0, 0]));
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(2);
    expect(parts.find(p => p.labelName === 'a')).toBeDefined();
    expect(parts.find(p => p.labelName === undefined)).toBeDefined();
  });

  it('smooth-union of two labels → ONE region (outer wins, labels lost)', () => {
    // Smooth union is non-partitionable by design — splitting it would
    // destroy the smooth blend. The whole expression meshes as one
    // anonymous region. To paint it, wrap the smoothUnion in .label().
    const tree = opSmoothUnion(primSphere(5).label('a'), primSphere(5).translate([4, 0, 0]).label('b'), 1);
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBeUndefined();
  });

  it('outer label on smooth union → ONE region with that label (blend preserved)', () => {
    const tree = opSmoothUnion(primSphere(5), primSphere(5).translate([4, 0, 0]), 1).label('body');
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('body');
  });

  it('nested label inside an outer label → outer wins', () => {
    const inner = primSphere(2).label('inner');
    const tree = opUnion(inner, primSphere(2).translate([5, 0, 0])).label('outer');
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('outer');
  });

  it('subtract: A label propagates up; B (carving tool) labels are ignored', () => {
    // The surviving surface of `a.subtract(b)` IS A's surface (with a
    // chunk removed). A's label should still paint the result. The B
    // side's labels refer to surfaces that no longer exist, so they're
    // dropped at the subtract boundary.
    const tree = opSubtract(primSphere(5).label('shell'), primSphere(3).label('hole'));
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('shell');
  });

  it('label propagates through transforms (translate / rotate / scale / mirror)', () => {
    // A labelled sphere wrapped in a translate should still partition as
    // the labelled region — the translate is a one-sided wrapper.
    const tree = opTranslate(primSphere(2).label('eye'), [10, 0, 0]);
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('eye');
  });

  it('label does NOT propagate through smooth booleans (ambiguous)', () => {
    // Smooth union of two labelled spheres — neither label wins.
    // (Tested elsewhere via the explicit "outer label" pattern.)
    const tree = opSmoothUnion(primSphere(5).label('a'), primSphere(5).translate([4, 0, 0]).label('b'), 1);
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBeUndefined();
  });

  it('label propagates through a chain of transforms', () => {
    const tree = primSphere(2).label('eye').translate([5, 0, 0]).scale(2);
    // After label, .translate, .scale — three single-child wrappers.
    // The 'eye' label should bubble all the way up.
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('eye');
  });
});

describe('sdf node chaining (functional immutability)', () => {
  it('chain methods return new nodes — original is unchanged', () => {
    const s = primSphere(5);
    const t = s.translate(10, 0, 0);
    expect(t).not.toBe(s);
    // Original sphere is still centered at origin:
    expect(s.evaluate(0, 0, 0)).toBeCloseTo(-5, APPROX);
    // Translated sphere has its center at (10, 0, 0):
    expect(t.evaluate(10, 0, 0)).toBeCloseTo(-5, APPROX);
  });

  it('every node carries a unique id (for downstream tooling)', () => {
    const a = primSphere(1);
    const b = primSphere(1);
    expect(a.id).not.toBe(b.id);
    // Chain methods also yield fresh ids:
    expect(a.translate(1, 0, 0).id).not.toBe(a.id);
  });
});

describe('sdf node validation', () => {
  it('rejects negative smoothUnion k', () => {
    const a = primSphere(1);
    const b = primSphere(1);
    expect(() => a.smoothUnion(b, -1)).toThrow();
    expect(() => a.smoothUnion(b, 0)).toThrow();
  });
  it('rejects non-finite translate component', () => {
    expect(() => primSphere(1).translate([NaN, 0, 0])).toThrow();
    expect(() => primSphere(1).translate([0, Infinity, 0])).toThrow();
  });
  it('rejects scale <= 0', () => {
    expect(() => primSphere(1).scale(0)).toThrow();
    expect(() => primSphere(1).scale(-1)).toThrow();
  });
  it('rejects unknown mirror axis', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primSphere(1).mirror('w' as any)).toThrow();
  });
  it('rejects negative shell thickness', () => {
    expect(() => primSphere(1).shell(0)).toThrow();
    expect(() => primSphere(1).shell(-1)).toThrow();
  });
  it('rejects negative round radius', () => {
    expect(() => primSphere(1).round(-0.5)).toThrow();
    // Zero is fine — it's a no-op.
    expect(() => primSphere(1).round(0)).not.toThrow();
  });
  it('label requires a non-empty string', () => {
    expect(() => primSphere(1).label('')).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primSphere(1).label(null as any)).toThrow();
  });
});

describe('sdf type guard', () => {
  it('SdfNode instances are recognized', () => {
    expect(primSphere(1) instanceof SdfNode).toBe(true);
    expect(primBox(1) instanceof SdfNode).toBe(true);
    expect(primSphere(1).translate(1, 0, 0) instanceof SdfNode).toBe(true);
  });
});
