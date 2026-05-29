// Wall clock face — circular dial, 12 hour markers (longer at cardinals),
// 60 minute ticks, hour + minute hands posed at 10:10, central pin.
const { Manifold, CrossSection } = api;

// --- Parameters (mm-ish, units arbitrary) ---
const dialR     = 50;    // 100 mm diameter
const dialH     = 4;     // dial thickness
const dialTop   = dialH; // z = 4 sits on top of dial
// Everything that rides on top of the dial is sunk by this much so the
// boolean union has guaranteed volumetric overlap (flush touches are fragile).
const sink      = 0.6;

// Hour markers: short rectangular pegs near the rim.
const hourW = 2.6, hourL = 7,  hourH = 1.2;
const hourR = 42;        // radial distance from center to marker center
// Cardinal (12/3/6/9) markers: longer and a touch wider.
const cardW = 3.4, cardL = 11, cardH = 1.4;
const cardR = 40;        // pulled in slightly so they read as longer

// Minute ticks: thin slivers between hour markers.
const tickW = 0.9, tickL = 3, tickH = 0.8;
const tickR = 46;

// Hands.
const hourHandL = 28, hourHandW = 3.0, hourHandT = 1.2;  // length, width, thickness
const minHandL  = 40, minHandW  = 2.2, minHandT  = 1.2;

// Central pin.
const pinR = 2.4, pinH = 3.5;

// --- Dial: a low cylinder centered at origin ---
// Manifold.cylinder(h, rLo, rHi=rLo). Smooth dial inherits the user's
// circular-segment preset (omit the explicit count).
const dial = Manifold.cylinder(dialH, dialR, dialR);

// --- Hour markers ---
// Build ONE marker at the origin, sitting on top of the dial. The `radius`
// shortcut on circularPattern pushes it out by `hourR` before rotating —
// no need to pre-translate to the rim ourselves.
//
// Note: circularPattern's `radius` shortcut pushes along +X (the canonical
// "out" direction for a Z-axis rotation), so the first copy lands at +X
// (the "3 o'clock" position). The clock numerals at 12-3-6-9 read fine
// either way, since the layout is symmetric under any 90° rotation.
const hourMarker = Manifold.cube([hourW, hourL, hourH], true)
  .translate([0, 0, dialTop + hourH / 2 - sink]);
const hourMarkers = api.circularPattern(hourMarker, 12, { radius: hourR });

// --- Cardinal markers (longer/thicker, at 12 / 3 / 6 / 9) ---
const cardMarker = Manifold.cube([cardW, cardL, cardH], true)
  .translate([0, 0, dialTop + cardH / 2 - sink]);
const cardMarkers = api.circularPattern(cardMarker, 4, { radius: cardR });

// --- Minute ticks ---
// 60 thin ticks. The 12 that line up with hour markers volumetrically overlap them
// (tick at r=46 is just outside the hour pegs that end near r≈45.5) so they'll
// simply union into the same hour-marker post — no extra components.
const tick = Manifold.cube([tickW, tickL, tickH], true)
  .translate([0, 0, dialTop + tickH / 2 - sink]);
const ticks = api.circularPattern(tick, 60, { radius: tickR });

// --- Hands, posed for the classic 10:10 watch-ad pose ---
// 12 o'clock = +Y. Clock face spins CW; in Z-up CCW math:
//   - Hour at "10" is 2 hours CCW from 12 ⇒ +60°.
//   - Minute at "10 min" (= numeral 2) is 2 numerals CW from 12 ⇒ -60°.
// Each hand is modeled along +Y, pivot at origin, then rotated about Z.
function makeHand(length, width, thickness) {
  // Tapered rectangle in the XY plane via hull of two boxes — thin at the tip.
  const root = Manifold.cube([width,        width, thickness], true)
    .translate([0, width / 2, thickness / 2]);
  const tip = Manifold.cube([width * 0.45,  width, thickness], true)
    .translate([0, length - width / 2, thickness / 2]);
  return Manifold.hull([root, tip]);
}

// Both hands share a Z slab sunk slightly into the dial — they overlap each
// other at the center hub (their root boxes both straddle the origin), which
// unions cleanly. The pin hides the joint.
const hourHand = makeHand(hourHandL, hourHandW, hourHandT)
  .translate([0, 0, dialTop - sink])       // overlaps dial top
  .rotate([0, 0, 60]);                     // → "10"
const minuteHand = makeHand(minHandL, minHandW, minHandT)
  .translate([0, 0, dialTop - sink])       // same slab; meets hour hand at hub
  .rotate([0, 0, -60]);                    // → "2" (= 10 minutes past)

// --- Central pin: hides where the hands cross. ---
// Centered on the dial via alignTo (x/y center). The pin's base is sunk into
// the hand slab so it fuses with both hands volumetrically.
let pin = Manifold.cylinder(pinH, pinR, pinR * 0.85);
pin = api.alignTo(pin, dial, { x: 'center', y: 'center' })
        .translate([0, 0, dialTop - sink]);   // base inside the hand slab

// --- Final assembly + sanity check ---
// Everything touches the dial (or stacks on something that does), so the whole
// thing must come out as a single connected component.
const clock = api.expectUnion(
  [dial, hourMarkers, cardMarkers, ticks, hourHand, minuteHand, pin],
  { expectComponents: 1 },
);

return clock;
