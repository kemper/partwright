---
date: 2026-06-13
branch: claude/charming-euler-b9xe1c
files_changed:
  - src/content/data/whatsNew.ts
---

## Human

Create a PR to update production from the latest staging. Update the docs and
public changelog as needed since the last release. Create a new branch that is a
copy of the current staging branch.

## Assistant

The request bundles two things the deployment pipeline keeps strictly separate,
so I split them to respect the production-promotion invariant (a production PR
must be a *pure promotion* — zero content beyond `main`; the
`production-promotion-guard` Action fails otherwise, and CLAUDE.md says
changelog edits land on `main` first, never on the release branch):

1. **Release promotion** — created `release/2026-06-13` as an exact copy of
   `origin/staging` and opened a draft PR into `production`. Verified the branch
   is identical to staging and a clean subset of `main`
   (`git log origin/main..HEAD` empty), so the guard passes. No edits ride on it.

2. **Changelog** — the "public changelog" is the `/whats-new` page backed by
   `src/content/data/whatsNew.ts` (help/llms.txt only link to it). Production
   (#628) shipped with the changelog identical across main/staging/production,
   so everything that landed after the release — figure diversity (skin tones,
   faces, hair, cornrows/locs), footwear (shoes/boots, soles, F.standOn), layered
   iris/pupil eyes, headwear + new hair, the ⚙ editor settings menu and line-wrap
   toggle, sliding AI/code panes + preserved camera, inline export units, the
   8-model catalog refresh, setVoxelRounding/getVoxelRounding, and stale-deploy /
   stuck-turn recovery — was uncovered. Added a new "June 12 – 13, 2026" week
   entry at the top of `WHATS_NEW_WEEKS` grouping these by theme. This goes onto
   `main` via a `docs:` PR so it flows main → gate → staging → a later release,
   per the one-directional pipeline; it deliberately does not ride the promotion
   branch.

Verified with typecheck, the unit tier (1343 passing), and a `/whats-new`
screenshot showing the new entry at the top.
