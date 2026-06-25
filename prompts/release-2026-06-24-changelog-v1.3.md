---
date: 2026-06-24
branch: claude/funny-fermat-7zwulr
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
---

## Human

Prepare another staging → production release. First make a PR to update the
externally facing changelog and anything else that needs updating doc-wise.
Then also make a PR to merge staging into production.

## Assistant

Same two-step shape as 1.2: docs/version bump goes in via `main` so the pipeline's
pure-promotion invariant holds — a `staging` → `production` PR must carry zero
content beyond `main`, and CLAUDE.md is explicit that
changelog/version edits land on `main` first (never on the release branch). The
promotion PR is cut *after* this one reaches staging via the gate.

What's in this release (40 non-merge commits on `origin/staging` not on
`origin/production`). Filtering to user-facing changes (the eval:models,
headless-rasterizer, palette-preview, retro, and test-only commits stay out of
the public changelog — those are agent-tooling internals):

- **Catalog**: chibi cat and chibi dog as parametric figures with
  paramsSchema-driven pose/build/colorway presets (siamese / calico / tabby
  /tuxedo for cats; brindle / dalmatian and more for dogs). Cat face polish:
  cream muzzle, ω mouth, flatter eyes framed by figure-API eyelids.
- **New paint API — `api.paint.pattern`**: procedural stripes / spots /
  patches / gradients with regional scope predicates, rendered live in the
  editor (per-triangle colors now flow through the in-app render path).
- **Performance**: SDF distance functions are now compiled to flat JS
  (`src/geometry/sdfCompile.ts`), ~3× speed-up on figure evaluation.
- **Painting bug fixes**: sliver streaks at smoothed brush edges, `api.label`
  underlay coverage across incremental strokes, and concave-footprint regions
  no longer leave buried triangles unpainted.

Scope decisions:

- **Version → 1.3.0 (minor).** All new capabilities are backward-compatible
  `feat:` work (existing sessions/exports still load), so a minor bump per
  CLAUDE.md's semver rules. The bump rides this `main`-bound PR so it flows
  through the gate; `release-tag.yml` tags `v1.3.0` on promotion. Without the
  bump the release would no-op the tag and ship the new features unversioned.
- **Changelog** (`whatsNew.ts`) — added a new "June 24, 2026 — Partwright 1.3"
  week entry at the top (Releases / Catalog / Painting / Performance groups),
  above the unchanged 1.2 entry.
- **Help** — no new section needed. `api.paint.pattern` is API-level surface
  already covered in `public/ai/colors.md` (so AI agents see it); the
  user-facing end-product of patterns is the colorway presets on the new
  catalog figures, which the changelog already calls out. No new top-level
  toolbar/panel/setting was added.
- **No `llms.txt` change** — the file's API section doesn't enumerate
  `api.paint.*` calls; agents reach pattern docs through the `colors` subdoc.
- **Bambu printer churn** (drop-then-revert plus a test pin) is dev-internal
  and excluded from the public changelog — no user-visible behavior change.

Verified: `npm run typecheck` clean, `npm run test:unit` 1604/1604 pass. The
draft PR's PR-checks workflow runs the full e2e shards on push.
