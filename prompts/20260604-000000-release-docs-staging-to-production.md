---
date: 2026-06-04
branch: claude/hopeful-rubin-ptt9X
files_changed:
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
  - public/llms.txt
  - public/ai.md
  - public/ai/gotchas.md
  - public/ai/colors.md
  - public/ai/annotations.md
---

## Human

We're at a good point to release. Make a staging → production merge PR, and
ensure the changelog, help page, and other documentation are updated based on
the work done since the last merge to production.

## Assistant

This is a release: the deliverable is a PR from the staging line into
production, with the user-facing docs caught up to everything merged since the
last production release (#365, May 30 evening).

Two things drove the doc edits:

1. **The changelog had drifted.** Production's `src/ui/whatsNew.ts` carried a
   "May 30, 2026" entry (surface modifiers, Ideas library, landing perf), but
   the content-data refactor that moved the changelog to
   `src/content/data/whatsNew.ts` branched before that entry landed — so
   staging's changelog was *missing* it. Releasing staging as-is would silently
   drop a released entry. I restored the May 30 entry verbatim and added a new
   "May 31 – June 3, 2026" entry summarizing the ~80 feat/fix commits in that
   window (multi-file OpenSCAD + companion files, unified/draggable viewport
   panels, Quality panel, Resize panel, `api.text`, color-based bucket + Replace
   paint tool, projection brush, plan-first AI mode, static content pages,
   in-app dialogs, version provenance).

2. **Removed features left stale docs.** `feat: remove color-region editor
   lock` deleted the paint-driven editor lock, but the help page and the
   AI-facing docs still described it as active. Corrected:
   - `help.ts`: dropped the "Editor lock / Unlock to edit" paragraph; refreshed
     the paint tools (now five: Bucket color-or-geometry, Brush, Slab, Shape,
     Replace), the viewport tools (Simplify → Quality, plus Resize and Surface),
     the Quality/Settings split, and added `api.text` + multi-file SCAD.
   - `llms.txt`, `ai.md`, `ai/gotchas.md`, `ai/colors.md`, `ai/annotations.md`:
     reframed "painting locks the editor" as "re-running invalidates the painted
     triangle indices — `clearColors()` to iterate", which is the underlying
     correctness fact that survives the lock removal.

Verified with `npm run build` (type-check) + `npm run test:unit` (598 pass) and
a browser screenshot of the regenerated static `/whats-new` and `/help` pages.
