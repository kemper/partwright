---
session: "aiK0c"
timestamp: "2026-06-11T20:30:00Z"
sequence: 3
---

## Human

(Pre-merge review pass on PR #205, cross-engine insert palette.) The
work-reviewer subagent flagged one blocking issue, one should-fix, and two
nits. Process the findings: fold in confident fixes, raise ambiguous ones.

## Assistant

## Key decisions

**Blocking — never-drop rule had a hole (the reviewer's #1).** `addManagedDeclaration`
decided "this return is a throwaway starter, drop it" with a *structural*
heuristic: a lone library-constructor return (`Manifold.*`/`BREP.*`/…) in a
program with no named `const` parts. That misfires on real, hand-written
single-expression returns — `return Manifold.cube([30,30,5], true).translate([0,0,2.5]);`
or `return BREP.box(...).fillet(1)...;` — silently dropping the user's geometry
on first insert (the same class of bug the user originally reported, just a code
shape my tests didn't cover). It was also *inconsistent*: the real seeded
manifold-js starter returns `api.label(...)` (not matched → kept/doubled) while
the BREP starter returns `BREP.label(...)` (matched → dropped). Replaced the
structural test with `isStarterCode(code)` (from `src/editor/starters.ts`,
whitespace-normalised match against the actual seeded starters + legacy stub).
Now: untouched starters drop cleanly and identically across engines; anything
the user wrote — including a single chained expression, and an *edited* starter —
is preserved as a union element. Deleted the now-dead `isConstructorCall`. Added
three tests (js single-expr, brep single-expr, real-starter-dropped-consistently).

**Should-fix — session switch mid-drag leaked listeners + hid the model (#2).**
`resetInsertPaletteState` (the `session-changed` handler) cleared caches and
closed the panel but never tore down an in-flight build/select/pick session, so
a session switch mid-session leaked canvas `pointer*`/`keydown` listeners and —
for the build session, which sets `meshGroup.visible = false` — left the new
session opening with the real model hidden behind orphaned proxy meshes. Now
calls `buildCleanup?.(); selectSessionCleanup?.(); pickCleanup?.();` first; each
restores visibility/listeners and nulls itself, so it's safe whether or not one
is active.

**Nit — voxel drag sub-voxel drift (#3).** `writeMoveDelta` bumped the in-memory
spec + registry bbox by the raw continuous delta while the emitted voxel coords
round to the integer lattice, so spec/code could disagree by <1 voxel. Snapped
the voxel branch's delta to whole voxels (`Math.round`) and use that same `eff`
delta for the re-emit *and* the spec/registry bump, so all three stay on one
grid; a sub-voxel drag is a no-op (correct "snaps to grid" feel).

**Nit — stale test-location comments (#4).** `codegen.ts`/`controller.ts`/`spatial.ts`
(and the spec's own header) claimed the modules are "unit-tested in Node like
src/ai/patch.ts" — but `tests/insert-codegen.spec.ts` is a Playwright spec in
the e2e tier, not a vitest unit test. Corrected the comments to say so (kept the
tests where they are; moving 120+ pure-logic cases to the vitest tier is a
separate, larger change, not bundled into a bugfix).

Verified: typecheck clean, `lint:deps` acyclic (the new
controller→starters import adds no cycle), insert-codegen 122/122 and
insert-palette 10/10 green.
