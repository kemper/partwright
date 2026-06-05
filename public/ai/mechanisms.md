# Print-in-place mechanisms & multi-part assemblies

How to model a **single object that contains multiple separate, moving parts** —
a screw that twists, a spinner that spins, a hinge that folds, a captive ball,
a slider — all printed together in one job (FDM "print-in-place"). The trick is
geometric: the parts share one model but are separated by a **clearance gap** so
the slicer/printer (and the engine) treats them as distinct bodies that move
relative to each other instead of one fused lump.

Treat **1 unit ≈ 1 mm** throughout (FDM tolerances are quoted in mm).

## The golden rule: `componentCount` == number of parts

`componentCount` in `geometry-data` is your primary instrument for these
builds. A 2-part mechanism **must** report `componentCount === 2`. If it reports
`1`, your parts are **fused** — the gap is too small, two surfaces collide, or
there's a topology mistake — and it will print as a single immovable blob.

- Build the parts with `api.labeledUnion([{name, shape, color}, ...])`. The
  union keeps them as separate, individually-colored bodies **as long as a gap
  separates them** — it does not weld parts that don't touch.
- **Always check `componentCount` after building**, before declaring success.
  It's the cheapest possible proof that the mechanism is actually separate.

## Clearance gaps — the number that makes it move

FDM print-in-place needs roughly **0.3–0.5 mm** between moving surfaces:

- **< ~0.3 mm** → the surfaces fuse on the print (and often in the mesh too).
- **0.3–0.5 mm** → moves freely after a gentle first twist/break-in.
- **> ~0.8 mm** → loose and rattly.

Create the gap by sizing one part = the other ± clearance:

- 2D profiles: `crossSection.offset(clearance)` grows a profile uniformly, or
  just add the clearance to radii directly.
- Then **verify the gap survives meshing**: `componentCount` must be `2`. A gap
  that's correct in the math but smaller than the local mesh resolution can
  bridge into one component.

## Helical / spiral / threaded geometry — twist-extrude

`crossSection.extrude(height, nDivisions, twistDegrees, scaleTop)` rotates the
cross-section as it rises. This is the workhorse for threads, augers, spiral
flutes, and twist vases. `twistDegrees = 360 * turns`.

- **Circle + a bump → a single-start thread.** The bump traces a helix as it
  twists, producing a continuous screw thread:
  ```js
  const core = CrossSection.circle(6, 64)
    .add(CrossSection.circle(2, 28).translate([6, 0]));   // shaft + thread bump
  const screw = core.extrude(40, 300, 360 * 4, 0.4);      // 4 turns, tapered
  ```
- **Fluted profile → spiral flutes.** A circle whose radius dips `lobes` times,
  extruded with twist, gives `lobes` helical ridges. **Fewer lobes + more turns
  = bold, clearly-helical ridges; many lobes reads as horizontal rings.**
- Use a high `nDivisions` (200–300) so threads/flutes stay smooth.

## Nesting tapered parts — MATCH THE TAPER RATE (sharp edge)

When nesting a tapered (coned) part inside a tapered bore, **`scaleTop` alone is
not enough.** The inner part and the bore must share the same **taper *rate***
(radius lost per unit height) — otherwise a slower-tapering inner exceeds the
bore partway up, punches through the wall, and fuses the two parts
(`componentCount` drops to `1`). This is the single most common failure here.

Taper rate `k = (1 - taper) / H`. If the bore tapers by ratio `taper` over its
height `Ho`, then `k = (1 - taper) / Ho`, and an inner of height `Hi` must use:

```js
const k = (1 - taper) / Ho;          // shared taper RATE per unit height
const innerScaleTop = 1 - k * Hi;    // NOT `taper`, and NOT `taper * Hi/Ho`
```

so the inner shrinks at exactly the bore's rate and stays strictly inside it
over the whole engaged height (only poking out past `Ho`).

## A taper shrinks the gap toward the tip

A radial clearance offset **scales down** along a cone: `gap(z) = clearance *
scaleFactor(z)`. A generous 1.5 mm gap at the base can fall below printable near
the narrow top. **Size the base clearance so the *narrowest* point (the top)
stays ≥ ~0.35 mm.** Example: taper 0.4, base clearance 1.5 → top gap ≈ 0.6 mm. ✅

## Splitting one solid into interleaved moving parts — slab cut + `decompose()`

To turn a single solid into two (or more) interleaved, separately-colored parts
that move relative to each other — e.g. a two-tone spiral cone whose halves twist
apart — **subtract a thin cutter, then `decompose()`**:

1. Build the whole solid.
2. Subtract a cutter that is the *gap* you want — for a spiral, a **full-diameter
   helical slab** (a thin rectangle, thickness = clearance, extruded with twist).
   A full-diameter helical slab **does** split a solid of revolution into two
   separate components (verify with `componentCount`).
3. `solid.decompose()` returns one `Manifold` per connected component. Color each
   and `labeledUnion` them.

```js
const cone = Manifold.cylinder(46, 15, 2.5, 160);
const cut  = CrossSection.square([1.0, 60], true)     // thickness = clearance
  .extrude(48, 320, 360 * 2.5, 1).translate([0, 0, -1]); // helical, 2.5 turns
const parts = cone.subtract(cut).decompose();          // → 2 components
return api.labeledUnion(parts.map((s, i) => ({
  name: 'p' + i, shape: s, color: ['#f5b324', '#7c3aed'][i % 2],
})));
```

`decompose()` is the clean primitive for coloring the separate pieces of a split
— far simpler than hand-building rotating half-spaces or nested-taper math. If
the split reports **1** component, the cutter is too thin (raise the clearance)
or doesn't fully span the body.

## Verify with a CUTAWAY render

`componentCount` proves separation but not *where* the gap is or whether parts
collide internally. To inspect internal clearances, intersect each labeled part
with a half-space and render — empty colored space between the two parts = a
printable gap:

```js
const half = Manifold.cube([300, 300, 300], false).translate([-300, -150, -60]);
return api.labeledUnion([
  { name: 'a', shape: partA.intersect(half), color: '#7c3aed' },
  { name: 'b', shape: partB.intersect(half), color: '#f5b324' },
]);
```

Then call `renderViews()` and look at the cut faces. (Restore the un-cut
`labeledUnion` for the saved version.)

## Give the moving part an affordance

Add an intentional grip — a knob, wings, a textured cap, finger scallops — so the
user knows what to twist/slide and the protruding part reads as design, not a
stray spike.

## Common captive patterns (starting points)

| Mechanism | How it's captive |
|---|---|
| **Screw / twist** | Inner threaded shaft in a bored socket; match taper if conical. |
| **Spinner / bearing** | A core trapped by an overhanging lip on the surrounding body, separated by an annular gap (~0.35 mm). |
| **Captive ball / bead** | A ball larger than every cage opening, built as `ball.subtract` clearance, trapped inside a cage or track. |
| **Hinge / pivot** | A pin captured in a barrel (or two knuckles) with radial clearance; the pin can't pull out sideways. |
| **Compliant flex** | One solid body whose thin members bend elastically (no gap needed — it's `componentCount === 1` *by design*; the motion is material flex, not a sliding joint). |

For each: build it, check `componentCount`, then cutaway-render to confirm the
gap. Always save the final version with `runAndSave(code, label, {maxComponents:
<expected>})` so the component count is asserted on every rerun.
