# Headform — a metric head for wearable fit

`api.headform(opts?)` returns a **real-size adult head in millimetres**: a smooth,
featureless mannequin head (skull, brow, eyes, nose, cheekbones, jaw, ears, neck)
built from survey means (see **Data** below). Use it to design things a person wears, such as masks, helmets, glasses,
headphones, hats and visors, and to check they fit.

It's a fit proxy, not a portrait: the presets land within a few percent of
their measurements, and the details are deliberately plain. `api.headform` is
available in manifold-js (JavaScript) sessions. For a stylised character, use the figure rig
(`api.sdf.figure`, `/ai/figure.md`) instead. `F.head` / `F.onFace` there are
unitless.

## The frame

| | |
|---|---|
| origin | midway between the two **tragions** (the notches in front of the ear canals) |
| XY plane | the **Frankfort horizontal**: ear canal ↔ lowest point of the eye socket |
| −Y | the face points this way (the app's Front view) |
| +X | the wearer's **left** |
| +Z | up |

So the head sits with its ears on the origin and its face toward the Front camera.
The neck runs down to about z = −1.6 × face height (≈ −190 mm).

## Options

```js
api.headform({
  size: 'M',            // 'S' ≈ 5th, 'M' ≈ 50th, 'L' ≈ 95th percentile (uniform scale)
  sex: 'neutral',       // 'neutral' | 'female' | 'male'  (the base measurements)
  neck: true,           // false: just the head (cheaper; best for masks)
  edgeLength: 3,        // mesh edge length, mm, 1–20 (smaller = smoother, slower)
  // Any measurement below overrides the preset. `circumference` instead rescales
  // the whole head (in place of `size`); the others change one dimension each.
  circumference, length, breadth, bitragionBreadth, faceHeight, pupillaryDistance,
  vertexHeight, bizygomaticBreadth, bigonialBreadth, neckCircumference,
  noseBreadth, noseProtrusion, noseLength,
});
```

| Measurement | What it is | male | female | neutral M | source |
|---|---|---|---|---|---|
| `circumference` | head girth just above the brow | 574.4 | 561.1 | 567.8 | ANSUR II |
| `length` | glabella (between the brows) to the back of the head | 199.5 | 189.8 | 194.7 | ANSUR II |
| `breadth` | widest skull breadth, above the ears | 154.3 | 147.8 | 151.1 | ANSUR II |
| `faceHeight` | nose bridge (sellion) to the bottom of the chin (menton) | 122.6 | 113.1 | 117.9 | ANSUR II |
| `pupillaryDistance` | pupil to pupil | 64.0 | 61.7 | 62.9 | ANSUR II |
| `vertexHeight` | top of the head above the ear notches | 131.1 | 126.5 | 128.8 | ANSUR II |
| `bizygomaticBreadth` | cheekbone to cheekbone | 142.6 | 133.8 | 138.2 | ANSUR II |
| `neckCircumference` | neck girth (the neck is a cylinder of this girth) | 397.6 | 329.8 | 363.7 | ANSUR II |
| `bigonialBreadth` | jaw angle to jaw angle | 120.4 | 110.1 | 115.3 | NIOSH 2003 |
| `noseBreadth` | nose wing to nose wing (alare to alare) | 36.6 | 33.2 | 34.9 | NIOSH 2003 |
| `noseProtrusion` | nose tip to where the nose meets the lip (pronasale–subnasale) | 21.1 | 19.8 | 20.5 | NIOSH 2003 |
| `noseLength` | nose bridge to where the nose meets the lip (sellion–subnasale) | 52.0 | 48.2 | 50.1 | NIOSH 2003 |
| `bitragionBreadth` | ear notch to ear notch | 149.7 | 143.4 | 146.6 | derived: 0.97 × `breadth` |

All values in mm. Ear-to-ear breadth has no source in either survey: its default
follows the skull's side at ear level, and you can override it if you know it. A
few impossible combinations are rejected (pupils wider than the cheekbones, ears
wider than the skull, jaw wider than the cheekbones, a nose wider than the
pupils or longer than 0.6 × the face), and so are measurements too far apart to
make one surface.

### Data

- **ANSUR II**: the 2012 US Army anthropometric survey, public data (4,082
  men, 1,986 women). Means computed from `ANSUR II MALE/FEMALE Public.csv`.
- **NIOSH 2003**: the head-and-face survey of US respirator users, built for
  respirator fit (Zhuang & Bradtmiller, *J. Occup. Environ. Hyg.* 2:567–576,
  2005, Table VI; 2,543 men, 1,454 women). It supplies the nose and jaw
  measurements, which ANSUR II doesn't take.
- `neutral` is the mean of the male and female values. The size presets scale
  them by ±5%, which spans roughly the 5th to 95th percentile of head
  circumference in both surveys.

Both are US adult samples. Faces vary by population (e.g. NIOSH's survey of
Chinese workers found shorter, wider faces with less nose protrusion), so
override measurements when you're designing for a specific group.

**Requested vs achieved.** The shape is a smooth blend, so the mesh doesn't hit
every requested number exactly, and overriding one measurement moves others
(a longer head is also a bigger girth). `landmarks().achieved` reports what the
built head actually measures. Size a hat band, liner or strap from
`achieved`, not from `measurements`.

## Landmarks

```js
const lm = api.headform.landmarks({ size: 'L' });   // pure data — no geometry built
lm.points.pupilL      // [33, -87.6, 14.9]  — on the surface, mm
lm.measurements       // what you asked for (preset + overrides)
lm.achieved           // what the built head measures: girth above the brow, length, ear to ear, nose, …
lm.frame              // the frame, in words
```

Every point is **on the proxy's surface** (snapped there, so a part placed on one
touches the skin). Pass the same options to `landmarks` as to `headform`.

| Point | Where |
|---|---|
| `tragionL` / `tragionR` | ear notch (left is +X) |
| `vertex` | top of the head |
| `glabella` | between the brows, most forward point of the forehead |
| `opisthocranion` | back of the head |
| `sellion` | deepest point of the nose bridge (where glasses rest) |
| `pupilL` / `pupilR` | front of each eye |
| `pronasale` | nose tip |
| `subnasale` | where the nose meets the upper lip |
| `alareL` / `alareR` | nose wings, widest point (where a mask's nose bridge seals) |
| `stomion` | mouth (between the lips) |
| `menton` | bottom of the chin |
| `zygionL` / `zygionR` | cheekbones, widest point |
| `gonionL` / `gonionR` | jaw angles |

## Recipes

**Check a wearable against it.** Show the head as reference geometry, so it's
drawn in the viewport, in `renderView` / `renderViews` images (translucent,
depth-tested: anything poking through the part shows), and as a dashed outline
in `renderSection`:

```js
await partwright.setReferenceGeometry('return api.headform({ neck: false });');
await partwright.renderViews();                                // part + head ghost
partwright.renderSection({ axis: 'y', offset: -60 });          // gap at the cheeks
```

**A mask with a set clearance.** Offset the skin by the clearance, then grow a
wall outside it (`side: 'outside'` keeps the inner surface exactly on the offset
skin), then cut the back away and open the eyes:

```js
const { Manifold } = api;
const head = api.headform({ neck: false });
const lm = api.headform.landmarks({ neck: false });
const skin = api.offset(head, { distance: 2, resolution: 320 });  // 2 mm clearance
let mask = api.shell(skin, { thickness: 2.5, side: 'outside' });
mask = mask.subtract(Manifold.cube([400, 400, 400], true).translate([0, 200 - 30, 0]));  // keep y < −30
for (const p of [lm.points.pupilL, lm.points.pupilR]) {
  mask = mask.subtract(Manifold.cylinder(80, 16, 16, 48, true).rotate([90, 0, 0]).translate(p));
}
return mask;
```

Then check it clears the face: `api.intersects(mask, head)` must be `false`,
and `api.intersects(mask, api.offset(head, { distance: 1.5, resolution: 320 }))`
false means at least 1.5 mm everywhere.

`api.offset` and `api.shell` work on a lattice, so their smallest distance is
about 1.5 × the model's span ÷ `resolution`. For a head without the neck that's
about 2.1 mm at the default `resolution: 192` and about 1.3 mm at the maximum,
320. Pass `resolution: 320` for clearances under ~2 mm, and use `neck: false`
(the neck makes the span bigger).

**It's slow:** the recipe takes about a minute in the browser, mostly the
fine-lattice offset and shell. While you iterate on the mask's outline, cut
and holes, save the shell as a version once (or use the default resolution
and a 2.5 mm clearance), and do the fine pass at the end.

**Glasses.** Put the lens centres about 12 mm in front of the pupils (the vertex
distance), the bridge on the `sellion`, and run the temple arms back to just
above each `tragion`:

```js
const lm = api.headform.landmarks().points;
const lensL = [lm.pupilL[0], lm.pupilL[1] - 12, lm.pupilL[2]];
const lensR = [lm.pupilR[0], lm.pupilR[1] - 12, lm.pupilR[2]];
```

**Scale an imported head sculpt to real size.** Sculpts are rarely metric.
Measure the import's ear-to-ear (or glabella-to-back) span and scale it to the
headform's `bitragionBreadth` (or `length`) before designing around it. Then
`setReferenceGeometry('return api.headform();')` overlays the two, which shows
whether the face proportions are plausible.
