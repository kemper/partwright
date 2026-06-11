---
session: "a7f3c1"
timestamp: "2026-06-10T02:23:05Z"
model: claude-opus-4-8
sequence: 2
---

## Human

Even on this branch (the PR #563 doc changes), an in-app AI given a photo of a
person and asked to "create a model of the person in this photo" still does a
terrible job — primitive-soup. But the moment the user replies "this is
terrible. Use SDF and do better," the very next attempt is far better. The user
proposed making it a direct default: tell the model to use SDF when modeling
humans, animals, and other organic shapes unless told otherwise (e.g. voxel).

## Assistant

## Key decisions

**Why the first PR wasn't enough.** PR #563 put the organic→SDF routing into
`public/ai.md` — but that doc is huge and cached, and the guidance lived in
prose (a numbered "Before you start" step + a verb-table row). The model
glossed it. The tell: the user's manual "use SDF" message works *immediately*
on the next turn. That's a recency + directness effect — the instruction has
to be short, imperative, and high in the attention budget, not buried in a long
reference doc.

**Fix: promote the directive to the two highest-attention channels.**
- `systemPrompt.ts` PREAMBLE (cached, top of the system prompt): added a
  bold, imperative "MODELING PEOPLE, ANIMALS, AND ORGANIC FORMS — DEFAULT TO
  SDF" paragraph. Says to build with `api.sdf` (capsule limbs + ellipsoid
  masses + smoothUnion + mirrorPair), call `readDoc("sdf")` first, never
  assemble organic figures from primitive unions, and the only opt-out is the
  user explicitly asking for voxel / low-poly / relief. Explicitly: "You do not
  need the user to say 'use SDF' — choose it yourself from the first version."
- `systemPrompt.ts` `toggleSuffix` (the per-turn suffix, regenerated each turn):
  added a concise standing reminder. This is the channel whose own code comments
  say "more-recent + more-specific instruction wins" — i.e. the exact recency
  lever that makes the user's manual nudge work. Replicating it here means the
  user no longer has to type it. The line self-scopes ("organic subjects → …"),
  so it's harmless on mechanical/abstract tasks.

**Cost trade-off.** The suffix line is ~70 tokens/turn (not cached). Justified:
the behavior fails reliably without it, and reliability beats a small per-turn
cost. The bulk of the guidance stays in the cached preamble + ai.md.

**Verification.** `npm run build` + `npm run test:unit` (981 passed). The
existing suffix assertions (`tests/ai-providers.spec.ts`) check capability
toggle substrings my additive line doesn't disturb. The figure recipe itself
was already proven to render (isManifold, componentCount 1) in sequence 1.
