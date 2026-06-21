# Figure-quality eval corpus

A vision-judged regression suite for the figure library (tracking: **#827**).
Each case pins a **reference** (the target look) and a **rubric** (an anatomical
checklist). The harness builds the case with the *current* `F.*` primitives,
renders matched camera angles, runs printability gates, judges the render
against the reference, and compares the score to a committed **baseline** — so
improving one primitive can't silently regress the rest of the corpus.

Run it:

```bash
npm run eval:figures -- shoulders                  # judge current build (claude judge, in-container, default)
npm run eval:figures -- shoulders --set-reference  # pin the current render as the target
npm run eval:figures -- shoulders --set-baseline   # commit the current score as the baseline (per judge)
npm run eval:figures -- shoulders --judge pixel    # free/offline regression sentinel
npm run eval:figures -- shoulders --model claude-opus-4-8 --budget 0.20   # pick a judge model
npm run eval:figures -- --all                      # whole corpus; exits non-zero on any regression/gate fail
```

## Case layout

```
cases/<case>/
  case.json     # { model, lang, views: [[az,el]…], rubric, gates }
  model.js      # the figure built with the current library
  rubric.md     # one judged item per `-` bullet
  reference.png # the target look (pinned via --set-reference, or a real photo grid)
  verdict.json  # (human judge) the filled-in verdict, read back on the next run
```

`baseline.json` (committed) holds the accepted per-case scores. `results/` is
gitignored per-run output (candidate render, contact sheet, result.json).

## Judges (tiered by cost — this is the whole point)

| Judge | Cost | What it is |
|---|---|---|
| `claude` (default) | **Max OAuth, in-container** | The real semantic anatomy judge. Shells to the `claude` CLI in headless print mode (`-p --output-format json`) — present in the Claude Code container, billed against your Max subscription — so it **runs and is testable right here**. Returns a part-level checklist + suggested geometry fixes. `--model` picks the model (default `claude-sonnet-4-6`). |
| `pixel` | **free, offline** | Structural similarity of candidate vs reference tiles. NOT an anatomy judge — a regression sentinel that proves the loop and catches silhouette drift with no key. |
| `human` | **free** | Emits the contact sheet + a verdict template; you fill score + per-item critique, then re-run to record it. The anchor that keeps the semantic judge honest. |
| `gemini` | **cheap cloud vision** | Alternate semantic judge on a quota *separate* from Max. Shells to the `gemini` CLI, which lives on **your machine**, not the container. |

The judge always returns a **part-level checklist with a suggested geometry fix
per item**, never just a scalar — that's what made the manual "hand it a photo"
workflow work. Spend (calls / tokens / est USD) is tallied every run and capped
by `--budget`; baselines are keyed **per judge** (a `claude` 72 and a `pixel`
100 aren't comparable). The `claude` cost is the equivalent-API estimate the CLI
reports — actual billing is your Max quota.

The `claude` judge is **noisy** (±a few points run-to-run), so use
`--tolerance N` to set how far below baseline counts as a regression (e.g.
`--tolerance 5`); the deterministic `pixel` judge needs no tolerance.

## Reference images

The reference can be (a) a pinned render of a known-good build (`--set-reference`,
the bootstrap), or (b) a real multi-angle anatomy reference. The existing
`scripts/generate-reference-images.cjs` (Gemini CLI + nanobanana) already turns
one photo into matched orthographic views — its output feeds straight in here.
Pin a curated, committed corpus; don't live-scrape per run.
