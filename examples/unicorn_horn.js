// Unicorn horn — the directional-surface primitive doing a HELIX that spirals
// up a tapering, gently-curved path. One sdf.tube call; taper shrinks the
// radius toward the tip while the spiral stays locked to the path frame.
const { sdf } = api;

const horn = sdf.tube(
  [[0, 0, 0], [0, 0, 10], [3, 0, 45], [5, 0, 82]],   // base → gentle forward curve → tip
  8,
  { profile: 'helix', count: 2, turns: 6, depth: 1.5, taper: 0.12 },
).label('horn');

const model = horn.build({ edgeLength: 0.45 });
api.paint.label({ label: 'horn', color: '#e9d27a' });
return model;
