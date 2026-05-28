// Smooth-blended handle — the canonical case for api.sdf.
// A cylinder grip with a spherical knob, joined by a smooth fillet
// (smoothUnion's k controls the fillet radius). In mesh CSG you'd
// have to engineer this fillet by hand; here it falls out of one call.
const { sdf } = api;

const grip = sdf.cylinder(3, 25);                       // radius 3, height 25
const knob = sdf.sphere(5).translate(0, 0, 15);         // ball at the top
const cap  = sdf.sphere(4).translate(0, 0, -14);        // ball at the bottom

return grip
  .smoothUnion(knob, 2)
  .smoothUnion(cap, 1.5)
  .build({ edgeLength: 0.4 });
