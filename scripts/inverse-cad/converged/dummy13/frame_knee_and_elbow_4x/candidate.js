// frame_knee_and_elbow_4x — structured rebuild
// base: traced z=1.4 outline (channels, ears, V-notch), eye lobe as exact
// circle r=1.5 @ (3,3.6), socket disks refilled (pac-man: disk r=2.4 minus
// 110° mouth wedge), extruded 0→2.8; minus revolved hourglass cavity per
// socket: counterbore r=2.4 depth 0.4 both faces, 45° cones, waist r=1.5407.
// All numbers probed (rays from socket centers; section traces).
const { Manifold, CrossSection, geom } = api;

// traced slice z=1.4 (probe section --code)
const outer0 = geom.fromPoints([[1.80,1.51],[1.18,0.99],[1.44,0.54],[1.54,0.03],[1.49,-0.39],[1.27,-0.87],[0.99,-1.18],[0.64,-1.40],[0.24,-1.52],[-0.18,-1.53],[-0.86,-1.28],[-1.35,-0.74],[-1.50,-0.35],[-1.54,0.07],[-1.33,0.77],[-2.08,1.20],[-2.14,1.96],[-2.95,2.70],[-3.63,2.65],[-3.93,2.20],[-4.34,1.20],[-4.49,0.32],[-4.44,-0.76],[-4.20,-1.63],[-3.79,-2.43],[-3.23,-3.13],[-2.39,-3.81],[-1.59,-4.21],[-0.36,-4.49],[1.50,-4.50],[3.00,-3.00],[4.50,-4.50],[6.18,-4.50],[6.89,-4.41],[7.92,-4.07],[8.83,-3.50],[9.58,-2.72],[10.20,-1.63],[10.46,-0.58],[10.47,0.50],[10.23,1.54],[9.63,2.65],[8.95,2.70],[8.14,1.96],[8.08,1.20],[7.33,0.77],[7.52,0.28],[7.52,-0.24],[7.30,-0.83],[6.95,-1.22],[6.49,-1.46],[5.87,-1.54],[5.36,-1.40],[4.93,-1.11],[4.58,-0.59],[4.46,-0.08],[4.56,0.54],[4.82,0.99],[4.20,1.51],[4.20,2.70],[4.48,3.36],[4.45,3.98],[4.11,4.61],[3.51,5.01],[2.90,5.10],[2.39,4.97],[1.97,4.69],[1.66,4.27],[1.50,3.57],[1.57,3.16],[1.80,2.70]]);
const hole0 = geom.fromPoints([[3.36,2.70],[3.42,3.00],[3.64,3.45],[3.61,3.85],[3.30,4.19],[3.03,4.26],[2.77,4.22],[2.49,4.02],[2.34,3.65],[2.38,3.38],[2.63,2.85],[2.64,1.62],[3.36,1.62]]);

const H = 2.8;         // bbox z extent
const rb = 2.4;        // counterbore radius (ray-probed)
const cb = 0.4;        // counterbore depth per face (ray-probed)
const rw = 1.5407;     // waist radius (ray-probed)
const c1 = [0, 0];     // socket 1 center
const c2 = [6, 0];     // socket 2 center (mirror about x=3)

// eye lobe: exact circle r=1.5 @ (3,3.6) — traced chords all sit at r=1.500
const eyeLobe = CrossSection.circle(1.5, 96).translate([3, 3.6]);

// mouth wedge sector (fan polygon, apex at socket center)
function sector(cx, cy, a0deg, a1deg) {
  const R = 3.2, n = 8, pts = [[cx, cy]];
  for (let i = 0; i <= n; i++) {
    const a = ((a0deg + ((a1deg - a0deg) * i) / n) * Math.PI) / 180;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return geom.fromPoints(pts);
}
// mouth wedges pass through the socket centers: 40°..150° (socket 1),
// mirrored 30°..140° (socket 2) — verified against traced corner points.
// fill radius 2.0: only needs to cover the traced waist contour (r≈1.54);
// staying inside rb avoids coincident-cylinder float membranes at r=2.4
const pac1 = CrossSection.circle(2.0, 96).translate(c1).subtract(sector(c1[0], c1[1], 40, 150));
const pac2 = CrossSection.circle(2.0, 96).translate(c2).subtract(sector(c2[0], c2[1], 30, 140));

const base2d = outer0.add(eyeLobe).add(pac1).add(pac2).subtract(hole0);
const solid = base2d.extrude(H, 0, 0, [1, 1]);

// revolved hourglass cavity (X = radius, Y = height→Z)
// overshoot past both faces: revolve tessellation rounds to float32
// (top landed at 2.7999999970), leaving a nm-thin cap membrane if the
// profile ends exactly at the face planes
const cavProfile = geom.fromPoints([
  [0, -0.1], [rb, -0.1], [rb, cb],
  [rw, H - rw], [rw, rw],
  [rb, H - cb], [rb, H + 0.1], [0, H + 0.1],
]);
const cav = cavProfile.revolve(96);

const cored = solid
  .subtract(cav.translate([c1[0], c1[1], 0]))
  .subtract(cav.translate([c2[0], c2[1], 0]));

// ---- 45° edge chamfers, leg 0.5, bottom + top faces (ray-probed:
// outer wall inset = 0.5−z for z<0.5, full r for z∈[0.5,2.3], mirrored top).
// Chamfered edges: outer r=4.5 arcs, y=−4.5 straights, V-notch lines.
// NOT chamfered: eye lobe, channel walls, ear end-faces, mouth wedges,
// counterbore rims (verified by z=0.05 trace + inward ray scans).
const leg = 0.5;

// wide mask fan for the ring cut (radius must exceed 5.3)
function sectorWide(cx, cy, a0deg, a1deg) {
  const R = 6.5, n = 24, pts = [[cx, cy]];
  for (let i = 0; i <= n; i++) {
    const a = ((a0deg + ((a1deg - a0deg) * i) / n) * Math.PI) / 180;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return geom.fromPoints(pts);
}
function ringCutW(cx, cy, a0deg, a1deg) {
  const prof = geom.fromPoints([
    [4.5 - leg, 0], [4.5 - leg, -0.1], [5.3, -0.1], [5.3, leg], [4.5, leg],
  ]);
  const ring = prof.revolve(128).translate([cx, cy, 0]);
  const mask = sectorWide(cx, cy, a0deg, a1deg).extrude(leg + 0.2, 0, 0, [1, 1]).translate([0, 0, -0.1]);
  return ring.intersect(mask);
}

// straight-edge wedge along y=−4.5: remove {y < −4.0 − z}
const wyProf = geom.fromPoints([[-4.0, 0], [-4.0, -0.1], [-4.85, -0.1], [-4.85, 0.85]]);
const wY = wyProf.extrude(7.5, 0, 0, [1, 1]).rotate([90, 0, 0]).rotate([0, 0, 90]).translate([-0.5, 0, 0]);

// V-notch miter cut: {x−y > 6−√2·ins} ∩ {x+y < √2·ins}, ins = 0.5−z —
// convex, so hull of the dilated notch triangle at z=0 and the exact
// notch triangle at z=0.5 (plates sit just outside [0,0.5] so cut is exact)
function vPlate(ins, z) {
  const s = Math.SQRT2 * ins;
  return geom.fromPoints([[1.2 - s, -4.85], [4.8 + s, -4.85], [3, -3 + s]])
    .extrude(0.02, 0, 0, [1, 1]).translate([0, 0, z]);
}
const wV = vPlate(leg, -0.02).add(vPlate(0, leg)).hull();

// arc spans: socket-1 outer arc runs ear-junction (~137.5°) → 270° where the
// y=−4.5 straight takes over; socket 2 mirrored about x=3
const bottomCuts = ringCutW(c1[0], c1[1], 137, 270)
  .add(ringCutW(c2[0], c2[1], -90, 43))
  .add(wY)
  .add(wV);
const cuts = bottomCuts.add(bottomCuts.mirror([0, 0, 1]).translate([0, 0, H]));

return cored.subtract(cuts);
