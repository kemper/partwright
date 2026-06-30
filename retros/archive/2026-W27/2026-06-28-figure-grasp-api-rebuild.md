---
date: 2026-06-28
branch: claude/admiring-goodall-1tlwna
tags: [figure, grasp, api-design, defaults, ai-ergonomics]
---

# The grip rebuild — four AI sessions to get "person holds a sword" right

## Liked

- The user demanded a *categorical* fix, not another magic-number tweak. That forced a real API redesign (`F.grasp` + `holds:` + grip.point in finger cup + `F.graspProbe`) instead of yet another patch on the knight.
- Anatomy-asserting tests (wrist position invariant, forearm-not-reflected) — written after the failed `roll` API shipped — would have caught that defect.
- Pairing each new knob with an empirical render at the user's evaluation angle ("knuckles to camera", "thumb at guard") instead of trusting the math.

## Lacked

- A **success-criteria checklist** for grasping. The four boxes (visible direction, thumb at business end, bar in finger cup, fingers wrap) were implicit in the user's eye, not codified anywhere — so each AI session re-discovered them via complaints.
- **A pre-render QC probe.** Three sessions shipped renders without checking thumb-vs-pommel position; `F.graspProbe` would have caught it programmatically.
- **A "person holds a sword" gold-standard example** at the top of `figure.md`. The docs led with the low-level `holdAt` and explained the COUPLING — but no copy-pasteable recipe for the common case.
- **A regression test for the catalog.** When `grip.point`'s offset moves, every grasped-prop figure visibly changes; no test caught it.

## Learned

- **Defaults are the API.** `grip.point` at the wrist line was a structural defect baked into every figure for months — no per-figure flag could fix it. Moving the default into the finger cup fixed *every* figure silently.
- **The "passing test, broken render" trap is real.** The first `roll` shipped because the unit test asserted gripAxis was bit-identical — true while the elbow bent backwards. The anatomy invariant (forearm doesn't reverse direction through the elbow) is what should have been tested.
- **AI-friendly API design = ONE intent-clear knob per concept.** `wristRoll: 90 + flip: true + manual grip.point shift` is correct but cargo-cult. `holds: 'up' + F.grasp(prop, grip)` encodes the same intent in human language.
- **The auto-flip in `F.grasp` makes "thumb at business end" tautological.** That's good for the user but kills one obvious assertion in `F.graspProbe`. Compensate by checking `gripDirection` against `holds:` intent and `barCupDistance` against the wrist line.
- **For subjective work (how a hand grips, how a face looks), build N variants and show the user before iterating.** This session almost shipped Option A as the knight after the user explicitly said "thumb at the bottom" — only the user's frustration forced me to crop into the hand at high res and see the dagger grip.

## Longed for

- **A CI smoke test that re-renders every catalog figure tagged `holds_prop` and runs `graspProbe` against thresholds.** Catches regressions when `grip.point` or `holds` semantics drift.
- **A `model:preview --grip-overlay` option** that draws arrows for `gripAxis`, `palmNormal`, `thumbAxis` on a held prop. Instant visual QC.
- **A `grasp-qc` subagent / skill** that takes a figure file, runs the standard 4-view render, and reports against the checklist. Decouples the AI's iteration loop from the user's patience.
- **Persistent "common gotchas" registry** (`figures/gotchas.md` or similar) the AI reads at session start. "Dagger grip", "bar at wrist", "thumb on low arm flings elbow out" — known traps with solutions. Three independent sessions re-discovered the same gotchas.
