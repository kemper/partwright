---
date: "2026-06-13"
task: "docs: add footwear usage-pointer comment (and re-trigger PR CI)"
pr: 634
areas: [figure, docs, ci]
---

## Human

(Implicit) Get the full PR CI suite green on the final footwear code.

## Assistant

The big footwear commits (sole region, F.ground, the shoe reshape, the new
example) never ran the full pr-checks / code-quality suite — synchronize events
stopped firing after several rapid back-to-back pushes (pr-checks uses
concurrency cancel-in-progress, and md-only commits are paths-ignored). The code
is locally green (typecheck + 1297 unit), but CI must validate it.

This commit adds a small genuine source comment (a usage pointer on
`buildFootwear` to the sneakers/superhero examples) purely to produce a non-md
change that re-fires the PR workflows on the final tree. No behavior change.
