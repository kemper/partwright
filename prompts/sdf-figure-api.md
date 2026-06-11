---
session: "agent-docs-sdf-modeling"
timestamp: "2026-06-10T04:00:00Z"
model: claude-opus-4-8
tools: []
---

## Human

I recently merged agent-doc changes that make human/organic modeling default to
SDF. I asked another AI for feedback on how to make better faces (chat history
attached); it proposed an `api.sdf.face` library (landmark-anchored head +
parametric feature primitives + crease-preserving welds).

Decisions reached in discussion:
- Take the idea further than faces — a full stylized FIGURINE API (rig + parts:
  feet, legs, torso, arms, head, hair, clothes), not just faces.
- Aesthetic target: **stylized figurine** (art-toy / posable mannequin), not
  photoreal humans. Composable **rig + parts**, not a one-call humanoid.
- Modest forward-kinematics posing.
- Write a design doc, then implement immediately. Then use 5 subagents to build
  5 catalog entries with the new API; have them feed back on the API; act on the
  feedback right away (and drop retro notes in the inbox).

## Assistant

Built `api.sdf.figure` — a deterministic **rig** + posable part builders layered
on the existing `api.sdf` tree. Why a rig: the attached transcript showed the
three reliable ways an LLM-built figure fails — coordinate guessing
(`[-4.5,0,42]` shoulders), floating-part `componentCount` splits, and a single
uniform blend `k`. The rig fixes the first two *structurally*: joints/landmarks
are computed from proportions + a pose, and limbs span jointA→jointB so parts
always overlap (one component, verified on the first headless render).

`src/geometry/sdfFigure.ts` is decoupled from `sdf.ts` (it receives the
namespace structurally and defines its own `Node` type) so the module graph
stays acyclic — `sdf.ts` imports the figure factory one-directionally. Surface:
`figure.rig({height, headsTall, build, pose})`, parts
(torso/neck/arms/hands/legs/feet/head/base), `face.{eyes,nose,mouth,ears,brows,
assemble}`, hair, `clothing.{pants,top}`, and `weld`. Localized blend = soft
`weld` for body joins vs sharp creases in `face.assemble`. Doc: `public/ai/
figure.md` (+ registered the `figure` subdoc; pointed the system prompt and
`sdf.md` at it for humanoid subjects).

**Subagent feedback → fixes applied in the same change.** Five `model-sculpt`
agents each built a catalog figure (waving kid, double-biceps strongman, chibi
wizard, warrior lunge, ballerina) and reported API gaps. Two independent agents
hit the headline bug: **the elbow hinge is geometrically wrong for a raised
arm** — it curls the forearm backward in the horizontal plane, so double-biceps
and ballet-fifth poses were unreachable, and the `twist` pose param was parsed
but never used. Fix: wired `arm.twist` as a forearm-roll DOF (rolls the elbow
hinge about the upper-arm axis); `twist≈90` now lifts the fists up (verified).
Also from feedback: **symmetric `arms`/`legs` pose shorthand** (seed both sides);
**feet now follow the ankle** + **`F.base` auto-sizes to the stance and rises to
the lowest foot** (fixes the lunge/tiptoe foot-detach → `componentCount>1`);
softened the within-limb knee/elbow taper seam; added **`rig.r.waist`** + a
`placeAt(node, joint, {anchor})` accessory-snap helper; documented the hidden
radii, `build` multipliers, twist recipe, and waist=navel anchor. The one gap
left as a tooling follow-up (retro): SDF `.label()` regions don't surface in
`model:preview` stats (they paint fine in-app — confirmed at bake time).

Verification: 22 figure unit tests (proportion scaling, L/R symmetry, pose FK,
twist roll, one-component invariants, validation); full suite 1003 green; build +
madge clean. The 5 catalog entries baked via `single-catalog-entry.cjs` (all
manifold, single-component, painted by label, <150 KB) and added to
`manifest.json`.
