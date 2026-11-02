---
session: "ad71db73"
timestamp: "2026-11-02T19:30:00Z"
---

## Human

Skip the history rewrite and leave `pr-assets` alone, but make sure the agent
instructions caution enough against any future copyright, license or
trademark infringement.

## Assistant

## Key decisions

- **One full section in `CLAUDE.md`, short forms where the work happens.** The
  earlier "Third-party content" rules only covered files and names. The
  section is now "Copyright, licenses and trademarks" and adds: which asset
  licenses are OK (CC0, CC BY with credit, BY-SA only for standalone assets;
  ND, NC, "personal use", unlicensed need the owner), recording the source at
  download time, no copying a character's design under a generic name, no
  likeness of a real person, trademarks only in compatibility prose, and code,
  dependency and font licensing (the repo is PolyForm Noncommercial, so
  copyleft code can't be pasted in).
- **Enforcement point: `work-reviewer`.** It now hunts for unrecorded or
  disallowed third-party files, character and brand names, copied code and
  copyleft dependencies as must-fix findings. A static lint can't see this.
- **Short forms** go in the agents and skills that create or describe content:
  `model-sculpt`, `model-critic`, `inverse-sculpt`, `implementer`, `/sculpt`,
  `/inverse-cad` (check the target's license before reconstructing),
  `/promptlog`, `/retro` and `/release` (What's New names).
- **In-app AI prompts unchanged.** `public/ai.md` drives the user's own
  private sessions, where modelling what they like is their call; shipped
  starter prompts are covered by the `CLAUDE.md` rule.
- **pr-assets is append-only and public**, so the rules now say a mistake
  there can't be cleaned up, which is why screenshots must be checked first.
