---
date: 2026-11-17
branch: claude/tender-brown-94uuid
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
---

## Human

Scheduled /release run: ship everything on staging to production.

## Assistant

Staging held 35 commits ahead of production, all already on main, with feat: commits and no breaking changes, so a minor bump to 1.15.0. The What's New entry covers only user-facing work: print preview, layered photo prints, layer colours, and the 3MF and annotate fixes. Harness and slicer-CLI work is left out.
