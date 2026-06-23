---
session: "great-curie-g5nsu7"
timestamp: "2026-06-17T01:37:58Z"
model: claude-opus-4-8
---

## Human

Following recent figure-related catalog fixes, the breast/chest body
dimensions are clearly wrong: nipples land in the *middle* of the body
rather than on the chest, the bust mounds are too low and so aren't covered
by clothing by default, and the chest proportion reads off. Investigate and
create a PR to fix it. (Reference photo attached: a pink-gowned figure whose
skin breast mound bulges out below the dress's chest coverage.)

## Assistant

## Key decisions

**Root cause** (`src/geometry/sdfFigure.ts`): the nipple/mound vertical line
was computed as `chestZ − chestSemiZ·0.16` — i.e. a fraction of the chest
ELLIPSOID's own half-height below its centre. But `chestSemiZ` is **capped
large** (`torsoMasses`, the shoulder-line cap) on tall (high-`headsTall`) and
stocky rigs, so "a touch below centre" became a big drop that sank the bust to
the lower ribcage / upper belly. That's the "nipples in the middle of the
body" defect, and why the mound poked out below a garment's chest coverage
(verified by a colored bake of `figure_runway_model`: skin breast bulging
below the gown vs. tucked-under after the fix).

**Fix**: replaced the chest-ellipsoid-relative drop with a `nippleLineZ()`
helper that anchors the line in **head-units off the shoulder** — `shoulderZ −
0.62·headH` — matching this file's head-unit landmark canon (the figure-drawing
rule of thumb: nipples ≈ 2 heads below the crown ≈ ~a head below the
clavicle). Shared by both the bare-chest anchor (`buildRig`) and the mound
centre (`breastMounds`) so they can't drift. `headH` is recovered inside
`breastMounds` as `r.head / 0.46` (the only un-built head radius).

**Chibi clamp**: at extreme low `headsTall` the head dwarfs the torso, so a raw
0.62-head drop would push the line into the belly. Clamped the drop to ≤42% of
the shoulder→pelvis span; inert for the realistic 6–8.5-head range (head-unit
drop wins), so normal figures only get the intended raise.

**Tests** (`tests/unit/sdfFigure.test.ts`): updated the landmark test to pin
the corrected upper-chest placement (≈0.62 head below the shoulder, above the
chest↔navel midpoint) and added a cross-`headsTall` regression guard that the
line never sinks toward the midriff.

**Deferred / asked the user**: the subjective chest *proportion* (mound
size/shape) and re-baking the ~12 affected female-figure catalog entries
against the fixed engine — surfaced for direction before investing in the
mechanical batch.
