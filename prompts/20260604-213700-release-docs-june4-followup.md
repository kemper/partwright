---
session: "ZvDxi"
timestamp: "2026-06-04T21:37:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 2
---

## Human

I've merged a few more things I want to release. Be sure that staging has
updated from the latest main and included the most recent work in this release.
Update the changelog, docs, help, etc as needed.

## Assistant

## Key decisions

**Re-scoped the changelog to the grown release range.** After the first docs PR
(#435) merged, the user merged more work, so `production..main` grew to 65
non-merge feature commits. Diffing the full range against my existing June 4
entry surfaced features I'd missed because they weren't on `staging` when I first
scoped it:

- **Image paint** (the big one) — project an image onto the surface as color
  regions, click-to-stamp with hover preview + rotation, a stamp-then-refine
  *smooth* mode that subdivides the footprint to follow curvature, alpha flood
  fill, and SVG-quality input. Gave it its own "Painting" group bullet.
- **Cancel long renders** — the hard render execution timeout was removed in
  favor of the Cancel button; folded the new manifold-js OOM hint into the same
  "Viewport & rendering" bullet.
- **Mesh-quality knobs** — edge-length / size-threshold controls added to the
  Quality panel's simplify / enhance.

**Edits.** Expanded the `June 4, 2026` entry in `whatsNew.ts` (new headline, new
Painting group, renamed "Viewport & painting" → "Viewport & rendering" with two
added bullets) and added an **Image** paint-tool bullet to the Help page's paint
tools list. Verified with build + unit (649 pass) and a screenshot of the
rendered `/whats-new` top.

**Pipeline note.** Same rule as before: these edits go to `main` first, then the
gate advances `staging`. I reset the (already-merged) `claude/peaceful-faraday-ZvDxi`
branch to latest `origin/main` (b038a55) before editing so the new docs sit on
top of the most recent work, and I'm watching `staging` advance via the local git
mirror before cutting the `staging → production` release PR as a pure promotion.
