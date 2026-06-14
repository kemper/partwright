---
session: "01DnBahfEetNH5Enmu5CbJPB"
timestamp: "2026-06-14T00:40:00Z"
model: claude-opus-4-8
---

## Human

After #650 merged, the afro-funk eyes still read wrong: the lid sat "over the
eyeball" without wrapping. Asked whether eyelids should be modelled as two
separate parts (upper + lower) with independent API control — e.g. upper 75% +
lower 25% = closed, 50/50 = closed, 25/25 = a slit. Agreed it's the better
model; asked me to build it as a follow-up PR.

## Assistant

## Key decisions

**Why the single-opening model didn't wrap.** #650 cut the eye window with an
ellipsoid stretched into a tube along the view axis — a cookie-cutter punched
straight through, so its edge was a flat ellipse that ignored the eyeball's
curvature. Real lids wrap because each margin is an ARC on the sphere.

**Two independent wrapping lids.** Each lid is now a thin skin shell — a cap of a
slightly-larger concentric sphere sliced by a margin plane that is TILTED forward
(~18°) so the rim arcs over the round eye and, being a circle on the sphere,
wraps. `upper`/`lower` ∈ 0..1 are how far each lid has closed; the eye is open
between the margins and shut once `upper + lower ≥ 1`. So {0.75,0.25} and
{0.5,0.5} both read closed and {0.25,0.25} is a slit — exactly the user's model,
and it unlocks blinks/winks/sleepy/squint that presets can't express.

**API: pair OR preset.** `lids: { upper, lower }` for full control; the seven
named presets stay as shorthand mapping to pairs (so the catalog code and #650's
API keep working). Validated: fractions clamped 0..1, unknown keys rejected,
`{0,0}` ≡ no lids.

**Genus stays clean.** The eyeball is kept a WHOLE sphere (fills behind the lids
— no nested tube walls), and only the iris/pupil are subtracted from under the
lids (enough to stop colour bleed). Genus 0 on the test head for open/slit/closed;
`tapered`'s narrow corners add a small handle or two — verified the baked figures
stay in the originals' range.

**afro-funk lightened.** Switched it from `tapered` to `upper` — the user's "too
much over the eyeball" was partly that `tapered` is an aggressive preset; an open
alert eye suits a dancer. Re-baked all 15 catalog figures.

Verified every style/pair at `--size 1400`, cropped natively (per the QC note
added in #650).
