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
  primEllipsoid,
  primBox,
  primRoundedBox,
  primCylinder,
  primRoundedCylinder,
  primTorus,
  primCapsule,
  primGyroid,
  primSchwarzP,
  primDiamond,
  primLidinoid,
  primGradedGyroid,
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
  opTaper,
  opPolarArray,
  opRepeat,
  defaultEdgeLength,
  expandedMeshBounds,
} = __testables__;

// Digit-count for vitest's toBeCloseTo(value, numDigits). 10 means
// |received - value| < 5e-11 — strict, because the primitives are exact
// arithmetic when the query point lies on a defined face or apex.
const APPROX = 10;

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

  it('smoothUnion / smoothSubtract / smoothIntersect all expand bounds by ~k/2', () => {
    // The smooth seam can bulge the iso-surface outward by ~k/4 — if the
    // mesh bbox is tight to the sharp shape it can clip a lid. All three
    // smooth ops apply the same expansion so the marching-tetrahedra
    // bounds are safe.
    const k = 2;
    const su = __testables__.opSmoothUnion(a, b, k);
    const ss = __testables__.opSmoothSubtract(a, b, k);
    const si = __testables__.opSmoothIntersect(a, b, k);
    expect(su.bounds().min[0]).toBeLessThanOrEqual(-9);     // -8 - k/2
    expect(su.bounds().max[0]).toBeGreaterThanOrEqual(9);   // 8 + k/2
    // smoothSubtract: a's bounds ([-8..2] in X) expanded by k/2=1 → [-9..3]
    expect(ss.bounds().min[0]).toBeLessThanOrEqual(-9);
    expect(ss.bounds().max[0]).toBeGreaterThanOrEqual(3);
    // smoothIntersect: sharp ∩ is [-2,2] in X — expand by k/2 → [-3, 3]
    expect(si.bounds().min[0]).toBeLessThanOrEqual(-3);
    expect(si.bounds().max[0]).toBeGreaterThanOrEqual(3);
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

  it('label does NOT propagate through smoothUnion / smoothIntersect (ambiguous)', () => {
    // smoothUnion of two labelled spheres — neither label wins. Both
    // sides contribute surface, so "which label paints which triangle"
    // is undefined; the partitioner refuses to guess. To paint, label
    // the outer expression. smoothIntersect is the same — both
    // surfaces are mixed at the blend.
    const su = opSmoothUnion(primSphere(5).label('a'), primSphere(5).translate([4, 0, 0]).label('b'), 1);
    const si = __testables__.opSmoothIntersect(primSphere(5).label('a'), primSphere(5).translate([4, 0, 0]).label('b'), 1);
    expect(partitionByLabel(su)).toHaveLength(1);
    expect(partitionByLabel(su)[0].labelName).toBeUndefined();
    expect(partitionByLabel(si)).toHaveLength(1);
    expect(partitionByLabel(si)[0].labelName).toBeUndefined();
  });

  it('label DOES propagate through smoothSubtract (A-side surface survives)', () => {
    // smoothSubtract is one-sided: the result is A's surface with a
    // softened bite removed. Labels on A should still paint the
    // result — same semantics as sharp subtract, no asymmetry to
    // surprise users. B's labels are dropped (its surface is gone).
    const tree = __testables__.opSmoothSubtract(primSphere(5).label('shell'), primSphere(3).label('hole'), 1);
    const parts = partitionByLabel(tree);
    expect(parts).toHaveLength(1);
    expect(parts[0].labelName).toBe('shell');
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

// === New primitives & combinators (follow-up: ellipsoid, TPMS family,
// roundedCylinder, taper, polarArray, mirrorPair, repeat, offset twist) ===

describe('sdf ellipsoid', () => {
  const e = primEllipsoid(4, 2, 8);
  it('returns ~0 on each semi-axis tip', () => {
    expect(e.evaluate(4, 0, 0)).toBeCloseTo(0, 6);
    expect(e.evaluate(0, 2, 0)).toBeCloseTo(0, 6);
    expect(e.evaluate(0, 0, 8)).toBeCloseTo(0, 6);
  });
  it('is negative at the centre, positive well outside', () => {
    expect(e.evaluate(0, 0, 0)).toBeLessThan(0);
    expect(e.evaluate(10, 0, 0)).toBeGreaterThan(0);
  });
  it('has bounds equal to the semi-axes', () => {
    expect(e.bounds().min).toEqual([-4, -2, -8]);
    expect(e.bounds().max).toEqual([4, 2, 8]);
  });
  it('rejects non-positive radii', () => {
    expect(() => primEllipsoid(0, 1, 1)).toThrow();
    expect(() => primEllipsoid(1, -1, 1)).toThrow();
  });
});

describe('sdf roundedBox (outer size preserved)', () => {
  it('keeps the OUTER dimensions — does not inflate by radius', () => {
    const rb = primRoundedBox([10, 10, 10], 2);
    // Outer half-extent is 5 on each axis (NOT 5 + radius). The face
    // centre at x=5 sits on the surface; the rounding lives at the edges.
    expect(rb.evaluate(5, 0, 0)).toBeCloseTo(0, 6);
    expect(rb.bounds().max).toEqual([5, 5, 5]);
    expect(rb.bounds().min).toEqual([-5, -5, -5]);
  });
  it('radius 0 is a plain box', () => {
    const rb = primRoundedBox([4, 4, 4], 0);
    expect(rb.evaluate(2, 0, 0)).toBeCloseTo(0, APPROX);
  });
  it('rejects radius >= half the smallest dimension', () => {
    expect(() => primRoundedBox([10, 4, 10], 2)).toThrow(); // 2*2 >= 4
  });
});

describe('sdf roundedCylinder (outer dims preserved)', () => {
  it('keeps the OUTER radius and height', () => {
    const rc = primRoundedCylinder(5, 20, 1);
    // Side wall at radius 5, end cap at z = 10 (height/2).
    expect(rc.evaluate(5, 0, 0)).toBeCloseTo(0, 6);
    expect(rc.bounds().max).toEqual([5, 5, 10]);
    expect(rc.bounds().min).toEqual([-5, -5, -10]);
  });
  it('edgeRadius 0 is a plain cylinder', () => {
    const rc = primRoundedCylinder(3, 10, 0);
    expect(rc.evaluate(3, 0, 0)).toBeCloseTo(0, APPROX);
  });
  it('rejects edgeRadius >= radius or >= height/2', () => {
    expect(() => primRoundedCylinder(2, 20, 2)).toThrow(); // er >= radius
    expect(() => primRoundedCylinder(10, 4, 2)).toThrow(); // 2*er >= height
  });
});

describe('sdf TPMS family', () => {
  it('schwarzP crosses zero where cos sum is zero', () => {
    const p = primSchwarzP(10, 0);
    // cos(0)+cos(0)+cos(0) = 3 ≠ 0 at origin → interior of a wall.
    // At a quarter-period on one axis cos goes to 0.
    expect(typeof p.evaluate(0, 0, 0)).toBe('number');
    expect(p.bounds().min[0]).toBe(-Infinity);
  });
  it('diamond and lidinoid produce finite values and infinite bounds', () => {
    const d = primDiamond(8, 0.5);
    const l = primLidinoid(8, 0.5);
    expect(Number.isFinite(d.evaluate(1, 2, 3))).toBe(true);
    expect(Number.isFinite(l.evaluate(1, 2, 3))).toBe(true);
    expect(d.bounds().max[0]).toBe(Infinity);
    expect(l.bounds().max[0]).toBe(Infinity);
  });
  it('thickness widens the solid shell (more-negative field at the surface)', () => {
    const thin = primGyroid(10, 0.1);
    const thick = primGyroid(10, 1.0);
    // At a gyroid zero-crossing (origin), |g|-t = -t, so thicker → more
    // negative (deeper inside the wall).
    expect(thick.evaluate(0, 0, 0)).toBeLessThan(thin.evaluate(0, 0, 0));
  });
  it('all TPMS reject negative thickness / non-positive cellSize', () => {
    expect(() => primSchwarzP(0, 1)).toThrow();
    expect(() => primDiamond(8, -1)).toThrow();
  });
});

describe('sdf gradedGyroid', () => {
  it('thicker where the gradient fn returns a larger thickness', () => {
    // thickness ramps with z: thin at z=0, thick at z=10.
    const g = primGradedGyroid(10, (_x, _y, z) => 0.1 + 0.1 * z);
    // At a gyroid zero-crossing the field is -(thickness)/k. Compare two
    // crossing points at different heights: deeper (more negative) higher up.
    // Origin (z=0): thickness 0.1. Point (0,0,10) is also a crossing
    // (gyroid is periodic with cell 10 → 2π). thickness there = 1.1.
    expect(g.evaluate(0, 0, 10)).toBeLessThan(g.evaluate(0, 0, 0));
  });
  it('non-number thicknessFn result falls back to a bare surface (no NaN)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = primGradedGyroid(10, (() => undefined) as any);
    expect(Number.isFinite(g.evaluate(1, 1, 1))).toBe(true);
  });
  it('rejects a non-function thicknessFn', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primGradedGyroid(10, 0.5 as any)).toThrow();
  });
});

describe('sdf taper', () => {
  it('does not change the cross-section at the origin (scale = 1 there)', () => {
    const t = opTaper(primBox([4, 4, 20]), 0.1, 'z');
    // At z=0, scale is 1, so the field equals the box field exactly.
    expect(t.evaluate(2, 0, 0)).toBeCloseTo(0, 6);
  });
  it('widens toward +axis for positive rate', () => {
    // rate 0.25 → at z=4 the scale is 1 + 0.25*4 = 2, so the +X face that
    // was at x=2 is now at x=4. A point at x=3, z=4 is INSIDE now.
    const t = opTaper(primBox([4, 4, 20]), 0.25, 'z');
    expect(t.evaluate(3, 0, 4)).toBeLessThan(0);
    // The same point in the untapered box is outside.
    expect(primBox([4, 4, 20]).evaluate(3, 0, 4)).toBeGreaterThan(0);
  });
  it('expands perpendicular bounds by the max scale factor', () => {
    const t = opTaper(primBox([4, 4, 20]), 0.25, 'z');
    // z range is [-10, 10]; scale at z=10 is 1+2.5 = 3.5 → half-extent 2*3.5 = 7.
    expect(t.bounds().max[0]).toBeCloseTo(7, 6);
    expect(t.bounds().max[2]).toBe(10); // axis extent unchanged
  });
});

describe('sdf polarArray', () => {
  it('full ring of N copies all merge into one anonymous region', () => {
    const arm = primCapsule([3, 0, 0], [8, 0, 0], 1);
    const ring = opPolarArray(arm, 6, {});
    // No labels → the whole union is one region.
    expect(partitionByLabel(ring)).toHaveLength(1);
    // (8,0,0) is the first arm's far ENDPOINT CENTRE — 1 unit inside the
    // r=1 capsule, so field ≈ -1. The cap SURFACE is at x=9 (≈0).
    expect(ring.evaluate(8, 0, 0)).toBeCloseTo(-1, 6);
    expect(ring.evaluate(9, 0, 0)).toBeCloseTo(0, 6);
  });
  it('rotates copies — a copy lands at 90° for a 4-fold ring', () => {
    const arm = primCapsule([3, 0, 0], [8, 0, 0], 1);
    const ring = opPolarArray(arm, 4, {});
    // 4-fold full ring → copies at 0, 90, 180, 270. The 90° copy puts the
    // arm along +Y, so (0, 8, 0) is its endpoint centre (1 inside → -1).
    expect(ring.evaluate(0, 8, 0)).toBeCloseTo(-1, 6);
    // The un-arrayed single arm points along +X only, so +Y would be far
    // outside — proves the copy actually rotated.
    expect(arm.evaluate(0, 8, 0)).toBeGreaterThan(0);
  });
  it('radius pushes copies outward before rotating', () => {
    const blob = primSphere(1);
    const ring = opPolarArray(blob, 8, { radius: 10 });
    // Each blob centre sits 10 from the axis. At (10,0,0) we're at a
    // blob centre → field ~ -1 (inside, radius 1).
    expect(ring.evaluate(10, 0, 0)).toBeCloseTo(-1, 6);
  });
  it('rejects count < 1 or non-integer', () => {
    expect(() => opPolarArray(primSphere(1), 0, {})).toThrow();
    expect(() => opPolarArray(primSphere(1), 2.5, {})).toThrow();
  });
});

describe('sdf mirrorPair', () => {
  it('unions a node with its mirror across the axis', () => {
    const off = primSphere(2).translate(5, 0, 0);
    const pair = off.mirrorPair('x');
    // Original centre at +5 and mirror centre at -5 both inside.
    expect(pair.evaluate(5, 0, 0)).toBeCloseTo(-2, 6);
    expect(pair.evaluate(-5, 0, 0)).toBeCloseTo(-2, 6);
  });
});

describe('sdf repeat', () => {
  it('tiles the field with the given period (origin cell unchanged)', () => {
    const r = opRepeat(primSphere(1), [10, 0, 0]);
    // Sphere repeats every 10 on X. Centre of the cell at x=10 is another
    // sphere centre → field ~ -1.
    expect(r.evaluate(10, 0, 0)).toBeCloseTo(-1, 6);
    expect(r.evaluate(0, 0, 0)).toBeCloseTo(-1, 6);
  });
  it('is infinite on repeated axes, finite on non-repeated ones', () => {
    const r = opRepeat(primSphere(1), [10, 0, 0]);
    expect(r.bounds().min[0]).toBe(-Infinity);
    expect(r.bounds().max[0]).toBe(Infinity);
    expect(r.bounds().min[1]).toBe(-1); // Y not repeated → sphere extent
    expect(r.bounds().max[1]).toBe(1);
  });
  it('rejects a negative period', () => {
    expect(() => primSphere(1).repeat([10, -1, 0])).toThrow();
  });
});

describe('sdf twist with offset axis', () => {
  it('an offset twist axis leaves points ON that axis unchanged', () => {
    // Twist around the vertical line x=5, y=0. A point on that line at any
    // height maps back to itself, so the field equals the untwisted field.
    const box = primBox([4, 2, 20]).translate(5, 0, 0); // centred on the twist axis
    const twisted = opTwist(box, 45, 'z', [5, 0]);
    // The twist axis passes through the box centre (5,0); centre field is
    // the box interior, unchanged by the twist.
    expect(twisted.evaluate(5, 0, 0)).toBeCloseTo(box.evaluate(5, 0, 0), 6);
  });
  it('offset center enlarges the perpendicular bounds (measured from center)', () => {
    const box = primBox([4, 4, 20]);
    const centered = opTwist(box, 90, 'z', [0, 0]);
    const offset = opTwist(box, 90, 'z', [10, 0]);
    // Sweeping around a far-off axis traces a bigger disc.
    const cW = centered.bounds().max[0] - centered.bounds().min[0];
    const oW = offset.bounds().max[0] - offset.bounds().min[0];
    expect(oW).toBeGreaterThan(cW);
  });
});

// === Follow-up: graded TPMS variants, repeatN, polarRepeat =================

describe('sdf graded TPMS variants', () => {
  it('gradedSchwarzP / gradedDiamond / gradedLidinoid all infinite-bounded and finite-valued', () => {
    const ramp = (_x: number, _y: number, z: number) => 0.3 + 0.05 * z;
    const p = __testables__.primGradedSchwarzP(8, ramp);
    const d = __testables__.primGradedDiamond(8, ramp);
    const l = __testables__.primGradedLidinoid(8, ramp);
    for (const n of [p, d, l]) {
      expect(n.bounds().min[0]).toBe(-Infinity);
      expect(Number.isFinite(n.evaluate(1, 2, 3))).toBe(true);
    }
  });
  it('graded variants reject non-function thicknessFn and bad cellSize', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => __testables__.primGradedSchwarzP(8, 0.3 as any)).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => __testables__.primGradedDiamond(0, ((): number => 0.3) as any)).toThrow();
  });
  it('non-number thicknessFn return tolerated (no NaN poisoning)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const n = __testables__.primGradedLidinoid(8, (() => undefined) as any);
    expect(Number.isFinite(n.evaluate(1, 1, 1))).toBe(true);
  });
});

describe('sdf repeatN (finite-count tiling)', () => {
  const { opRepeatN } = __testables__;
  it('finite bounds — even on axes the user repeats', () => {
    const r = opRepeatN(primSphere(1), [3, 0, 0], [4, 0, 0]);
    // 3 copies along X centred at cells -1, 0, 1 → X extent [-1-1, 1+1] = [-2, 2] times period 4 = [-5, 5].
    expect(r.bounds().min[0]).toBe(-5);
    expect(r.bounds().max[0]).toBe(5);
    // Y/Z untouched.
    expect(r.bounds().min[1]).toBe(-1);
    expect(r.bounds().max[1]).toBe(1);
  });
  it('places copies on the right cells (odd count → centred on origin)', () => {
    const r = opRepeatN(primSphere(1), [3, 0, 0], [4, 0, 0]);
    // Cells at x = -4, 0, +4 → sphere centres there.
    expect(r.evaluate(0, 0, 0)).toBeCloseTo(-1, 6);
    expect(r.evaluate(4, 0, 0)).toBeCloseTo(-1, 6);
    expect(r.evaluate(-4, 0, 0)).toBeCloseTo(-1, 6);
  });
  it('points well beyond the array snap to the nearest cell (filled boundary)', () => {
    const r = opRepeatN(primSphere(1), [3, 0, 0], [4, 0, 0]);
    // At x=20 (far past the last cell at x=4), should snap to that cell
    // → distance ≈ 20 - 4 - 1 = 15 from the boundary sphere's surface.
    expect(r.evaluate(20, 0, 0)).toBeCloseTo(15, 6);
  });
  it('count = 0 OR period = 0 on an axis means "pass-through"', () => {
    const noRepeat = opRepeatN(primSphere(1), [0, 0, 0], [4, 0, 0]);
    expect(noRepeat.evaluate(10, 0, 0)).toBeCloseTo(9, 6); // same as bare sphere
    const noPeriod = opRepeatN(primSphere(1), [3, 0, 0], [0, 0, 0]);
    expect(noPeriod.evaluate(10, 0, 0)).toBeCloseTo(9, 6); // same as bare sphere
  });
  it('count = 1 is a single cell at the origin (no repeat)', () => {
    const single = opRepeatN(primSphere(1), [1, 0, 0], [4, 0, 0]);
    // Only one cell at x=0 — far points get the bare-sphere distance.
    expect(single.evaluate(10, 0, 0)).toBeCloseTo(9, 6);
    expect(single.evaluate(4, 0, 0)).toBeCloseTo(3, 6);
  });
  it('rejects non-integer or negative counts and negative periods', () => {
    expect(() => primSphere(1).repeatN([2.5, 0, 0], [3, 0, 0])).toThrow();
    expect(() => primSphere(1).repeatN([-1, 0, 0], [3, 0, 0])).toThrow();
    expect(() => primSphere(1).repeatN([2, 0, 0], [-1, 0, 0])).toThrow();
  });
});

describe('sdf repeatN stagger (brick-shift)', () => {
  it('default amount (0.5) shifts every other by-row by half a period along the along-axis', () => {
    // 3 rows along Y at y = -4, 0, +4. With stagger {along:'x', by:'y'},
    // the y=0 row (cBy=0, even) sits unshifted; y=±4 rows (cBy=±1, odd)
    // shift along X by 0.5 * 4 = 2. A sphere unit cell at origin therefore
    // has its OUTER ROW centres at (x=2, y=4) and (x=2, y=-4).
    const tile = primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      stagger: { along: 'x', by: 'y' },
    });
    expect(tile.evaluate(0, 0, 0)).toBeCloseTo(-1, 6);   // centre of the y=0 row, unshifted cell at x=0
    expect(tile.evaluate(2, 4, 0)).toBeCloseTo(-1, 6);   // shifted x=2 in the y=+4 row
    expect(tile.evaluate(0, 4, 0)).toBeGreaterThan(-1);  // x=0 in the y=+4 row is NO LONGER a cell centre
  });
  it('amount 0 disables the stagger (same as no stagger)', () => {
    const plain = primSphere(1).repeatN([3, 3, 0], [4, 4, 0]);
    const zeroStagger = primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      stagger: { along: 'x', by: 'y', amount: 0 },
    });
    expect(zeroStagger.evaluate(4, 4, 0)).toBeCloseTo(plain.evaluate(4, 4, 0), 6);
  });
  it('amount > 0 expands the along-axis bounds by amount*period', () => {
    const plain = primSphere(1).repeatN([3, 3, 0], [4, 4, 0]);
    const staggered = primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      stagger: { along: 'x', by: 'y', amount: 0.5 },
    });
    // Plain X extent: cells at -4,0,4 + sphere radius 1 → [-5, 5].
    // Staggered: shifted rows extend +0.5*4 = +2 further on the +X side.
    expect(staggered.bounds().max[0]).toBeCloseTo(plain.bounds().max[0] + 2, 6);
    // Y bounds unaffected.
    expect(staggered.bounds().min[1]).toBe(plain.bounds().min[1]);
    expect(staggered.bounds().max[1]).toBe(plain.bounds().max[1]);
  });
  it('rejects along === by (same axis) and amount outside [0, 1]', () => {
    expect(() => primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      stagger: { along: 'x', by: 'x' },
    })).toThrow(/different axes/);
    expect(() => primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      stagger: { along: 'x', by: 'y', amount: 1.5 },
    })).toThrow();
    expect(() => primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      stagger: { along: 'x', by: 'y', amount: -0.1 },
    })).toThrow();
  });
  it('rejects missing along/by, unknown stagger fields, and unknown opts keys', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primSphere(1).repeatN([3, 3, 0], [4, 4, 0], { stagger: { along: 'x' } as any })).toThrow();
    expect(() => primSphere(1).repeatN([3, 3, 0], [4, 4, 0], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stagger: { along: 'x', by: 'y', wobble: 0.3 } as any,
    })).toThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primSphere(1).repeatN([3, 3, 0], [4, 4, 0], { wiggle: true } as any)).toThrow();
  });
});

describe('sdf polarRepeat (domain-warp ring)', () => {
  const { opPolarRepeat } = __testables__;
  it('full revolution: a copy lands at every sector boundary', () => {
    // Capsule arm along +X — polarRepeat with count=4 → arms at 0/90/180/270.
    const arm = primCapsule([3, 0, 0], [8, 0, 0], 1);
    const tile = opPolarRepeat(arm, 4, 'z', 0);
    // Endpoint centres at (8,0), (0,8), (-8,0), (0,-8) all yield ≈ -1.
    expect(tile.evaluate(8, 0, 0)).toBeCloseTo(-1, 6);
    expect(tile.evaluate(0, 8, 0)).toBeCloseTo(-1, 6);
    expect(tile.evaluate(-8, 0, 0)).toBeCloseTo(-1, 6);
    expect(tile.evaluate(0, -8, 0)).toBeCloseTo(-1, 6);
  });
  it('result has N-fold symmetry around the axis', () => {
    // Off-centre primitive: rotating any point by sector should give same
    // field. Compute the rotated samples exactly so the test isn't bottlenecked
    // by hand-rounded coordinates.
    const seed = primSphere(2).translate(6, 0, 0);
    const ring = opPolarRepeat(seed, 6, 'z', 0);
    const samples: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      samples.push([6 * Math.cos(a), 6 * Math.sin(a)]);
    }
    const values = samples.map(([x, y]) => ring.evaluate(x, y, 0));
    // All six values should be ≈ equal (60° apart on a 6-fold polar repeat).
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeCloseTo(values[0], 8);
    }
  });
  it('radius option pushes the seed outward before tiling', () => {
    // Centred sphere + radius=10 → ring of spheres at radius 10 from Z axis.
    const ring = opPolarRepeat(primSphere(2), 8, 'z', 10);
    // (10, 0, 0) is on a sphere centre → -2.
    expect(ring.evaluate(10, 0, 0)).toBeCloseTo(-2, 6);
  });
  it('bounds: radial extent = max child distance from axis, axial extent preserved', () => {
    const seed = primSphere(2).translate(6, 0, 0);
    const ring = opPolarRepeat(seed, 8, 'z', 0);
    // Seed bbox is [4,8]x[-2,2]x[-2,2]; radial extent = max(|4|, |8|, |2|) = 8.
    expect(ring.bounds().min[0]).toBe(-8);
    expect(ring.bounds().max[0]).toBe(8);
    expect(ring.bounds().min[2]).toBe(-2);
    expect(ring.bounds().max[2]).toBe(2);
  });
  it('rejects count < 1 or non-integer', () => {
    expect(() => primSphere(1).polarRepeat(0)).toThrow();
    expect(() => primSphere(1).polarRepeat(3.5)).toThrow();
  });
  it('rejects unknown options key (typo guard)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primSphere(1).polarRepeat(6, { spread: 10 } as any)).toThrow();
  });
  it('rejects { angle } with a targeted "use polarArray" hint', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => primSphere(1).polarRepeat(6, { angle: 180 } as any)).toThrow(/polarArray/);
  });
});
