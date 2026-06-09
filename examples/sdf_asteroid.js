// Craggy asteroid — a sphere pushed in and out by an fBm noise field.
// `sdf.noise()` returns a seeded (x,y,z)=>number value field; `.displace(
// amount, field)` moves the surface by up to `amount` world units along
// it. This is the stochastic cousin of twist/bend/taper — the organic
// shape crisp SDF/CSG can't reach.
//
// Note: keep the amplitude well under the noise wavelength (~1/frequency).
// Smooth (non-ridged) fBm at a moderate amplitude stays a single watertight
// solid; cranking the amplitude — or using ridged noise — eventually pinches
// off floating islands (raises componentCount), which won't print cleanly.
const { sdf } = api;

const rock = sdf.noise({ seed: 7, frequency: 0.05, octaves: 4, gain: 0.5 });

const body = sdf.sphere(30)
  .displace(8, rock)    // boulders/craters up to 8 units on a 30-radius ball
  .label('rock');

// edgeLength fine enough to resolve the noise detail without aliasing it away.
return body.build({ edgeLength: 0.9 });
