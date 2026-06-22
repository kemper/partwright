---
session: "sharpbell"
timestamp: "2026-06-21T15:36:00Z"
model: claude-opus-4-8
sequence: 1
---

## Human

Ideating next features for the AI CAD app; chose to make new animals (cats &
dogs) in a cute chibi style for the figure API. Leverage the hard-won figure-API
SDF lessons for quality/capability. Then: a vision-judged eval loop
(`eval:models`) was merged — test it with supplied chibi-kitten reference images
and let me know if it helps and whether reference images are needed.

## Assistant

## Key decisions

**Sculpt-first, rig-later for animals.** Built the cats/dogs as raw `api.sdf`
`smoothUnion` bodies (ellipsoid masses + capsule limbs, the proven creature
path), not a new quadruped rig. Rationale: discover the common quadruped
skeleton from 2–4 real builds before factoring a reusable `F.quadruped` rig —
abstracting speculatively risks factoring the wrong things. Sitting pose chosen
for cuteness + printability (broad stable base, no thin unsupported legs).

**Converged the look via an independent judge → sculpt-fix → re-judge loop**
(the user's explicit ask). Four rounds drove cat-a/cat-b/dog-a/dog-b from 3–6/10
to 6.5–7.2/10, each pass gated on `isManifold:true` + `componentCount:1` and,
later, a flat non-rocking base (a manifold model can still be print-unstable —
the gate alone doesn't catch bowl undersides / knife-thin ears / cantilever
paws, so those were added as explicit checks).

**Pulled figure-API quality techniques forward** (both quality and capability):
ball-inside-ball eyes (eyeball + crisp iris/pupil caps as paintable geometry,
replacing featureless union-bump eyes — the single highest-value fix per both
the critic and the figure source), nested face detail-regions (head 0.20 →
muzzle 0.09 → iris 0.055 edgeLength so the iris resolves round), `surfaceMarking`
conformal pads (pink inner-ear), and the figure's `k ≈ 0.2 × radius` weld
convention.

**Tested `eval:models` with the supplied references → it's a clear win, adopt
it.** Built a `chibi-cat` case from the user's three kitten images (montage
`reference.png` + a form-focused `rubric.md` + `case.json` gates incl.
`requireLabels` for eye/iris/pupil/nose). In-container `claude` judge scored
18/100, then 42/100 after enlarging the eyes ~2× (eyeR 1.4→2.8, ~55–60% of face
width) — the loop demonstrably drives convergence and is strictly better than
the ad-hoc critic (committed reference + rubric + gates + baseline + cost cap).
On references: **not required to start** (rubric-only works; current best render
can be pinned), but a small consistent pinned set sharply anchors a subjective
style like chibi — so the user's images are the high-leverage input.

**Key finding filed as follow-up:** the harness renders grey normal-shading, so
uncolored features (iris/pupil/nose/inner-ear) that *exist as real geometry*
(nonzero label tris) read as "blank" to the judge and under-score color-dependent
rubric items. The high-value next step is judging the **colored bake**, not more
sculpting. Kept rubrics form-only meanwhile.

**Preserved all four models as committed eval-case sources** (cat-a, dog-a as
`model.js`; cat-b, dog-b as `variants/`) so the chosen geometry isn't only in
the gitignored `.plans/` scratch — also fixes the "catalog rebakes are git
archaeology" gap for these subjects.
