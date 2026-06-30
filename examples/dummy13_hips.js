// Dummy 13 — HIPS (1 of 28 frame parts).
//
// Horizontal flat bar with 3 sockets in the top: left hip, waist (centre),
// right hip. Hip-to-hip distance is 16mm (sockets at x=±8). Compatible with
// soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const hips = api.dummy13.hipsPart({ spec: { ballD: p.ballD } });
return api.label(hips, 'hips', { color: '#6b8db4' });
