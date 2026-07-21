// Spiky massage ball — a ~40mm sphere densely covered in friendly,
// rounded-tip spikes via api.scatter, two-tone painted in code (teal ball,
// pale mint spikes) so it looks good straight out of the catalog.
const { Manifold } = api;

const R = 20; // ball radius -> 40 unit diameter

// 1) The base ball, labelled + colored so it reads under the spikes.
const ball = api.label(Manifold.sphere(R, 96), 'ball', { color: '#0e7d72' });

// 2) One spike instance, authored with its base at the origin and
//    "up" = +Z: a short cone tapering from a wide foot to a narrow neck,
//    capped with a small sphere so the tip reads rounded/friendly rather
//    than pointy. Built from a cylinder(rBottom, rTop) frustum + a sphere cap.
const footR = 2.1;
const tipR = 0.55;
const spikeHeight = 6.5;
const spike = Manifold.cylinder(spikeHeight, footR, tipR, 24)
  .add(Manifold.sphere(tipR, 24).translate([0, 0, spikeHeight]));

// 3) Scatter spikes all over the sphere, normal-aligned, slightly varied
//    scale, sunk in by a negative offset so the union actually fuses.
const spikesRaw = api.scatter(ball, spike, {
  count: 170,
  seed: 7,
  alignToNormal: true,
  spin: true,
  scale: [0.8, 1.25],
  offset: -1.2,
  minSpacing: 3.2,
});
const spikes = api.label(spikesRaw, 'spikes', { color: '#8fe3d1' });

// 4) Union + verify it fuses into one printable solid.
const model = api.expectUnion([ball, spikes], { expectComponents: 1 });

return model;
