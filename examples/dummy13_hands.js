// Dummy 13 — HANDS (2 of 28 frame parts).
//
// A pair of simple paddle hands. Each has a 6mm wrist socket on top (mates
// with the forearm's wrist socket via a wrist-ball — actually in soozafone's
// design the hand carries a wrist ball; here we use a socket for consistency,
// requiring an additional small ball-bridge piece between hand and forearm).
// Swap this for any fancier hand: open, grip, fist — the wrist socket spec is
// the only interop requirement. Compatible with soozafone's Dummy 13 v1.0
// (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const part = api.dummy13.handPart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 16);
return api.label(plate, 'hand', { color: '#d9b48f' });
