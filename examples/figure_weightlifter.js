// Olympic Weightlifter — overhead lockout of a clean & jerk.
//
// Showcases:
//   - muscle axis at 0.9 (heroic stocky physique)
//   - two-handed barbell prop via F.spanGrips (bar + weight plates)
//   - wide power stance (legs raiseSide ~14)
//   - arms straight overhead via raiseSide + twist
//   - intense effort: open mouth (render:'painted'), fists, forward gaze
//   - singlet: F.clothing.top + F.clothing.pants({length:'briefs'})
//
// Paint regions: skin, eyes, iris, pupil, lids, teeth, lips,
//                singlet, barbell, plates, hair, base

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — heroic stocky athlete, 7 heads, arms straight overhead.
//    twist ~90 rotates the elbow-curl plane so fists point UP on raised arms.
//    Wide stable stance for the clean & jerk lockout.
const rig = F.rig({
  height: 52,
  headsTall: 7,
  build: 'stocky',
  sex: 'male',
  muscle: 0.9,
  pose: {
    arms: { raiseSide: 170, bend: 8, twist: 90 },
    legL: { raiseSide: 14 },
    legR: { raiseSide: 14 },
    head: { pitch: 0, yaw: 0 },
    spine: { lean: 2 },
  },
});
const j = rig.joints;
const r = rig.r;

// 2. HEAD + FACE — intense effort, painted open mouth (print-safe)
const mouthOpts = {
  style: 'open',
  open: 0.50,
  expression: 'neutral',
  render: 'painted',
  teeth: 'both',
  width: r.head * 0.48,
};
const head = F.head(rig, { faceShape: 'square', jaw: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: false,   // mouthAccents handles painted mouth at top level
  nose: { type: 'straight', tipRadius: r.head * 0.11, bridge: 1.0 },
  ears: { size: r.head * 0.23 },
  brows: { thickness: 1.2, lift: 0.05 },
});
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.16,
  lids: 'upper',
  gaze: 'middle',
});
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — fists for gripping the barbell
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SINGLET — athletic singlet (sleeveless top + briefs as one piece)
const singletTop = F.clothing.top(rig, {
  sleeve: 'none',
  thickness: r.chestX * 0.12,
});
const singletBottom = F.clothing.pants(rig, {
  length: 'briefs',
  rise: 'high',
  leg: 'slim',
  thickness: r.upperLeg * 0.14,
});
const singlet = sdf.union(singletTop, singletBottom).label('singlet');

// 5. HAIR — short crop
const hair = F.hair(rig, { style: 'short', volume: 0.8 }).label('hair');

// 6. BARBELL — spans both grip cups via F.spanGrips.
//    The bar runs cup-to-cup through both raised fists overhead.
const s = F.spanGrips(rig.grip.L, rig.grip.R);

const barR = r.hand * 0.22;
const bar = sdf.capsule(s.a, s.b, barR).label('barbell');

// Weight plates — proportional to the figure (not too large).
// Plates extend past each grip cup along the bar axis.
// Bar runs roughly along the figure's X axis (left-right) for overhead arms.
// Compute rotation angles to align cylinder Z-axis to bar axis s.axis.
const ax = s.axis;
const rotY = Math.atan2(ax[0], ax[2]) * 180 / Math.PI;
const rotX = -Math.asin(Math.max(-1, Math.min(1, ax[1]))) * 180 / Math.PI;

// Plate dimensions: realistic scale (~1.5x hand radius = modest bumper plate)
const plateR = r.hand * 1.55;
const plateThick = r.hand * 0.50;
const plateGap = r.hand * 0.20;   // gap between plate edge and grip cup

function makePlateAt(pt, outDir) {
  // outDir: +1 = extend past s.b (right side), -1 = extend inward from s.a (left side)
  const offset = outDir * (plateGap + plateThick * 0.5);
  const center = [
    pt[0] + s.axis[0] * offset,
    pt[1] + s.axis[1] * offset,
    pt[2] + s.axis[2] * offset,
  ];
  return sdf.cylinder(plateR, plateThick).rotate(rotX, rotY, 0).translate(center);
}

// One plate per side (two total)
const plateLeft  = makePlateAt(s.a, -1);   // past left grip
const plateRight = makePlateAt(s.b,  1);   // past right grip
const plates = sdf.union(plateLeft, plateRight).label('plates');

// 7. BASE
const base = F.base(rig, { radius: rig.opts.height * 0.30 }).label('base');

// 8. Hard-union all regions and build. Raise edgeLength to 0.55 to stay under
//    the ~200k triangle budget while keeping clean feature resolution.
return sdf.union(skin, eyes, mouthParts, singlet, hair, bar, plates, base)
  .build({ edgeLength: 0.62, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
