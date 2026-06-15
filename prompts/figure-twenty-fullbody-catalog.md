---
date: 2026-06-15
branch: claude/zealous-babbage-mltr67
files_changed:
  - examples/figure_*.js (20 new full-body figures)
  - public/catalog/*.partwright.json (20 baked entries)
  - public/catalog/palettes/*.json (20 palettes)
  - public/catalog/manifest.json
---

## Human

"I've recently merged a variety of figure features — ears, noses, eyelids, feet,
nipples, belly buttons, eye/gaze direction, hair improvements, body-size axes.
Use ~10 sub-agents to create ~20 new catalog entries that use a bunch of the new
features together so I can see the quality of all these components in combination.
Full-body creations, NOT busts. A decent variety of body positions (I want to
check the body mechanics). Make them fun and silly, and ideally a bit different
from what's already in the catalog. Open a PR so I can see them on the test URL."

## Assistant

Fanned out **10 `model-sculpt` subagents**, each authoring 2 full-body figures
(20 total), with the feature/pose coverage deliberately partitioned so the set
collectively exercises every recent axis: closed/half/hooded/almond/tapered
eyelids, single- and per-eye gaze (incl. cross-eyed), the nose presets, lip
shapes, ears, the body axes (age young/old, weight, muscle, sex, bust), bare-
torso nipples/areola + navel, feet with toes, and the hair styles/textures
(afro+coils, locs, cornrows, boxBraids, spiked, bun, ponytail). Poses span
seated/lotus, kneeling, deep bow, one-leg balance, squat, crouch, kick, twist,
dab, floss, surf stance, tantrum sit, and more. Agents iterated headlessly with
`model:preview` (geometry only) and returned code + palette + camera; I (single
git writer) baked each with `build-catalog-entry.cjs`.

**Key discovery — an eye-burial limitation in the figure API.** `model:preview`
shades by normal and can't paint, so a whole class of defect was invisible to the
agents and only surfaced at bake time: on `round`/`heart` faces, high `cheek`
values, giant chibi heads, and heads pitched far back, `F.face.eyes`' built-in
forward push (`max(rad*0.28, r.head*0.09)`) is too small and the eye domes sink
into the skull — the `eyes`/`iris`/`pupil`/`lids` paint labels resolve to **0
paintable triangles**. There is no documented knob to push them further, so I
worked around it per-figure by translating the eyes node a little further along
`rig.dir.headForward` before unioning (labels ride the translate). Filed as a
follow-up issue (the robust fix is an `eyeDepth`/push option on `F.face.eyes`, or
auto-scaling the push to the local face protrusion). A secondary finding — open-
mouth `render:'painted'` teeth/lips also often bake to 0 paintable triangles —
went into the same issue; those are cosmetic and left as-is.

Other fixes folded in during baking: relabelled props that a `.label('skin')`/
`.label('base')` had swallowed (the overhead barbell was painting flesh-coloured;
the soccer ball was painting base-grey) so they carry their own colour while
staying one component; dropped stray palette keys for regions that didn't exist
(`sole` where shoes were single-labelled, `skirt` where the dress is one piece);
trimmed a few over-budget bakes (switched the barbell-gripping fists to mitten
fists + dropped `handDetail`, nudged `edgeLength`). Eased "Grand Bow" from
`lean:62` (face buried, read as a faceless blob) to `lean:42` with the head
lifted for audience eye-contact.

All 20 pass the gates: `isManifold`, `componentCount: 1`, manifold-mesh, within
the catalog triangle budget; catalog lint clean.
