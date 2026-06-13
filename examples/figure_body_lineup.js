// Body-type lineup — a row of figures off the SAME rig, each flexing the new
// anthropometric axes (sex / age / weight) added in the MakeHuman-mined rig
// update. Left → right: a child, a lean woman, an average adult, a heavyset
// man, and an older adult. They share one long base bar (feet sink into it) so
// the whole lineup prints as a single connected piece. Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// Build one standing figure from rig options, placed at world-X `x`. Arms held
// slightly out so they read clear of the torso silhouette. Returns { skin, hair }
// already translated into place (label them at the top level).
function person(opts, x, hairStyle) {
  const rig = F.rig(Object.assign({
    headsTall: 6.8,
    pose: { arms: { raiseSide: 11 }, legL: { raiseSide: 6 }, legR: { raiseSide: 6 } },
  }, opts));
  const head = F.head(rig);
  const face = F.face.assemble(head, rig, { eyes: false, mouth: { smirk: 0.15 }, ears: false });
  const skin = F.weld(rig, [
    F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig),
    F.legs(rig), F.feet(rig), face,
  ]).translate([x, 0, 0]);
  const hair = F.hair(rig, { style: hairStyle }).translate([x, 0, 0]);
  return { skin, hair, rig, x };
}

// Five body types across the axes. Heights vary too (a child is shorter), so
// the lineup reads as a real range, not just a proportion sweep.
const GAP = 17;
const specs = [
  { opts: { height: 33, headsTall: 4.6, age: 7 },                         hair: 'short' }, // child
  { opts: { height: 45, sex: 'female', weight: 0.35, build: 'slim' },     hair: 'long' },  // lean woman
  { opts: { height: 47 },                                                 hair: 'bob' },   // average adult (neutral)
  { opts: { height: 50, sex: 'male', weight: 0.92, build: 'average' },    hair: 'short' }, // heavyset man
  { opts: { height: 46, age: 68, weight: 0.55, build: 'slim' },           hair: 'bald' },  // older adult
];

const people = specs.map((s, i) => person(s.opts, (i - 2) * GAP, s.hair));
const skin = F.weld(people[0].rig, people.map((p) => p.skin)).label('skin');
const hair = people.slice(1).reduce((acc, p) => acc.union(p.hair), people[0].hair).label('hair');

// Long base bar the whole row stands on (feet sink in → one connected print).
const half = (specs.length - 1) * GAP / 2;
const base = sdf.roundedBox([half * 2 + 26, 22, 3.2], 1.4)
  .translate([0, 0, 1.0]).label('base');

// One head detail sphere per figure, offset to its placed X (faceDetail centers
// on the rig origin; each figure is translated, so shift the center to match).
const detail = people.map((p) => ({
  center: [p.rig.joints.head[0] + p.x, p.rig.joints.head[1], p.rig.joints.head[2]],
  radius: Math.max(p.rig.r.headX, p.rig.r.head, p.rig.r.headZ) * 1.6,
  edgeLength: Math.max(p.rig.r.head * 0.08, 0.08),
}));

return sdf.union(skin, hair, base).build({ edgeLength: 0.6, detail });
