// Dummy 13 — UPPER ARMS (2 parts: left + right).
//
// A pair of identical upper-arm segments printed side by side. Each has a
// shoulder socket on the bottom (snaps onto the torso shoulder-ball) and an
// elbow ball on top (the forearm cup snaps onto this).
//
// Note: the parts are mirror-symmetric, so left == right at the engine level.
// You print two of these and use them on either side.
//
// Print orientation: as built — cup-down, ball-up. The narrow socket base is
// stable on the bed; the small elbow sphere self-supports.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const arm = api.dummy13.upperArmPart({ spec: { height: p.height } });
const labelled = api.label(arm, 'upperArm', { color: '#c97b6e' });

// Lay two side by side along Y so the catalog tile shows the pair.
const gap = p.height * 0.045;
return labelled.translate([0, -gap, 0]).add(labelled.translate([0, gap, 0]));
