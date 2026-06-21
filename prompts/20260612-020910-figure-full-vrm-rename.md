---
session: "1279354d"
timestamp: "2026-06-12T02:09:10Z"
model: claude-opus-4-8
---

## Human

"we don't need to support the old terminology. no one uses this app yet. I want
to consolidate on the new terminology so long as the catalog code / data is
updated to match." (Reversing the earlier "keep both vocabularies" decision.)
Then chose, when asked how far the joint rename should go: **Full VRM rename** —
rename every joint to the VRM/Unity humanoid scheme, not just the three that had
aliases.

## Assistant

## Key decisions

**Reversed the prior "keep both" doc-only decision and did a real, destructive
rename.** With no users yet there's no saved-session back-compat constraint, so
the dual vocabulary (the thing that kept tempting a "finish the rename") is
collapsed to ONE canonical set. Discarded the unpushed "settle as aliases"
commit and started over from main.

**One canonical vocabulary:**
- Pose DOFs: `raiseSide` / `raiseFwd` / `bend` / `twist` (was abduct / flex /
  elbow|knee / twist). `elbow` and `knee` both fold into `bend`. Kept `twist`
  (already plain; `roll` is reserved for the head). Head: `yaw` / `pitch` /
  `roll` (was turn / nod / tilt). Spine `lean`/`turn`/`side` unchanged.
- Joints: VRM/Unity humanoid names — `hips`, `spine`, `chest`, `neck`, `head`,
  `upperArm*`/`lowerArm*`/`wrist*`/`hand*`, `upperLeg*`/`lowerLeg*`/`foot*` (was
  pelvis/navel/neckBase/headCenter, shoulder/elbow/…, hip/knee/ankle). Kept
  `wrist*` (distinct from the hand-mass-centre `hand*`, and used internally) and
  `crown`/`chin` (useful non-VRM landmarks). The old standard-skeleton *alias*
  block is gone — these are the real keys now.
- Radii (`r.foreArm→lowerArm`, `thigh→upperLeg`, `shank→lowerLeg`, `pelvisX/Y→
  hipsX/Y`) and directions (`dir.foreArm→lowerArm`, `thigh→upperLeg`, `shank→
  lowerLeg`) renamed to match; `elbowHinge*` kept (it's a hinge axis, not a
  segment). The validator now THROWS on any retired name (no silent aliasing).

**The rename is a pure no-op for geometry — proven, not assumed.** Only key
names changed; every value fed to the FK math is identical. The 97 figure unit
tests assert numeric joint positions / proportions / FK and pass UNCHANGED,
which is the safety net that geometry is bit-identical. The rocker re-previews to
its exact prior volume (8950.148032830719). The old example files now correctly
*throw* against the renamed engine (confirming the consolidation).

**Mechanics — careful, collision-free renames.** Used prefixed/word-boundary
perl patterns (`j.shoulderL`, `p.abduct`, `r.thigh`, `head.turn`) that can't hit
substrings, plus hand edits for record definitions, interfaces, and the parse
layer. The two real traps, both handled: (1) `turn` is head→`yaw` but spine→
stays, so it was scoped to head-context lines; (2) tests/examples used the names
as template-literal keys (`` `knee${side}` ``) and loop-var shorthands
(`{ abduct }`) that the `key:`-based pass missed — found and fixed by grep.
Rewrote the alias-coexistence unit tests into positive tests that the canonical
names work and the retired ones throw / are absent.

**Catalog data updated to match (the user's explicit condition).** All 11 figure
catalog `.partwright.json` entries embed their model source, which now uses the
new names, so each was rebaked headlessly (geometry/thumbnail identical; only the
embedded code + a fresh render change). Docs updated: `public/ai/figure.md`
(pose table, joint/r/dir lists, a "one canonical vocabulary" Naming policy note,
prose) and a stray `rig.joints.headCenter` in `public/ai/sdf.md`.
