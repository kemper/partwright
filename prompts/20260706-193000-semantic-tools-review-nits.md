---
date: 2026-07-06
branch: claude/serene-ritchie-jfdhv6
files_changed:
  - src/ai/tools.ts
  - public/ai/reconstruction.md
  - retros/inbox/20260706-semantic-reconstruction-tools.md
---

## Human

(work-reviewer nits on PR #915) profileModel's tool description omitted the
single-section return shape for the axis+at path; compareToImport's `res`
option was console-only and undocumented.

## Assistant

Documented both: the tool description now spells out the SectionProbe shape
the axis+at path returns, and reconstruction.md notes `res` as a console-only
grid override. Reviewer's remaining note (singleton worker vs concurrent
callers) is the pre-existing pattern tracked in #901 — unchanged here. Retro
committed alongside.
