// Dummy 13 — HIP/SHOULDER bridges (4 of 28 frame parts).
//
// Soozafone's UNIVERSAL joint piece — the same part serves both hips AND both
// shoulders (4 copies total per figure). Print plate has 4 instances side by
// side. Double-ball with a short stem; balls snap into the matching 6mm
// sockets on the hips part, the chest part, the thigh, or the upper arm.
//
// This is the design genius of Dummy 13: every socket is exactly 6mm, so the
// same small bridge piece works at 4 joint positions. Compatible with
// soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Ball Ø' },
});

const part = api.dummy13.hipShoulderBridge({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 4, 8);
return api.label(plate, 'hipShoulder', { color: '#c97b6e' });
