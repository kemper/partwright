---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T13:39:47Z"
model: claude-opus-5-5
issue: kemper/partwright#1055
tools: [subagent, git-worktree, model:preview photoMatch]
---

## Human

Two follow-ups from issue #1055 on top of the Funko primitives branch.
(1) `F.face.brows(rig, { on: face })` silently resolves to 0 triangles when
the head has `cheek` above about 1.2 or the face was translated after building.
Write a failing test first, fix the root cause so brows seat on the real welded
surface and follow a moved face, add a defensive check so conformal features
fail loudly when buried, and keep every existing figure byte-identical.
(2) Add `F.hair(rig, { style: 'anime' })`: a smooth cap hugging the skull plus
chunky swoopy pointed locks (fringe, side bangs, crown tufts, layered nape),
with a tilted hairline and an arched face window so the 3/4 view does not read
as a helmet. Params `locks/fringe/spike/swoop/length/volume/seed/ears/on`,
plus optional cap/tuft helpers. Validate by rebuilding the Tsubasa chibi as v4,
scored against the photo by text, with few image reads.

## Assistant

**Brows root cause.** The conformal brow is `on.round(proud) ∩ arc`, and the
arc is laid out from the rig's brow anchors with an analytic skull-curvature
guess. A cheek/jaw weld (or a headScale'd Funko head) puts the real forehead
3–6 brow-bands in front of the anchor, and a translated face moves it
elsewhere. Either way the clip region sat entirely inside the skin (or off it),
so the marking was a subset of the skin and painted nothing.

**Brows fix.**
- The `on` node's outer `translate` wrappers are peeled. Only the translates
  above a child that still contains the rig head centre count: a sphere
  positioned at the head with `.translate` is not a "moved face". A unit test
  caught that case.
- When the anchor-laid arc isn't mostly seated (at least half its centreline
  within one band of the marking shell), every arc point is projected onto the
  real surface along `headForward`.
- Arcs that are already seated are left exactly as they were. That is why all
  15 regression figures came out byte-identical.

**Guard.** `assertMarkingSeated` and `buriedFeatureError` throw a
`ValidationError` ("…would paint 0 triangles") for brows. The same throw covers
`F.nipples({ on })` when its column misses the body. I chose a throw over a
warning because a silent zero-triangle label is the exact failure being fixed.
Eyes take no `on`, so they can't be checked this way.

**Anime hair.**
- The cap is a thin offset of the real head plus crown and occiput masses. It
  is trimmed below a tilted hairline plane and cut by an arched window whose
  tilt pivots about the apex.
- Two placement bugs were found by text-only ASCII occupancy maps, not by
  images:
  - Pivoting the window about its centre dropped the hairline onto the brows.
  - The (θ, φ) ellipsoid parametrisation drifts on a scaled face. Fringe and
    sideburn tips are now placed by height, by marching horizontally to the
    skin.
- Locks are hard-unioned and welded into the cap once, not once per lock. A
  head plus hair builds in about 9 s, against about 28 s for 'mop'.
- The mop now shares `scalpFrame` and `hairLock`. A hash of 400 SDF samples
  confirmed its output is unchanged.

**Validation (v4 vs v3 photoMatch).** Front 0.868 vs 0.879, back 0.879 vs
0.872. Brows region IoU went from 0.135 to 0.337, and v4 uses `cheek: 1.2`,
which the bug previously blocked.
