// armor_forearm_2x — exact facet-census decode (§5.26/§5.28).
// Architecture: octagonal tube shell (XZ octagon hw3.5 z0..7, 0.5 chamfers)
// with cavity prism, side rib bulges (hull of exact mesh verts), top ridge
// with covered channel + open slot, transverse window, floor channel/end
// cuts, +y bottom slant, and two snap-detent spheres r=1.000 @ (±3.3,0.5,3.5).
// Genus 4 = tube(1) + two pierced side walls at the window(2) + roofed ridge
// channel over the open-bottom body(1). Every constant read from the facet
// census / welded vertex dump — zero fitted numbers.
const { Manifold } = api;
const hull = Manifold.hull;

// mirror a +x point list across x=0 and concatenate
const mirX = (pts) => [...pts, ...pts.map(([x, y, z]) => [-x, y, z])];
// extrude an XZ profile (as [x,z] pairs) between two y values via hull
const prismY = (xz, y0, y1) =>
  hull(xz.flatMap(([x, z]) => [[x, y0, z], [x, y1, z]]));
// extrude a YZ profile ([y,z] pairs) between two x values via hull
const prismX = (yz, x0, x1) =>
  hull(yz.flatMap(([y, z]) => [[x0, y, z], [x1, y, z]]));
// extrude an XY plan profile ([x,y] pairs) between two z values via hull
const prismZ = (xy, z0, z1) =>
  hull(xy.flatMap(([x, y]) => [[x, y, z0], [x, y, z1]]));

// ---------- outer body ----------
// main octagon prism, y -10..8.5
const OCT = [[3, 0], [3.5, 0.5], [3.5, 6.5], [3, 7], [-3, 7], [-3.5, 6.5], [-3.5, 0.5], [-3, 0]];
const MAIN = prismY(OCT, -10, 8.5);
// -y end: inset rect face at y=-10.5 chamfering out to the full octagon at y=-10
const RECT = [[3, 0.5], [3, 6.5], [-3, 6.5], [-3, 0.5]];
const ENDT = hull([
  ...RECT.flatMap(([x, z]) => [[x, -10.5, z], [x, -10.45, z]]),
  ...OCT.flatMap(([x, z]) => [[x, -10, z], [x, -9.95, z]]),
]);
// side rib bulge: hull of the 16 exact welded mesh vertices (+x side)
const bulgeVerts = [
  [3, -2, 0], [3.5, -1.5, 0], [3.5, -1.5, 0.5], [3.5, -1.5, 2],
  [4, -1, 0.5], [4, -1, 1.79289], [3.5, 1.5, 5], [4, 1.70711, 4.5],
  [4, 5.29289, 0.5], [3.5, 5.5, 0], [3.5, 8, 5], [4, 8, 3.20711],
  [4, 8, 4.5], [3, 8.5, 5], [3.5, 8.5, 3], [3.5, 8.5, 5],
  [3, 6.20711, 0], // rear-bottom footprint corner (slant-chamfer plane at x=3, z=0)
];
const BULGEp = hull(bulgeVerts);
// -x bulge is NOT a mirror at its front-bottom: target has a flat y=-1.5
// face there (welded vert (-3,-1.5,0), facet n=(0,-1,0) d=1.5) instead of
// +x's 45deg plan chamfer reaching (3,-2,0).
const BULGEm = hull(bulgeVerts.map(([x, y, z]) =>
  (x === 3 && y === -2) ? [-3, -1.5, 0] : [-x, y, z]));
// top ridge = (YZ profile prisms) ∩ (XZ rail profile prism)
const P1 = prismX([[0.5, 7], [2, 8.5], [10.5, 8.5], [10.5, 8.1], [7.8, 5.4], [0.5, 5.4]], -2.6, 2.6);
const P2 = prismX([[5.5, 8.5], [6, 9], [10, 9], [10.5, 8.5]], -2.6, 2.6);
const XZP = prismY([[2.5, 5.3], [2.5, 8], [1.5, 9], [-1.5, 9], [-2.5, 8], [-2.5, 5.3]], -1, 11);
const RIDGE = P1.add(P2).intersect(XZP);

const OUTER = MAIN.add(ENDT).add(BULGEp).add(BULGEm).add(RIDGE);

// ---------- +y end cuts (KEEP intersection) ----------
// below z=5: end face y=8.5 with 45deg plan chamfers x+y=12 (bulge x=4 level)
const K_LOW = prismZ([[4.6, -11], [4.6, 7.4], [3.5, 8.5], [-3.5, 8.5], [-4.6, 7.4], [-4.6, -11]], -1.2, 5);
// z 5..7: plan chamfers x+y=11.5 (main x=3.5 wall level)
const K_HIGH = prismZ([[4.6, -11], [4.6, 6.9], [3, 8.5], [-3, 8.5], [-4.6, 6.9], [-4.6, -11]], 5, 7.3);
// ridge + rear overhang region is not end-cut (ridge carries its own rear profile)
const K_RIDGE = hull(mirX([[2.6, -11, 5.3], [2.6, 10.7, 5.3], [2.6, -11, 9.7], [2.6, 10.7, 9.7]]));
const KEEP = K_LOW.add(K_HIGH).add(K_RIDGE);

// +y bottom slant y-z=5.5 (z 0..3); its bulge-corner chamfer plane is
// already a hull face of BULGE via the exact verts.
const SLANT = prismX([[5.4, -0.1], [9.3, -0.1], [9.3, 3.8]], -4.7, 4.7);

// ---------- interior cuts ----------
// cavity prism (through both ends): floor 0.7 w/ 0.5 chamfers, walls x=2.7
// to z=5.5, 45deg wings to ceiling 6.1 (|x|<=2.1)
const CAV = prismY(
  [[2.2, 0.7], [2.7, 1.2], [2.7, 5.5], [2.1, 6.1], [-2.1, 6.1], [-2.7, 5.5], [-2.7, 1.2], [-2.2, 0.7]],
  -11.2, 9.4);
// floor channel |x|<=1.6 from undercut ramp y+z=-3.1
const FC1 = prismX([[-2.6, -0.5], [9, -0.5], [9, 1.0], [-4.1, 1.0]], -1.6, 1.6);
// floor end |x|<=2.7: 45deg ramp y=z ONLY for z 0..0.5, then vertical face
// y=0.5 above (two convex prisms — cut region is {y>=z} ∪ {y>=0.5})
const FC2 = prismX([[-0.5, -0.5], [9, -0.5], [9, 0.55], [0.55, 0.55]], -2.7, 2.7)
  .add(prismX([[0.5, 0.4], [9, 0.4], [9, 1.4], [0.5, 1.4]], -2.7, 2.7));
// top opening + slot, full height, y -3..5.5 — the wing+wall profile is
// CONCAVE at (1.5,6.7): build as two convex prisms, never one hull (§7 trap)
const WING_XZ = [[2.1, 6.1], [1.5, 6.7], [-1.5, 6.7], [-2.1, 6.1]];
const TOPA = prismY(WING_XZ, -3, 5.5).add(
  prismY([[1.5, 6.6], [1.5, 9.6], [-1.5, 9.6], [-1.5, 6.6]], -3, 5.5));
// its -y 45deg overhang ramp wedge (y -3.7..-3, ramp plane z=y+9.8), split at
// z=6.7 for the same concavity reason
const WEDB = hull(mirX([
  [2.1, -3.7, 6.1], [2.1, -3, 6.1], [1.5, -3, 6.7], [1.5, -3.1, 6.7],
])).add(hull(mirX([
  [1.5, -3.1, 6.7], [1.5, -3, 6.7], [1.5, -3, 6.8],
])));
// covered channel y 5.4..10.8: wings, walls 1.5 to z=7.8, 0.5 ceiling
// chamfers, ceiling 8.3 — same concave split
const CHAN = prismY(WING_XZ, 5.4, 10.8).add(prismY(
  [[1.5, 6.6], [1.5, 7.8], [1.0, 8.3], [-1.0, 8.3], [-1.5, 7.8], [-1.5, 6.6]],
  5.4, 10.8));
// slot-end transition wedge (ramp y+z=13.7 between slot and chamfered ceiling)
const SLOTW = hull(mirX([
  [1.5, 5.5, 7.7], [1.5, 5.5, 8.2], [1.5, 5.9, 7.7], [1.5, 5.9, 7.8],
]));

// ---------- transverse window (y -7.5..-5 core, 0.5 rim chamfers on every
// outer face it crosses: walls x=3.5 -> plan chamfers; z=0/z=7 -> yz wedges) ----------
// XZ profile of the cut (leaves |x|<=1.5 bottom/top strips, strip edges
// chamfered x-z=1 and x+z=8; middle ceiling trim to z=6.4)
const SIDEp = prismY([[1.5, -0.7], [4.7, -0.7], [4.7, 7.7], [1.5, 7.7]], -8.2, -4.3);
const SIDEm = prismY([[-1.5, -0.7], [-4.7, -0.7], [-4.7, 7.7], [-1.5, 7.7]], -8.2, -4.3);
const WCBp = prismY([[0.3, -0.7], [1.5, -0.7], [1.5, 0.5]], -8.2, -4.3);   // x-z=1
const WCBm = prismY([[-0.3, -0.7], [-1.5, -0.7], [-1.5, 0.5]], -8.2, -4.3);
const WCTp = prismY([[0.3, 7.7], [1.5, 7.7], [1.5, 6.5]], -8.2, -4.3);     // x+z=8
const WCTm = prismY([[-0.3, 7.7], [-1.5, 7.7], [-1.5, 6.5]], -8.2, -4.3);
const WMID = prismY([[1.6, 5.9], [1.6, 6.4], [-1.6, 6.4], [-1.6, 5.9]], -7.5, -5);
const PW = SIDEp.add(SIDEm).add(WCBp).add(WCBm).add(WCTp).add(WCTm).add(WMID);
// y-extent envelope: core slab + 4 outward-widening wedges (max semantics)
const CY = hull(mirX([[4.7, -7.5, -0.7], [4.7, -5, -0.7], [4.7, -7.5, 7.7], [4.7, -5, 7.7]]));
const W1 = prismZ([[3, -7.5], [3, -5], [4.7, -3.3], [4.7, -9.2]], -0.7, 7.7);   // |x| side chamfers
const W1m = prismZ([[-3, -7.5], [-3, -5], [-4.7, -3.3], [-4.7, -9.2]], -0.7, 7.7);
const WB = prismX([[-7.5, 0.5], [-5, 0.5], [-3.8, -0.7], [-8.7, -0.7]], -4.7, 4.7); // bottom rim
const WT = prismX([[-7.5, 6.5], [-5, 6.5], [-3.8, 7.7], [-8.7, 7.7]], -4.7, 4.7);  // top rim
// 8 three-plane corner miters on the window rim (0.577-normal facets):
// plane sx*x + sy*y + sz*z = c, cut on the +normal side, boxed to the corner
const cornerCuts = [];
for (const sx of [1, -1]) for (const [sy, sz, c] of [
  [-1, -1, 7.5], [-1, 1, 14.5], [1, -1, -5], [1, 1, 2],
]) {
  // slab beyond the plane: points on the plane over a generous (y,z) patch,
  // plus copies pushed 1.5 outward in x
  const yy = sy < 0 ? [-6.2, -3.6] : [-9.4, -6.8];
  const zz = sz < 0 ? [-1.0, 1.5] : [5.5, 8.0];
  const pts = [];
  for (const y of yy) for (const z of zz) {
    const x = sx * (c - sy * y - sz * z);
    pts.push([x, y, z], [x + sx * 1.5, y, z]);
  }
  // box the cut to its own corner so it can't nick the strips
  cornerCuts.push(hull(pts).intersect(hull([
    [sx * 2.8, yy[0], zz[0]], [sx * 4.8, yy[0], zz[0]],
    [sx * 2.8, yy[1], zz[0]], [sx * 4.8, yy[1], zz[0]],
    [sx * 2.8, yy[0], zz[1]], [sx * 4.8, yy[0], zz[1]],
    [sx * 2.8, yy[1], zz[1]], [sx * 4.8, yy[1], zz[1]],
  ])));
}
let WINDOW = PW.intersect(CY.add(W1).add(W1m).add(WB).add(WT));
for (const cc of cornerCuts) WINDOW = WINDOW.add(cc);

// ---------- ridge front-slope corner chamfers (0.5 leg, plane
// 0.7071x - 0.5y + 0.5z = 4.6642 and mirror), clipped to z>=7 ----------
const rwPts = (s) => [-0.6, 2.6].flatMap((t) => [
  [s * 2.5, t, t + 6.5], [s * 2.5, t, t + 5.79289322], [s * 2.0, t, t + 6.5],
]);
const CLIPZ7 = hull(mirX([[2.7, -1.1, 7], [2.7, 3.1, 7], [2.7, -1.1, 9.8], [2.7, 3.1, 9.8]]));
const RWp = hull(rwPts(1)).intersect(CLIPZ7);
const RWm = hull(rwPts(-1)).intersect(CLIPZ7);

// rear slant z = y - 2.4 also cuts the main body end below z=6.1, bounded
// by the cavity walls |x| <= 2.7 (measured: end face y=8.5 only survives at
// 2.7 < |x| for z 3..6.1; inboard the slant boundary y = z + 2.4 governs)
const REARSLANT = prismX([[7.7, 5.3], [11, 5.3], [11, 8.6]], -2.7, 2.7);

// ---------- assemble ----------
let body = OUTER.intersect(KEEP).subtract(SLANT).subtract(REARSLANT);
for (const c of [CAV, FC1, FC2, TOPA, WEDB, CHAN, SLOTW, WINDOW, RWp, RWm]) {
  body = body.subtract(c);
}
// snap detents: sphere r=1.000 @ (±3.3, 0.5, 3.5), clipped to the wall body,
// added LAST so they protrude into the finished cavity
const wallBase = MAIN.add(BULGEp).add(BULGEm);
const DETp = Manifold.sphere(1, 64).translate([3.3, 0.5, 3.5]).intersect(wallBase);
const DETm = Manifold.sphere(1, 64).translate([-3.3, 0.5, 3.5]).intersect(wallBase);
return body.add(DETp).add(DETm);
