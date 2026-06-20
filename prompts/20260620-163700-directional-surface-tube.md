---
session: "bb0d5a1"
timestamp: "2026-06-20T16:37:00Z"
model: claude-opus-4-8
---

## Human

(Audit thread.) A user uploaded a photo of a ribbed saguaro-cactus 3D print
and shared an in-app AI agent's self-critique of why it struggled to
reproduce it (floating arms, hand-rolled ribs with warp/displace, caps that
wouldn't phase-match a Curves.sweep). The user asked me to judge the
feedback, prove the gap was discoverability not capability, then — stepping
back — to make sure the fix generalizes beyond cactuses to "textures/surface
effects that flow in a direction of travel," ship enhanced tooling + docs,
and add a few catalog entries proving the new capability.

## Assistant

## Key decisions

**Root cause of the audit:** The app could already make the model
(smoothUnion of capsules = one connected piece by construction), but no
single primitive carried a surface texture *along a path's frame*, so an
agent had to hand-roll angle-around-axis math with `warp`/`displace` and
fight cap phase-matching. The agent's proposed fix ("make Curves.sweep
expose the path frame") was solving the wrong problem — an SDF displace in a
path-local frame sidesteps caps entirely.

**The general primitive — `api.sdf.tube(path, radius, opts)`** (in
`src/geometry/sdf.ts`, `primTube`): a capsule swept along a `Vec3[]`
polyline whose surface texture flows along the direction of travel.
`opts.profile`: `flutes` (along), `rings` (across), `helix` (wrapping),
plus `count`/`turns`/`depth`/`taper`. Two design choices made it robust:
- A **rotation-minimizing frame** (Wang 2008 double-reflection) precomputed
  per path vertex and interpolated per sample, so the texture is continuous
  through bends (no per-segment seam — the v2 cactus elbow problem).
- Grooves are carved **inward only** (`g ∈ [0,1]`, surface = radius −
  depth·g), so a groove can never detach a component. One connected piece by
  construction.

**Why an SDF primitive, not a Curves.sweep change or a `flutedCapsule`:**
generality. The same call is the cactus (flutes on bends), a unicorn horn
(helix + taper), and a corrugated hose (rings around a bend). `sdf.md` notes
"if a missing op keeps coming up, add it to api.sdf" — this is that.

**Catalog proof:** three baked entries (cactus_dock, unicorn_horn,
vacuum_hose_elbow) cover all three profiles, verified `componentCount: 1` /
`isManifold` headlessly via model:preview before baking colored thumbnails.

**Docs (the discoverability fix the audit actually called for):** a
`tube`/#tube section in `ai/sdf.md` (incl. the cactus recipe and an explicit
"don't hand-roll with warp/displace" steer), an `ai.md` verb-table row, and
a `manifold-api.md` quick-ref entry. Also folded in one cheap audit item: a
prominent **`warp()` mutates-in-place** callout in `manifold-api.md` (the
silent `v => [x,y,z]` footgun). The runAndExplain-auto-fold and the
model:preview headless-surface-texture-gap items are filed as follow-up
issues, not in this PR.
