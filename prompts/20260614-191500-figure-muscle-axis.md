---
date: 2026-06-14
branch: claude/anatomical-realism-9i9owt
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_bodybuilder.js
  - examples/figure_athlete.js
  - public/catalog/bodybuilder.partwright.json
  - public/catalog/athlete.partwright.json
  - public/catalog/palettes/bodybuilder.json
  - public/catalog/palettes/athlete.json
  - public/catalog/manifest.json
  - public/catalog/bake-manifest.json
---

## Human

A recent PR added better anthropometric data (sex/age/weight dimensions) to the
figure rig as a step toward realism. The user wants to make more progress on
anatomical realism — specifically muscle definition was flagged by a previous
session — and more anatomically-correct shapes generally. Investigate, come up
with a plan, and if confident, create a PR with an initial approach. Include new
catalog entries demonstrating the tech with full-body-sized figures.

## Assistant

Investigated `src/geometry/sdfFigure.ts` (the whole figure builder) and found
the smoking gun: `figure_strongman.js` *hand-rolls* its muscle masses (bicep
peaks, chest puff, traps) as raw primitives — exactly the kind of coordinate
guessing the rig was built to eliminate. So the right move was a first-class
`muscle` axis on the rig, parallel to the existing `build`/`sex`/`age`/`weight`.

**Design decision:** a single continuous `muscle: 0..1` rig option (default 0),
matching the `weight` axis style, rather than named presets — most flexible,
composes with the other axes, and gated so `muscle: 0` is byte-identical to
today (pinned by unit tests; the whole point of the calibration-anchor pattern
the anthropometry PR established).

The part builders (`buildTorso`/`buildArms`/`buildLegs`) now weld
anatomically-anchored bellies when `muscle > 0`: pecs/abs/lats/traps on the
torso; deltoid + biceps/triceps + forearm swell on the arms; quads/hamstrings/
calves/glutes on the legs. Directions come from the rig frames — the key insight
is that the rig builds a joint bend as a rotation about a hinge axis, so the
flexor (biceps/quad) side is `hinge × boneDir` (the rotation derivative). That
makes biceps bulge correctly on a raised/flexing arm with no per-pose code. I
exposed `rig.dir.kneeHingeL/R` (the leg analog of the existing `elbowHinge`) so
the leg muscles get the same frame-derived directions. Signs were verified
empirically with `model:preview` side/front renders rather than trusted from the
math (per the CLAUDE.md "measure, don't assume" rule).

Two full-body catalog entries demonstrate it: **Muscular Hero** (male,
`muscle: 0.85`, competition trunks, lat-spread stance) and **Athletic Sprinter**
(female, `muscle: 0.55` + `weight: 0.34` — lean AND defined, showing the axes
are orthogonal). Both bake manifold / one-component / under the tri budget.
Tuning notes: dialed the deltoid coefficient down after the first render
(shoulder-pad look at max); `cuffZ` can't make mid-thigh shorts (the pant sleeve
always covers the knee) so the sprinter uses `length: 'briefs'` track briefs to
keep the quads visible; prominent cheeks + small eye radius buried the eyes
(0-triangle paint labels) until the eye radius was bumped and cheek prominence
reduced.

Documented the axis in `public/ai/figure.md` (including that it supersedes the
hand-rolled strongman pattern). Left the existing strongman entry untouched to
avoid a rebake churn — a follow-up can migrate it to `muscle`.
