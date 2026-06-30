// Dummy 13 — HEAD (1 of 28 frame parts).
//
// A rounded head with a 6mm socket cup underneath that snaps onto the neck
// bridge's top ball. Compatible with soozafone's official Dummy 13 v1.0 frame
// (https://www.printables.com/model/981111, CC-BY 4.0) — same 6mm socket
// cavity, slightly tighter ball (5.7mm default vs ~5.0mm stock) for stronger
// pose hold. Set `ballD: 5.0` to swap for stock-spec compatibility.
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Ball Ø (mate with neck-bridge)' },
  style: { type: 'select', default: 'box', options: ['box', 'sphere'], label: 'Head style' },
});

const head = api.dummy13.headPart({ spec: { ballD: p.ballD }, style: p.style });
return api.label(head, 'head', { color: '#d9b48f' });
