---
date: 2026-06-21
author: claude (opus-4-8)
task: Vision-judged figure-quality eval loop — eval:figures harness + in-container claude judge (PR #829, tracking #827)
---

## Liked
- Reusing `scripts/cli/preview.mjs` (`runPreview` / `composePng` / `resolveViews`)
  meant the whole render path was free — the harness is mostly glue. The one
  read-only `explore` agent up front also caught that `generate-reference-images.cjs`
  and the anthropometry miner already exist, so I built *on* the reference
  pipeline instead of reinventing it.
- Proving the loop with a free deterministic `pixel` judge BEFORE the expensive
  semantic one meant every mechanic (regression gate, exit codes, baseline,
  tolerance band) was validated at $0 — the costly claude run only had to prove
  *critique quality*, which it did on the first try.

## Lacked
- A way to know up front that shelling `claude -p` inside the repo would trip the
  project's own Stop hook and replace the model's answer with reconcile text. Cost
  one confused run before I moved cwd to `tmpdir()`. Worth a one-liner in docs:
  "nested `claude -p` must run outside the repo or hooks eat the output."
- The bootstrap reference is a render of the model itself, so the judge currently
  grades against the *rubric*, not the left column — the reference isn't pulling
  weight until a real anatomy photo is pinned. Fine for v0, but the loop's full
  value is gated on the corpus work (#827).

## Learned
- **The `claude` CLI is a usable in-container vision judge.** `claude -p
  --output-format json --model <id>`, image via `@<abs-path>`, run from `tmpdir()`.
  The envelope gives `.result` (the model's JSON) + `.total_cost_usd` + `.usage` —
  everything a spend tally needs. Bills against Max OAuth, so it's free-at-the-margin.
- **LLM-judge baselines must be per-judge AND tolerance-banded.** A claude 72 and a
  pixel 100 measure different things (cross-judge compare = false regression), and
  the same judge jitters ±a few points run-to-run, so a hard `score < baseline`
  gate false-positives. Both bit immediately on the first live run.

## Longed for
- A tiny shared helper for "shell to a Claude/Gemini CLI and get back parsed JSON +
  usage" — the claude and gemini adapters in `judge.mjs` are near-duplicate
  execFile→extractJson→usage shapes. If a third CLI judge lands, extract it.
- The headless-vs-browser component/paint oracle (#697) so the printability gate in
  this harness is browser-faithful, not SSR-optimistic. The eval loop and #697 want
  the same oracle.
