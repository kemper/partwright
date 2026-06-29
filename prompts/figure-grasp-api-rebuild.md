---
date: 2026-06-28
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - tests/unit/sdfFigure.test.ts
  - examples/figure_knight.js
  - public/ai/figure.md
  - public/catalog/knight.partwright.json
  - public/catalog/knight.thumb.png
  - retros/inbox/2026-06-28-figure-grasp-api-rebuild.md
---

## Human

The user had spent days across multiple AI sessions trying to fix the knight's
sword grip and was frustrated. Key statements over the session:

- "Why is it you and several past AIs before cannot get that hand right?"
- "The arm/hand needs to rotate 180 degrees and hold the sword on the other side"
- "I want mechanics that reasonably match humanoid mechanics"
- "Fingers don't wrap around objects... currently you have the knight using
  his 'fist' hand shape and then putting a sword on his knuckles"
- "Total fail. That looks pretty bad. arms bent at impossible angles" (after I
  shipped a broken `roll` API)
- "Dear god. Why oh why oh why can't you and all the other AIs I work with figure
  out how to get a hand to grasp something. ... If you need to rewrite the entire
  grasping hand part of the figure API you can"
- "I think my last got lost" (about the thumb-at-pommel dagger grip I missed)
- "The sword is still too close to the wrist. ... I wanna fix that, but I also
  wanna fix just, like, the defaults or whatever it is about the API that makes
  this so challenging for an AI to get right. I want somebody to be very simply
  to say something like, I wanna figure of a person holding a sword, and I want
  an AI to get it correct on the first try"
- "What can we do to either agent intelligence/instructions or API capabilities
  and/or defaults that would make this kind of task much better in the future?"

## Assistant

Five categorical changes — not patches, structural fixes that benefit every
figure that grasps anything:

1. **`wristRoll` DOF on the arm pose.** Real forearm pronation/supination —
   rotates the hand frame about `foreDir` without moving the wrist. The
   previously-failed `roll` API was the right idea applied to the wrong axis
   (it rotated `foreDir` itself, reflecting the wrist through the elbow).
   Distinct from the bone-pure `elbowHinge` (which muscle bellies still use);
   exposed as `rig.dir.handSplayL/R` for the hand placement + grip frame.

2. **`palmFacing` / `thumbAxis` / `holds` aim targets.** Solve the wrist roll
   for human-meaningful intent ("back of hand to camera", "thumb up", "the
   thing held points in this direction"). All four (incl. raw `wristRoll`)
   write the same DOF; parseArm rejects setting more than one with a clear
   message. `holds` is the AI-natural recommended path — pair with `F.grasp`
   and write "person holds sword vertical" in two lines.

3. **`grip.point` moved into the finger cup.** Was `palmN·0.72` (at the wrist
   line — the "sword at the wrist / dagger grip" defect). Now
   `reach·0.95 + palmN·0.35` (in the curl of the fingers, where a grasped
   bar actually sits). Structural fix; every grasped-prop figure benefits.

4. **`F.grasp(prop, grip, opts?)` helper.** Auto-flips for the right hand so
   the prop's +Z end (built as the business end) lands at the thumb, and uses
   the new finger-cup grip.point. AI writes `F.grasp(sword, rig.grip.R)` —
   no `wristRoll`, no `flip`, no per-figure tuning. The grip frame now carries
   `side` so the helper can auto-pick the flip.

5. **`F.graspProbe(rig, 'R'|'L')`** pre-bake QC. Returns `gripDirection`
   (visible prop axis after auto-flip), `barCupDistance` (in `r.hand` units —
   catches the wrist-line defect), and a summary. AI asserts before render.

Knight pose is now `armR: { raiseSide: 5, raiseFwd: 0, bend: 90, holds: 'up' }`
with `F.grasp(sword, rig.grip.R)` — no flip flag, no wristRoll. Catalog
re-baked: 355822 tris, manifold, 1 component, genus 2.

`figure.md` updated with the new gold-standard "person holds a thing" recipe
at the top of the section, pointing at the knight as the canonical reference.
`F.holdAt` retained for advanced/two-handed/asymmetric props.

12 new unit tests covering wristRoll anatomy (wrist invariant, elbow not
reflected), palmFacing/thumbAxis aim solvers, `holds` semantics on both hands,
the new finger-cup grip.point offset, and graspProbe pre-bake QC.

Retro filed (`retros/inbox/2026-06-28-figure-grasp-api-rebuild.md`)
documenting the four failure modes that caused this to take four AI sessions
and what would have caught each one earlier.

Validated the API by spawning a subagent with no context and asking it to
make a lumberjack holding an axe in human-style language (no over-specification).
The subagent's experience documents what's still rough for a fresh AI.
