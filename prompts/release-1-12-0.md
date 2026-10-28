---
date: 2026-10-28
branch: claude/tender-brown-e379rm
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
  - src/ai/toolGroups.ts
---

## Human

Scheduled /release run for kemper/partwright.

## Assistant

Staging had 40 commits over production with no breaking changes, so this is a minor bump to 1.12.0. The What's New entry covers user-facing work only (Parts panel, part selection, import as parts, split export, smooth fills, SES sandbox). Main's unit tier was red because three new tools (listExportItems, partAction, undoPartEdit) were never placed in a tool group after two PRs merged; added them to the objects group so the gate can advance staging.

Update: main moved while the PR was open and its merge ref also failed unit tests (thicknessMap unplaced in a tool group; ai.md 710 chars over the turn-0 budget). Placed thicknessMap in the inspect group and trimmed redundant wording in ai.md (sandbox paragraph, textures paragraph, thicknessMap line) rather than raising the ceiling.
