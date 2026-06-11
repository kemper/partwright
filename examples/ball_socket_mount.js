// Ball-and-socket articulating mount — a swivel for small cameras, sensors,
// phone cradles, or desk gadgets. The ball half rises on a filleted stem from a
// screw-down base plate; the socket half is a housing that holds the ball.
//
// `retention` is the key choice — a plain solid socket can't be both easy to
// insert and hold a pose, so pick how the ball is gripped:
//   • friction (default) — the rim is split into springy fingers that splay on
//     insertion (so the stem survives) then clamp the ball, holding the angle
//     you set it to. No hardware.
//   • clamp — a pinch slot + bored lugs take an M3 screw; the ball drops in
//     free and you tighten the screw to set friction up to a hard lock.
//   • snap — the legacy solid lip: captive but swivels freely (no friction).
// Both halves are laid side by side for printing — built with joints.ballSocket.
const { Manifold, joints, fasteners } = api;

const p = api.params({
  ballD:        { type: 'number', default: 14,   min: 6,    max: 30,   step: 1,    unit: 'mm', label: 'Ball diameter' },
  retention:    { type: 'select', default: 'friction', options: ['friction', 'clamp', 'snap'],  label: 'Retention' },
  openingRatio: { type: 'number', default: 0.86, min: 0.7,  max: 0.95, step: 0.01,             label: 'Lip grip (opening ratio)' },
  clearance:    { type: 'number', default: 0.25, min: 0,    max: 0.5,  step: 0.05, unit: 'mm', label: 'Articulation gap' },
  slots:        { type: 'number', default: 4,    min: 2,    max: 8,    step: 1,                label: 'Friction fingers' },
  stemD:        { type: 'number', default: 8,    min: 3,    max: 12,   step: 0.5,  unit: 'mm', label: 'Stem diameter' },
  stemL:        { type: 'number', default: 10,   min: 4,    max: 30,   step: 1,    unit: 'mm', label: 'Stem length' },
  screwSize:    { type: 'select', default: 'M3', options: ['M2.5', 'M3', 'M4'],                label: 'Mount screws' },
});

const plateT = 3;

// The stem must stay narrower than the socket mouth (openingRatio · ballD) or
// the ball can't articulate — clamp rather than error so no slider combination
// can fail a run (same spirit as the hinge's odd-knuckle coercion).
const stemD = Math.min(p.stemD, p.openingRatio * p.ballD - 0.6);

const { ball, socket } = joints.ballSocket({
  ballD: p.ballD,
  retention: p.retention,
  clearance: p.clearance,
  openingRatio: p.openingRatio,
  slots: p.slots,
  stemD,
  stemL: p.stemL,
  baseD: p.ballD * 1.4,
  baseT: plateT, // ball's own disc merges flush into its mounting plate
});

// ---- Mounting plates: rounded bars with countersunk screw holes ----
// Each half stands on a plate you can screw to whatever it articulates between.
const plateW = p.ballD * 1.6 + 4;          // across the screw axis
const screwPitch = p.ballD * 1.6 + 10;     // hole-to-hole distance
const plateL = screwPitch + 9;             // along the screw axis
function mountPlate() {
  const endR = plateW / 2;
  let plate = Manifold.cube([plateL - 2 * endR, plateW, plateT], false)
    .translate([-(plateL / 2 - endR), -plateW / 2, 0]);
  for (const ex of [-(plateL / 2 - endR), plateL / 2 - endR]) {
    plate = plate.add(Manifold.cylinder(plateT, endR, endR, 48).translate([ex, 0, 0]));
  }
  for (const sx of [-screwPitch / 2, screwPitch / 2]) {
    const hole = fasteners.screwHole({ size: p.screwSize, length: plateT, head: 'countersunk', through: true })
      .translate([sx, 0, plateT]);
    plate = plate.subtract(hole);
  }
  return plate;
}

// Ball half: plate + the ballSocket ball piece (disc base sunk flush).
const ballHalf = mountPlate().add(ball);

// Socket half: plate + housing, sunk 0.5mm so the union is volumetric.
const socketHalf = mountPlate().add(socket.translate([0, 0, plateT - 0.5]));

// Lay the two halves side by side for printing.
const gap = plateL / 2 + 8;
return api.label(ballHalf.translate([-gap, 0, 0]), 'ball half', { color: '#5a9367' })
  .add(api.label(socketHalf.translate([gap, 0, 0]), 'socket half', { color: '#7a6fb0' }));
