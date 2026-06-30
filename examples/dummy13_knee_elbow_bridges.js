// Dummy 13 — KNEE/ELBOW bridges (4 of 28 frame parts).
//
// Universal joint piece used at both knees AND both elbows (4 copies per
// figure). Double-ball with a slightly shorter stem than the hip/shoulder
// bridges. Print plate has 4 instances side by side. Compatible with
// soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Ball Ø' },
});

const part = api.dummy13.kneeElbowBridge({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 4, 6);
return api.label(plate, 'kneeElbow', { color: '#c97b6e' });
