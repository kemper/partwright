---
date: 2026-11-10
branch: claude/tender-brown-vx7qcj
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
---

## Human

Scheduled /release run: ship staging to production.

## Assistant

Staging (== main) had 9 commits over production 1.13.0: three feat PRs (character creator Realistic/Avatar, chat AI Realistic characters, preset thumbnails) and one fix (smile vs mustache). Chose a minor bump to 1.14.0 and wrote a user-facing What's New entry only; no help.ts change needed.
