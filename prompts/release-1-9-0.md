---
date: 2026-10-25
branch: claude/tender-brown-frx7dt
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
---

## Human

Scheduled /release run: ship staging to production.

## Assistant

Preflight found 149 commits on staging not yet in production, staging a subset of main, and several `feat:` PRs and no breaking changes, so a minor bump (1.8.1 → 1.9.0). Added the What's New entry covering only user-facing changes and bumped package.json on a branch into main, per the pure-promotion rule.
