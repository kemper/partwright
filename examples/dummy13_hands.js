// Dummy 13 — HANDS (2 parts: left + right).
//
// A pair of simple paddle-style hands; each has a wrist socket that snaps
// onto the forearm's wrist-ball. The hand body is a flat slab — readable at
// this scale and easy to swap for a fancier hand later (any part with a
// matching wrist socket fits the rig).
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const hand = api.dummy13.handPart({ spec: { height: p.height } });
const labelled = api.label(hand, 'hand', { color: '#d9b48f' });

const gap = p.height * 0.04;
return labelled.translate([0, -gap, 0]).add(labelled.translate([0, gap, 0]));
