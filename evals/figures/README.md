# Figure-quality eval corpus

A vision-judged regression suite for the figure library (tracking: **#827**).
Each case pins a **reference** (the target look) and a **rubric** (an anatomical
checklist). The harness builds the case with the *current* `F.*` primitives,
renders matched camera angles, runs printability gates, judges the render
against the reference, and compares the score to a committed **baseline** — so
improving one primitive can't silently regress the rest of the corpus.

Run it:

```bash
npm run eval:figures -- shoulders                  # judge current build (pixel judge, free/offline)
npm run eval:figures -- shoulders --set-reference  # pin the current render as the target
npm run eval:figures -- shoulders --set-baseline   # commit the current score as the baseline
npm run eval:figures -- shoulders --judge gemini --budget 0.05   # real semantic judge (your machine)
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
| `pixel` (default) | **free, offline** | Structural similarity of candidate vs reference tiles. NOT an anatomy judge — a regression sentinel that proves the loop and catches silhouette drift with no API key. |
| `human` | **free** | Emits the contact sheet + a verdict template; you fill score + per-item critique, then re-run to record it. The anchor that keeps the cheap judges honest. |
| `gemini` | **cheap cloud vision** | The real semantic anatomy judge. Shells out to the `gemini` CLI — which lives on **your machine**, not the remote container — on a quota separate from a Claude Max sub. Returns a part-level checklist + suggested geometry fixes. |

The judge always returns a **part-level checklist with a suggested geometry fix
per item**, never just a scalar — that's what made the manual "hand it a photo"
workflow work. Spend (calls / tokens / est USD) is tallied every run and capped
by `--budget`, so looping stays cheap and visible.

## Reference images

The reference can be (a) a pinned render of a known-good build (`--set-reference`,
the bootstrap), or (b) a real multi-angle anatomy reference. The existing
`scripts/generate-reference-images.cjs` (Gemini CLI + nanobanana) already turns
one photo into matched orthographic views — its output feeds straight in here.
Pin a curated, committed corpus; don't live-scrape per run.
