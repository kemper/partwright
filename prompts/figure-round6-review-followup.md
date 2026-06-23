---
date: 2026-06-11
branch: claude/hopeful-franklin-6ucma0
files_changed:
  - examples/figure_sitting_reader.js
---

## Human

(Work-reviewer pass on the branch diff.) Two nits: four catalog entries
marginally over the ~200k tri budget, and the sitting reader's header
comment says "Kneeling-sit" while the pose and catalog description are a
chair sit.

## Assistant

Fixed the comment ("Chair-sit pose … shins straight down"). The triangle
budget nit is accepted as-is: the overage (0.3–4%) buys the sculpted-hand
and face detail this round exists for, every entry is manifold and one
component, and the budget is documented as soft. Reviewer found no
blocking or should-fix issues; FK math, back-compat, docs, catalog JSON
integrity, and example conventions all verified clean.
