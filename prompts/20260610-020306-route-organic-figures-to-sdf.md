---
session: "a7f3c1"
timestamp: "2026-06-10T02:03:06Z"
model: claude-opus-4-8
tools: [model-preview]
---

## Human

An in-app AI session asked to make a 3D model of a photo of a child failed
badly — it produced oval spheres and a soup of arm/leg segments by union-ing
constant-radius primitives. When asked how it could do better, the model
switched to an SDF approach which was far better. The user forwarded the
model's own retrospective: the root cause was committing to "union of
constant-radius primitives" (ceiling: tubes-and-balls) before checking whether
that method could reach a "smooth figurine" goal, and judging success only by
"is it manifold / does it print" rather than resemblance to the reference.
The model proposed: (1) a method-selection step before coding, (2) treat
"smooth/organic" as a routing keyword the way "fillet → BREP" already routes,
(3) a quality bar against the reference image, (4) a cheap proof-of-concept
gate for hard categories. Asked me to investigate and decide what to change in
the agent instructions / AI system prompt.

## Assistant

## Key decisions

**Root-cause framing.** The in-app AI's system prompt is `PREAMBLE + public/ai.md`
(full, cached), with `public/ai/*.md` subdocs fetched on demand via `readDoc`.
A rich `sdf.md` subdoc and a good `/portrait` prefill (`photoModelPrompt.ts`)
already encode the right method (SDF `smoothUnion`, staged build, resemblance
check) — but that wisdom only fires when the user runs `/portrait`. Free-form
"make a figurine of this kid" gets the generic `ai.md`, whose verb decision
tree routes *verbs* (smooth blend, twist, lattice) but never routes the
*object category* (organic figure / creature / body) to SDF. So the fix is to
lift the category-routing rule into the always-loaded prompt, not to build new
tooling — items 1-4 were judgment gaps, not missing capabilities.

**Changes (docs + the local-prompt readDoc lists only — no behavior code):**
- `ai.md` "Before you start": new step 3, "match the construction method to
  the subject before writing code." States the organic→SDF routing, the
  resemblance bar (not just `isManifold`), and the 3-line POC spike for hard
  subjects. Renumbered the rest.
- `ai.md` verb tree: added an object-category row (organic figure/creature/body
  → SDF capsules + `smoothUnion`, explicitly NOT primitive unions).
- `ai.md` common-mistakes: added the "primitive soup" anti-pattern bullet.
- `ai.md` topic index: `sdf` row now lists figurine/character/creature/body as
  routing keywords.
- `sdf.md`: organic figures added to "when to reach for this," plus a worked
  "Organic figures & creature bodies" recipe (capsule limbs + ellipsoid masses
  + `mirrorPair` symmetry + `smoothUnion` welds + flat base) and a 6-step
  workflow ending on "judge against the reference, not just `isManifold`."
- `reference-images.md`: photo-to-model flow now splits rigid subjects (the
  existing mass-decomposition loop) from organic/figural subjects (SDF blends,
  resemblance criterion, `/portrait`).
- `systemPrompt.ts`: added `sdf` to both local-model `readDoc` name lists — it
  was previously undiscoverable for local models.

**Verification.** Ran the new `sdf.md` figure recipe through `model:preview`:
`isManifold: true`, `componentCount: 1`, recognizable smoothly-blended humanoid
on a flat base — confirming the documented recipe runs and produces a single
watertight figure, not "soup." A doc recipe that doesn't run is worse than none.

**Scope choice.** Did not touch `photoModelPrompt.ts` (already correct) or add
runtime behavior — the failure was a routing/judgment gap in the always-loaded
prompt, so the surgical fix is prompt/doc content the model reads every turn.
