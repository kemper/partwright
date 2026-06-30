// Dummy 13 — NECK bridge (1 of 28 frame parts).
//
// A double-ball "bridge" piece — ball on each end, short stem between. Connects
// the head's neck socket to the chest's neck socket. Same architecture as the
// other bridge pieces (hip/shoulder, knee/elbow, ankle, clavicle) — just
// different stem length. Compatible with soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Ball Ø' },
});

const neck = api.dummy13.neckBridge({ spec: { ballD: p.ballD } });
return api.label(neck, 'neck', { color: '#c97b6e' });
