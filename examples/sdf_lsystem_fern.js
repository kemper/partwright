// L-system fern — the textbook Lindenmayer "plant" grammar, grown into
// real 3D-printable geometry. An L-system rewrites a short axiom into a
// long string of turtle commands; `sdf.lsystem()` walks that string laying
// down capsule segments, then meshes them through levelSet. This is the
// generative-grammar counterpart to SDF primitives: instead of placing
// each branch by hand, you describe how the plant GROWS.
//
//   X  growth point (no geometry)     F  draw a segment
//   +- turn        [ ] branch (push/pop the turtle)
//
// Only +/- are used, so the fern stays in one plane — a flat frond.
const { sdf } = api;

const fern = sdf.lsystem({
  axiom: 'X',
  rules: {
    X: 'F+[[X]-X]-F[-FX]+X',
    F: 'FF',
  },
  iterations: 4,
  angle: 25,
  length: 2.4,
  radius: 0.85,
  radiusScale: 0.92,  // taper toward the tips
  label: 'plant',
});

return fern.build({ edgeLength: 0.42 });
