---
date: 2026-06-13
branch: claude/deployment-versioning-strategy-qsj8q8
files_changed:
  - package.json
  - vite.config.ts
  - src/buildInfo.ts
  - src/ui/aboutModal.tsx
  - .github/workflows/release-tag.yml
  - CLAUDE.md
---

## Human

Designing a versioned-deployment strategy: serve every major version under one
origin (option B), segment the browser DB by version, migrate sessions forward,
and give releases major/minor/patch semantics (major = breaking, needs a
conscious migration; minor/patch = roll forward in place). Files and internal
metadata should track the last X.Y.Z they were known to work with. As the first
concrete step: "I think I'll want to start tagging releases." Chose v1.0.0 as
the first version and automated tagging driven by package.json.

## Assistant

This is the foundational step of that strategy — establishing the semantic
version number everything else (DB namespacing, last-known-good metadata, the
`/vN` launcher) will reference.

Design decisions:

- **`package.json` `version` is the single source of truth**, bumped on a
  feature branch into `main` so the bump flows main → gate → staging →
  promotion PR → production like any other change. This respects the existing
  "no edits on the release branch" / pure-promotion rule — the version is never
  introduced on `production` directly, so the production-promotion-guard stays
  happy. Started it at `1.0.0` (was the `0.0.0` placeholder).

- **Tagging is automated, not manual.** `.github/workflows/release-tag.yml`
  fires on push to `production` (every promotion merge is a release), reads the
  version, and if no `vX.Y.Z` tag exists yet, creates the annotated tag + a
  GitHub Release with `--generate-notes` (which honors the existing
  `.github/release.yml` label grouping). Idempotent: a production push that
  didn't bump the version no-ops, and it errors loudly if the version is still
  the `0.0.0` placeholder. `concurrency` guards against two pushes racing the
  same tag; `permissions: contents: write` lets the default token push tags
  (branch protection doesn't apply to tag refs). Tag pushes from GITHUB_TOKEN
  don't re-trigger workflows, so no loop.

- **Surfaced the version in-app.** Threaded `package.json`'s version through the
  existing `__BUILD_INFO__` define (`vite.config.ts` reads it at build time) →
  `BuildInfo.version` (`src/buildInfo.ts`) → a new "Version" row at the top of
  the About dialog and the copyable build-info text. The build-identity plumbing
  already existed for commit/branch/buildTime; version slots in alongside.

Deliberately scoped OUT of this change (documented in CLAUDE.md as "planned
next"): stamping last-known-good X.Y.Z into the session schema + exported files
(a 7-location schema-ladder change), and segmenting IndexedDB by major for the
migration flow. Those are the next phases, not this first step.

Verified: `npm run build` (tsc + vite) clean, `npm run test:unit` 1343/1343
pass, and a throwaway Playwright spec confirmed the About dialog renders
"Version v1.0.0" in a real browser (screenshot posted in chat, scratch spec
deleted before commit).

Follow-up after a work-reviewer pass (0 blocking): dropped the redundant
`--target "$GITHUB_SHA"` from `gh release create` so the release resolves to
the annotated tag's commit (single source of truth, no divergence risk);
hardened the version guard to reject anything that isn't a plain X.Y.Z semver
(catches node's literal "undefined" if the field ever goes missing); and
simplified the now-redundant About-modal version conditional to a single
`!== 'unknown'` check.
