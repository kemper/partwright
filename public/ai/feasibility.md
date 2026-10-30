# Partwright — Feasibility & Estimates

Read this when planning (plan mode, especially **Assess first**) to judge how
hard a request is **in this app, with these tools** — and to write the
`estimate` on `proposePlan` honestly. The user sees your estimate before they
approve, and **the build is stopped for their go-ahead at `roundsMax`**, so an
optimistic estimate doesn't buy you more rounds — it only means an earlier
checkpoint and a user who trusted a number that was wrong.

A **round** is one tool round-trip while building (a `runAndSave`, a render, a
query, a paint call…). A build always includes verification: count the renders
and fixes, not just the code.

## Rough difficulty map

These are starting points — adjust from what you actually inspect.

| Difficulty | Typical rounds | Examples |
|---|---|---|
| **easy** | 2–6 | Primitive-and-boolean parts (brackets, boxes, spacers, plates with holes); a parametric tweak to existing code; recolouring labelled parts; a library call that does the whole job (`api.gears.spur`, `api.threads.bolt`, `api.enclosure.box`, `api.fasteners.*`, `api.joints.*`, BOSL2 `cuboid(rounding=)`). |
| **medium** | 6–16 | Multi-part assemblies with fit/clearance checks; print-in-place mechanisms (verify `componentCount`); lofted/revolved/swept organic-ish shapes (vases, handles); exact fillets on chosen edges (BREP); surface textures scoped to one part; painting an imported mesh after `detectParts`; voxel art from an image. |
| **hard** | 15–40 | Likeness work — a figure, bust, pet or product that must *look like* a photo (SDF figure/creature kits + `photoMatch`, many render passes); organic sculpting with `smoothUnion` (surfaces bulge past the primitives — measure, don't trust analytic extents); reverse-engineering an imported mesh into editable code (`convertToCode` then refine); anything judged on looks where the user hasn't picked a direction yet. |
| **research** | open-ended | No known reliable route here: e.g. exact NURBS/class-A surfacing, true cloth/soft-body behaviour, text-to-photoreal likeness with no reference, features below ~0.4 mm meant to print. Say so, and offer the closest achievable version. |

## Signals that push the estimate up

- **Subjective targets** ("make it cute", "looks like my dog"): add rounds for a
  direction check, and prefer showing 2–3 options early over iterating one guess.
- **A reference photo**: likeness converges slowly; plan `photoMatch` passes and
  checkpoints, and expect "recognisable" before "close".
- **Imported meshes**: big triangle counts slow every operation; parts must be
  detected before painting; reconstruction has a noise floor.
- **Engine switches**: SCAD/BREP results bake to a mesh when textured, scaled or
  painted in ways that need it (the parametric source is lost — warn).
- **Printability required**: overhangs, thin walls and floating islands add fix
  rounds; budget a `checkPrintability` / `thicknessMap` pass.
- **Vision off**: you can't see renders, so likeness and paint verification get
  much harder — say so and lower confidence.
- **Small or local models**: fewer reliable tool calls per round; widen the range.

## Capability gaps worth naming

Name the gap in `estimate.gaps` instead of hoping it won't matter:

- No physics/simulation (stress, flex, fit under load) — clearance is geometric only.
- No true NURBS/G2 surfacing; BREP fillets/chamfers yes, freeform class-A no.
- Paint is per triangle: very fine colour detail needs fine geometry.
- Imported scans can't be edited parametrically until reconstructed (approximate).

## Writing the estimate

- `difficulty`: from the map, adjusted for what you inspected.
- `roundsMin`/`roundsMax`: the realistic range **including verification and
  fixes**. `roundsMax` is where the user is asked whether to continue.
- `confidence`: your honest chance of reaching `quality` within `roundsMax`. A
  hard likeness task is rarely above 60%.
- `quality`: what the result will look like ("clean printable blockout",
  "recognisable, stylised", "close to the photo") — not what you hope.
- `gaps` / `risks`: short, concrete, each one something the user could act on.

If the app shows **"Past plan-mode builds"** calibration in the request, scale
your rounds by it: when past builds averaged 1.6× the planned maximum, your
gut estimate is probably low by about that much.
