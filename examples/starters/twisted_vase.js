// Twisted Vase — one of the rotating manifold-js starters. A single, self-colored
// model: the fluted body, the foot, and the rim are each wrapped with
// api.label(shape, name, { color }) so they render and export in their own
// colors with no separate paint step. Showcases a 2D profile pushed through a
// twisting, tapering extrude (CrossSection.extrude) — manifold's quick route to
// an organic, spiralled form — capped by a welded foot and rim.
//
// Z-up, mm. The foot and rim overlap the body so the unions weld. Edit a value
// (try the twist angle or the flute count) and re-run.
const { CrossSection, Manifold } = api;

// Fluted profile: a core circle ringed by small lobes. Extruded with twist, the
// lobes spiral up the wall.
const FLUTES = 7;
let profile = CrossSection.circle(7, 64);
for (let i = 0; i < FLUTES; i++) {
  const a = (i / FLUTES) * 2 * Math.PI;
  profile = profile.add(CrossSection.circle(2.2, 24).translate([7 * Math.cos(a), 7 * Math.sin(a)]));
}

// Twist + taper the profile into the vase wall (160° over its height, narrowing
// to 70% at the top).
const body = api.label(profile.extrude(34, 96, 160, 0.7), 'body', { color: '#2f9e8f' });

// Foot — a short, slightly wider disc the vase stands on (underside at z = 0),
// dipping into the body so they weld.
const foot = api.label(Manifold.cylinder(3, 9, 8, 96), 'foot', { color: '#d9a441' });

// Rim — a band wrapping the lip, sunk a little into the top of the body.
const rim = api.label(Manifold.cylinder(2.5, 6.6, 6.6, 96).translate([0, 0, 32]), 'rim', { color: '#d9a441' });

return Manifold.union([foot, body, rim]);
