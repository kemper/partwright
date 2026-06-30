// Dummy 13 — CHEST (1 of 28 frame parts).
//
// Flat-bar chest with 3 sockets: two shoulder sockets on top (±X corners) that
// receive the clavicle bridges, and one socket on the bottom for the abdomen
// bridge. All sockets are the standard 6mm cavity. Compatible with soozafone's
// official Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const chest = api.dummy13.chestPart({ spec: { ballD: p.ballD } });
return api.label(chest, 'chest', { color: '#6b8db4' });
