// Dummy 13 — CLAVICLES (2 of 28 frame parts).
//
// A pair of double-ball bridge pieces connecting the chest's shoulder sockets
// out to the shoulder joint (the hip/shoulder bridge then connects clavicle to
// upper arm). Slightly longer stem than the hip/shoulder bridge so the arms
// hang off the chest with proper width. Compatible with soozafone's Dummy 13
// v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Ball Ø' },
});

const part = api.dummy13.claviclePart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 8);
return api.label(plate, 'clavicle', { color: '#c97b6e' });
