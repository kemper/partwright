// Dummy 13 — UPPER TORSO (1 part).
//
// Chest box with a waist socket on the bottom (snaps over the hips' waist-ball),
// a neck ball rising from the top centre (the head's cup snaps onto this), and
// a shoulder ball on each side (the upper-arms snap onto these). Print
// orientation: as built — neck-ball up, socket cup down, shoulder-balls
// horizontal. Sphere overhangs on the shoulder balls are small enough to
// self-support; if pose-holding is loose, drop the `clearance` to 0.15.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const torso = api.dummy13.torsoUpperPart({
  spec: { height: p.height },
});

return api.label(torso, 'torsoUpper', { color: '#6b8db4' });
