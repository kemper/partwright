---
session: "01B8i3Nc4JgG6iV6eAsrYFq6"
timestamp: "2026-06-11T18:30:00Z"
model: claude-opus-4-8
---

## Human

Ran a four-subagent audit of the `api.sdf.figure` API for bugs/defects (looking
at the catalog figures for visible evidence), reconciled the findings against
the latest `main` (PR #588 had since fixed the arm-hinge instability), then asked
to open a PR fixing the "first cluster": the parsed-but-dead DOFs (spine,
head.tilt), the eyes-default/protrusion-floor paint-label issue, and the cheap
`bald`/`brows`/`weldBody` wins.

## Assistant

## Key decisions

**`spine.{lean,side,turn}` — implemented as a waist pivot, not rejected.** The
fields were validated and stored but no FK read them (9 of 10 catalog figures
set `spine` and silently got nothing — the same "parsed but never read" class
PR #588 had just fixed for leg-twist). Modelled the spine as a single rigid
rotation of the above-navel mass (chest, neck, head, both arms, face anchors)
about the navel line, legs/pelvis planted. Chose a rigid transform applied at
the rig's return so every limb's internal shape is preserved (transform each
point about the pivot, each direction by the rotation only — arms stay
attached, bone lengths unchanged). Guarded by `spineActive` so zero-spine is
byte-identical: all 63 pre-existing figure tests (incl. the double-biceps /
ballet / lunge recipes) passed unmodified.

**`head.tilt` — apply as a roll about the forward axis.** It was `rotY(hf,
tilt)` on the forward vector, then discarded by the cross-product frame rebuild
— a literal no-op. Now rolls the `headLeft`/`headUp` axes about `hf` by `-tilt`
(crown toward the figure's LEFT shoulder for +tilt). Also reordered
`orientToHeadPose` so its tilt term is the innermost rotation — provably
equivalent to rolling about the *posed* forward axis last, so the carved
mouth/eye parts roll consistently with the corrected frame (the old outer
`rotY` disagreed once tilt did anything).

**Eyes — protrusion floor + assemble default OFF.** Two of the three reported
eye failures: (a) `assemble` built eyes by default and the canonical
weld→`.label('skin')` flow flattened their paint labels to 0 triangles — flipped
the default to OFF (opt back in with `eyes: true`), matching every catalog/doc
usage; (c) the `rad*0.28` eyeball push was ~1 march cell and collapsed on
posed/enlarged heads — floored it at `r.head*0.09` (~2 cells), the same
cell-count discipline the mouth cavity already uses. Verified headlessly: a
posed stocky head now resolves eyes/iris/pupil at 1893/1102/379 tris (was
collapsing toward 0). The third sub-issue (pupil sub-cell when the build omits
`detail: F.faceDetail(rig)`) is inherent to skipping the detail region — the
docs already mandate it — so I only modestly thickened the lenses rather than
bloat the pupil; the documented `faceDetail` path resolves robustly.

**Cheap correctness wins.** `bald` hair returned `sphere(1e-3)` parked at
z≈−1e6, poisoning `bounds()`/`placeAt`; now a sub-cell sphere at the head centre
(meshes to nothing, swallowed in a union, sane bbox). `brows` accepted an
options object it entirely ignored (violating the "unknown keys rejected"
convention) — gave it validated `thickness`/`lift` knobs. Dropped the unused
`sdf` param from `weldBody`.

**Scope held back for a follow-up PR:** base auto-radius blowup on raised-limb
poses, the deltoid lump / persistent genus, the lip-ring near-tangent handles,
and the robe-skirt-cone feet poke-through — all more tuning-heavy and better
done with a visual-iteration loop.

**Verification:** 76 figure unit tests (13 new regressions mirroring the
pose-recipe harness), full build + 1192 unit tests green, and headless
`model:preview` renders confirming the body leans at the waist and the head
rolls toward a shoulder.
