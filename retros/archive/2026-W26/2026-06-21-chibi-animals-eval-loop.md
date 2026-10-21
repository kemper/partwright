# Retro — chibi cat/dog animals + adopting the eval:models loop

_2026-06-21, session sharp-bell. Built cute chibi cat & dog SDF figurines for the
figure API, reusing figure-API quality techniques, then tested the newly-merged
`eval:models` vision-judge loop with user-supplied reference photos._

## Liked
- The independent **judge → sculpt → re-judge** loop converged the look reliably (cat/dog 3–6/10 → 6.5–7.2/10 over four rounds). An *independent* critic agent (separate from the sculptor) caught things the sculptor's own self-review missed.
- **Figure-API technique transfer was the single biggest quality jump**: ball-inside-ball eyes (crisp paintable iris/pupil vs blank union-bump domes), nested face detail-regions, `surfaceMarking` conformal pads (pink inner-ear), and the `k ≈ 0.2×radius` weld rule. Mining `sdfFigure.ts` beat re-deriving from scratch.
- `model-sculpt` / `explore` subagents kept image-heavy iteration out of the main context; `SendUserFile` shipped finals without re-billing image tokens.
- The merged `eval:models` ran **in-container** and immediately drove a measurable **18 → 42** after enlarging eyes — it productized the manual loop (committed reference + rubric + gates + baseline + cost cap).

## Lacked
- **No quadruped rig** — animals are hand-sculpted SDF; the common skeleton (spine + 4 legs + tail + head) is re-derived per model. Figures get a structural `componentCount:1`/manifold guarantee from the rig; animals don't.
- **The eval renders grey/normal-shaded**, so color-dependent features (iris/pupil/nose/inner-ear) that exist as real geometry read as "missing" to the judge — capped the score on invisibles, not defects. Filed as #833.
- **Couldn't re-kick CI**: `rerun_failed_jobs` → 403 for the integration, no `gh` CLI, GitHub MCP token expired mid-session. Refreshing a flaky shard requires a brand-new push.
- **No way to resume a finished subagent** (`SendMessage` unavailable) — each sculpt round respawned a fresh agent and re-passed the full context/critique.

## Learned
- **The manifold/`componentCount` gate does NOT catch print-stability.** All four models passed those gates while still having bowl/rocking bases, knife-thin ears, and a fragile cantilever paw. Needed explicit flat-base + min-thickness + no-cantilever checks added by hand (the critic, not the gate, caught them).
- **"Front" of an SDF figure is empirical.** `model:preview`'s default iso hid the face; the face was at **az=270**, not the source comment's "-Y". Spin to find the face before judging or wiring eval-case `views`.
- **Eval-case `views` must reveal tail/paws/underside**, or the judge reports existing features as absent (it dinged the cat's tail/paws/base because no view showed them).

## Longed for (highest-value)
- **A reusable printability gate** (flat base, min feature thickness, no thin cantilever) callable from both `model:preview` and `eval:models` gates — would have caught the rocking-base / thin-ear / cantilever-paw defects automatically instead of via critic prose across two rounds.
- **Colored-bake rendering in `eval:models`** (#833) so the loop judges what actually ships, not a grey form proxy.
- **Subagent resume across turns** (`SendMessage`) so multi-round sculpt iteration doesn't re-pay context setup each round.
- **A `F.quadruped` rig** so animals inherit the same structural manifold guarantee figures get — the natural next capability once a few hand-built animals reveal the shared skeleton.
