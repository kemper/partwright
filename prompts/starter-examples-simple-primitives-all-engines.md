---
session: "gf44vx"
timestamp: "2026-06-09T18:40:00Z"
model: claude-opus-4-8
---

## Human

I like the idea, but I worry that people will think that models this well made
will be existing work. I think more like randomly pick a cube, or sphere,
cylinder, pyramid, etc. Maybe give it a label and a basic starting color. I
would also want this to exist for all the engines, not just manifold-js.
(Follow-up: use the recently merged api.paint capability for the colour if it
fits.)

## Assistant

## Key decisions

**Pivot: elaborate models → simple labelled primitives, for every engine.**
Replaced the five hand-built manifold-js models (rocket/snowman/…) with one
plain primitive per starter — cube, sphere, cylinder, cone, pyramid — and
extended the rotation to all four engines (manifold-js, voxel, scad, replicad)
instead of just manifold-js. Each is a single primitive wrapped in a label so
it can be recoloured in one click, with a basic distinct starting colour
(blue/orange/green/red/purple).

**New dependency-light module `src/editor/starters.ts`** owns the data,
rotation, and recognition (`STARTERS`, `nextStarter`, `isStarterCode`), unit-
tested in the vitest tier (`tests/unit/starters.test.ts`). This retires a pile
of vestigial machinery in `main.ts`: the `examples/*` globs, the `examples`
record, `ExampleEntry`, `defaultCode`, and the inline `STARTER_SCAD/REPLICAD/
VOXEL` capability-samplers — all gone. Rotation is per-language (independent
`localStorage` index per engine), degrading to no-rotation when storage is
unavailable.

**Colour per engine — only manifold-js & voxel can self-colour in code.** I
confirmed against the engines: manifold-js has `api.label(s, n, { color })` and
voxel colours per cell, but SCAD silently strips OpenSCAD `color()` and
replicad/BREP's `label()` takes no colour. The user asked about the recently
merged `api.paint` — that PR actually added `paintImage` (an image *stamp*),
which isn't a flat-colour tool, so it doesn't fit. Per the user's "auto-paint"
choice, scad/replicad starters carry a `paint: { label, colorHex }` descriptor
and a new `seedStarter(lang)` helper applies it via `partwrightAPI.paintByLabel`
*after* `runCodeSync` registers the label. Verified in-browser: all four engines
seed a blue primitive (scad cube and BREP box are painted; manifold-js sphere
and voxel cube self-colour).

**`seedStarter` unifies every seed path and drops paint first.** It replaces the
old `resetEditorToStarter` body, the per-language ternaries in
`switchLanguageWithDrafts`, and the six fresh-session fallbacks. Crucially it
calls `dropPaintState()` before seeding — caught in testing that without it the
scad starter's paint region bled across a language switch into the replicad
part (regions=2 instead of 1). It uses `runCodeSync` (no `preserveCamera`) so the
fresh model auto-frames, matching the old `runCode` behaviour, and only the
fresh-starter branch of `switchLanguageWithDrafts` runs it (a restored draft
keeps its own buffer + paint).

**Recognition is now whitespace-insensitive.** `isStarterCode` strips all
whitespace before comparing against the starter set, so a seeded-then-
auto-formatted starter still matches (the earlier js-beautify reflow bug) while
any real token edit (a changed dimension/colour) still reads as non-starter.
This removed the need to hand-beautify starter files for exact matching. Kept
the legacy `Manifold.cube([10,10,10])` stub regex for back-compat with old
drafts. Re-verified the import/export suites: fresh starters are recognized as
expendable (imports land directly), and the colour-drop / language-switch test
updates from the previous round still hold.
