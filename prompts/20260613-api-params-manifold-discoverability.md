---
date: "2026-06-13"
task: "docs: make api.params discoverable as a native manifold-js feature for the AI"
pr: draft
areas: [ai, docs]
---

## Human

Reported a session where, after asking the in-app AI to recreate a parametric
SCAD model in manifold-js (for render performance) and then re-add the
parameters, the AI seemed unsure that parameters were a manifold-js feature at
all — it framed `api.params` as something it had only seen "mentioned
implicitly in one of the docs related to the UI," and said it would have to
look at the docs to find out whether params were even possible in manifold-js.
Asked me to investigate why this capability is non-obvious to the model and, if
I found the cause, open a PR.

## Assistant

**Diagnosis — a documentation *framing/discoverability* gap, not a missing
feature.** `api.params` is a genuine, first-class manifold-js capability
(`src/geometry/params.ts`, shared verbatim by all three JS-sandbox engines —
manifold-js, voxel, replicad). Three things conspired to make the model read it
as a SCAD/UI thing:

1. **Framed UI-first everywhere.** The `ai.md` sandbox member-list bullet and
   the section header both led with the *Customizer panel* ("sliders/toggles in
   the viewport"), so a model scanning for "is `api.params` a manifold-js *code*
   feature?" came away thinking it was UI chrome — exactly the user's report
   ("mentioned implicitly in one of the docs related to the UI").

2. **No authoritative reference answered the question.** When the model tries to
   "look at the docs" to confirm, the natural fetch is `readDoc("manifold-api")`
   — the doc literally titled *Manifold API Reference*. It listed Manifold /
   CrossSection / Curves / sdf / meshOps but **never mentioned `params`**. There
   is no `customizer`/`params` subdoc either, so there was nothing definitive to
   land on.

3. **Slim prompts silent.** The local/medium system prompts never mentioned
   params, so smaller models had zero signal.

(The capability matrix at `ai.md:75` *did* state it correctly — but that one
correct mention was outweighed by the UI-first framing everywhere else.)

**Fix — close the gap at the exact point the model looks, code-first:**

- `public/ai/manifold-api.md`: added a `params (flat on api)` entry stating it's
  a NATIVE manifold-js feature (also voxel + replicad; not scad), so the
  reference an uncertain AI fetches actually answers "yes."
- `public/ai.md`: reframed the `params` member bullet and the "Customizer
  parameters" section opener to lead with "this is a manifold-js *code* feature
  — you do NOT need SCAD for a parametric model," keeping the panel as a
  secondary benefit.
- `src/ai/systemPrompt.ts`: added a short `api.params` example to the medium
  local prompt (left the most token-constrained slim prompt untouched).

Docs + one string template; `npm run typecheck` clean.
