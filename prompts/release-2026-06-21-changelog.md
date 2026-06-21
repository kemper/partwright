---
date: 2026-06-21
branch: claude/sharp-bardeen-4312qm
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
---

## Human

I merged some new features to main since the last release. I'd like to merge
staging to production and I'd also like to create a PR that has an update to the
public changelog, help, and docs.

## Assistant

The two asks are sequential, not parallel, because of the pipeline's
pure-promotion invariant: a `staging` → `production` PR must carry **zero**
content beyond `main`, and CLAUDE.md is explicit that changelog/help/docs edits
land on `main` first (never on the release branch). So this PR is the
docs/version-bump half that flows main → gate → staging; the release promotion
is cut *after* it reaches staging (the user chose "docs first, then release
v1.1.0").

Scope decisions:

- **Version → 1.1.0 (minor).** Everything since v1.0.0 is backward-compatible
  `feat:` work (old sessions/exports still load), so a minor bump per the semver
  rules. The bump rides this `main`-bound PR so it flows through the gate like
  any other change; the `release-tag` Action will tag `v1.1.0` on promotion.
- **Changelog** — the `/whats-new` page (`whatsNew.ts`) was current only through
  the "Partwright 1.0" week. The post-1.0 features merged to `main`
  (Character Creator, typed session attachments, `api.sdf.tube` directional
  textures, the shared palette-modal color picker + whole-part recolor, the
  opt-in studio Light toggle, AI publish auto-populate, colored fast SDF
  previews) were undocumented. Added a new "June 21, 2026 — Partwright 1.1" week
  entry at the top, grouped by theme.
- **Help** (`help.ts`) — added a "Character Creator (no-code figures)" section,
  a `Light` viewport-tool bullet, an Attachments paragraph in Sessions, and an
  `api.sdf.tube` mention in the SDF paragraph.
- **Docs** — the AI-agent reference (`public/ai.md`, `public/ai/sdf.md`,
  `figure.md`, `reference-images.md`) already covers `api.sdf.tube`, Character
  Creator/`buildCharacter`, and attachments (added in their feature PRs under
  the UI↔JS-API parity rule), and `llms.txt` is a stable entrypoint that already
  links to `/whats-new` — so no further doc edits were warranted.

Verified with typecheck (clean), the unit tier (1558 passing), and `/whats-new`
+ `/help#character-creator` screenshots showing the new content rendered.
