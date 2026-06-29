---
date: 2026-06-21
branch: claude/admiring-goodall-1tlwna
files_changed:
  - evals/cases/glasses/*
  - evals/cases/belt/*
  - evals/cases/hat/*
  - evals/cases/cuirass/*
  - evals/cases/sword_scabbard/*
  - evals/cases/makeup/*
---

## Human

You merged the `eval:models` vision-judged eval loop (PR #829) — use it for the
accessory work. Have an agent search the web for good reference images for all 7.

## Assistant

Merged `origin/main` into the branch to pick up the eval harness, then turned the
7 validated accessory items into a durable eval corpus — one case per attachment
mode, so a future change to the attachment layer can't silently regress them.

Each `evals/cases/<case>/` has `model.js` (the validated accessory snippet,
returning the built geometry), a `case.json` (face/figure-facing views — front is
az −90 in the rasterizer frame, plus a 3/4 and a side; gates: manifold +
per-case maxGenus + requireLabels), and a `rubric.md` (a semantic checklist for
that mode — lens-proud/temple-continuous for glasses, plate-not-padded for the
cuirass, blush-on-the-apple-not-streaked for makeup, etc.).

Cases: glasses, belt, hat, cuirass, sword_scabbard, makeup (sword+scabbard share
one model). Proof run: the in-container Claude judge scored glasses 58/100 with a
precise part-level critique + a geometry fix per failed item — exactly the
structured review the manual preview loop lacked.

References + per-judge baselines land in a follow-up commit: a web-search agent
is fetching openly-licensed reference photos (Wikimedia Commons) into
`evals/refs/`; I'll pin each as the case reference and `--set-baseline`. This
commit is the cases (model + rubric + views); the glasses reference is the
bootstrap render pin.
