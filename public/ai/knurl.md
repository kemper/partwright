# Knurling & grips (`api.knurl`)

**Functional** grip geometry — the diamond cross-hatch on a thumbscrew, the
straight splines on a knob, the finger ridges on a handle. Available in the
**manifold-js** engine as `api.knurl.*`. This is distinct from the decorative
`surface` modifier textures: knurls are real load-bearing ridges sized for grip.

All dimensions are millimetres, Z-up. Every builder returns a knurled
**cylinder** centred on the origin, extruded +Z from `z=0` to `z=height`.
Ridges peak at `diameter/2`; troughs sit `depth` below — so the knurl's **outer
diameter is `diameter`**. UNION it onto a knob/handle core, or pass a `bore` to
use it as a grip sleeve directly. Builders **throw a clear error** on bad input.

## Diamond knurl

The classic cross-hatch. Built as the intersection of two opposite-handed
helical ridge families, so the diamonds are exact and the result is one clean
manifold.

```js
return api.knurl.diamond({ diameter: 24, height: 18, pitch: 2.4, bore: 6 });
```

| key | meaning | default |
|---|---|---|
| `diameter` | outer diameter (ridge peaks) — **required** | — |
| `height` | extrusion height along +Z — **required** | — |
| `pitch` | circumferential ridge spacing (mm) → ridge count | `2` |
| `depth` | ridge depth (peak − trough) | ~4% of dia, 0.4–1.5 |
| `aspect` | diamond aspect (`1` = square, `>1` taller, `<1` wider) | `1` |
| `bore` | centre through-hole **diameter** (subtracted) | none |
| `segments` | base curve resolution | engine default |

## Straight knurl

Vertical splines/ridges running the full height — for a press-fit insert or an
axial grip. A single un-twisted extrude.

```js
return api.knurl.straight({ diameter: 24, height: 18, pitch: 2.4, bore: 6 });
```

Options: `diameter`, `height` (**required**), `pitch` (default `2`), `depth`,
`bore`, `segments` — same meaning as `diamond`.

## Grip ribs

Horizontal rounded rings stacked up the height — finger grips on a cap or
handle. A revolve of a scalloped profile.

```js
return api.knurl.ribs({ diameter: 24, height: 24, pitch: 3, bore: 6 });
```

| key | meaning | default |
|---|---|---|
| `diameter` | outer diameter — **required** | — |
| `height` | total height — **required** | — |
| `pitch` | axial rib spacing (mm) | `2.5` |
| `count` | rib count (overrides `pitch` if given) | from `pitch` |
| `depth` | rib depth | ~4% of dia, 0.4–1.5 |
| `bore` | centre through-hole diameter | none |

## Building a knurled knob

```js
const { knurl } = api;
// a thumbwheel: diamond grip ring + a solid hub the screw threads into
const grip = knurl.diamond({ diameter: 22, height: 8, pitch: 2 });
const hub  = api.Manifold.cylinder(8, 11, 11);   // fills the knurl's root so it's solid
return grip.add(hub);
```

## Tips

- **Pitch vs printability:** very fine `pitch` (< ~1.5 mm) makes ridges thinner
  than an FDM extrusion width — the preview warns about sub-0.4 mm detail. Bump
  `pitch`/`depth`, or print in resin.
- A knurl with a `bore` reports `genus: 1` (the through-hole) — expected, like a
  bored gear, not an error.
- Knurls are returned with their root as a **solid** core (the ridges sit on a
  full cylinder), so unioning onto a same-diameter core is seamless.
