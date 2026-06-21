# Model-quality eval corpus

A vision-judged regression suite for the model library (tracking: **#827**).
**Subject-neutral** — a case can be a **figure, animal, accessory, or any
object**; the harness just builds, renders, gates, and judges whatever the model
returns (manifold-js / voxel / scad — not BREP, which can't preview headlessly).
Each case pins a **reference** (the target look) and a **rubric** (a checklist —
anatomy for figures/animals, fit/conformance for accessories, style/proportion
for a look like chibi). The harness builds the case with the *current* library,
renders matched camera angles, runs printability gates, judges the render
against the reference, and compares the score to a committed **baseline** — so a
change can't silently regress the rest of the corpus.

> The `shoulders` case is a figure example. Add an animal/accessory case the
> same way: a `model.js` that returns the geometry, a `rubric.md`, a `case.json`
> with views + gates, and (optionally) a pinned `reference.png` style/anatomy
> target. A consistent style (e.g. chibi) is best driven by pinning a small,
> consistent reference set; a style *rubric* alone also works to start.

Run it:

```bash
npm run eval:models -- shoulders                  # judge current build (claude judge, in-container, default)
npm run eval:models -- shoulders --set-reference  # pin the current render as the target
npm run eval:models -- shoulders --set-baseline   # commit the current score as the baseline (per judge)
npm run eval:models -- shoulders --judge pixel    # free/offline regression sentinel
npm run eval:models -- shoulders --model claude-opus-4-8 --budget 0.20   # pick a judge model
npm run eval:models -- --all                      # whole corpus; exits non-zero on any regression/gate fail
```

## Case layout

```
cases/<case>/
  case.json     # { model, lang, views: [[az,el]…], rubric, gates }
  model.js      # the model built (figure / animal / accessory / object)
  rubric.md     # one judged item per `-` bullet
  reference.png # the target look (pinned via --set-reference, or a real photo grid)
  verdict.json  # (human judge) the filled-in verdict, read back on the next run
```

`baseline.json` (committed) holds the accepted per-case scores. `results/` is
gitignored per-run output (candidate render, contact sheet, result.json).

> **Frame the case `model.js` to its subject.** The renderer fits the whole model
> bbox into each tile, so a small feature on a big body is unreadable to the judge
> — a pair of glasses on a full head+torso+arms bust renders the head ~40 px tall
> and the judge scores it "no glasses present." For a **face accessory** (glasses,
> makeup) build just the **head + neck**; for a **held/worn** item the full figure
> is fine because the accessory (sword, belt, hat, breastplate) is large relative
> to the body. Keep the full-figure showcase elsewhere; the eval case is framed for
> judging, not for display.

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
