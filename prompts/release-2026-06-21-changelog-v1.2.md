---
date: 2026-06-21
branch: claude/changelog-help-pages-pr-4o9wlo
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
---

## Human

Under these features, for production, can we create a PR to update the external
changelog and the help pages? And then create a release for the staging →
production release.

## Assistant

Same two-step shape as the previous (1.1) release, and the order is forced by
the pipeline's pure-promotion invariant: a `staging` → `production` PR must
carry **zero** content beyond `main`, and CLAUDE.md is explicit that
changelog/help/version edits land on `main` first (never on the release
branch). So this PR is the docs/version-bump half that flows main → gate →
staging; the promotion PR is cut *after* it reaches staging.

What was undocumented since v1.1.0 — `staging`/`main` were 7 commits ahead of
the v1.1.0 production tag, including two user-facing `feat:` merges:

- **paintImage AI tool** (`feat: paintImage AI tool with view-based decal
  placement`) — the in-browser assistant can now project a raster image / SVG
  onto the model surface from a named view (front/back/left/right/top/bottom)
  or auto-fit to a labelled part, instead of approximating a logo with flat
  colour regions.
- **Room-scaled ground grid** (`feat: scale the ground grid to the studio room
  instead of a fixed patch`) — the grid now tracks model/room size and respects
  the grid-density Advanced Setting instead of being a fixed 40×40 patch.

Scope decisions:

- **Version → 1.2.0 (minor).** Both new capabilities are backward-compatible
  `feat:` work (old sessions/exports still load), so a minor bump per the semver
  rules. The bump rides this `main`-bound PR so it flows through the gate; the
  `release-tag` Action tags `v1.2.0` on promotion. Without the bump the release
  would no-op the tag and ship the features unversioned.
- **Changelog** (`whatsNew.ts`) — added a new "June 21, 2026 — Partwright 1.2"
  week entry at the top (Releases / AI assistant / Studio groups), above the
  unchanged 1.1 entry.
- **Help** (`help.ts`) — extended the "what the assistant can do" line in the
  *AI assistant in the browser* section to mention projecting an image/logo onto
  the surface from a chosen view. The grid change is a minor Advanced-Settings
  knob, so it's covered by the changelog rather than a new help section.

Verified: `npm run typecheck`, `npm run test:unit` (1566 pass), and browser
snapshots of `/whats-new` and `/help#ai-browser`.
