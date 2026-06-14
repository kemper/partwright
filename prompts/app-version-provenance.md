---
date: 2026-06-14
branch: claude/version-metadata-stamping
files_changed:
  - src/storage/db.ts
  - src/storage/sessionManager.ts
  - src/storage/appVersionCompat.ts
  - tests/unit/appVersionCompat.test.ts
  - tests/chat-export.spec.ts
---

## Human

Phase 2 of the versioned-deployment strategy: stamp the "last known good" app
semver into the session schema + exported files, so we're ready for the first
breaking change and the eventual cross-version migration flow. (Follows the
release-tagging PR #651 which made package.json the version source of truth.)
User: "I just want to be ready for the first time we do a breaking change and
need version management."

## Assistant

Recorded the **app** semver (package.json `version`, surfaced via
`buildInfo.version`) onto persisted geometry, and wired the read-side seam where
a future major will hook forward-migration.

Key design decisions:

- **App version is a distinct axis from the export schema version.**
  `SCHEMA_VERSION` (the `partwright: "1.x"` file-format number) and the app
  semver ("1.0.0") move independently, so I did NOT reuse the schema number.
  Added `appVersion` as new metadata and bumped the schema 1.14 → 1.15 (additive,
  back-compatible — old readers ignore it).

- **Stamped at two granularities.** Per-version `Version.appVersion` (the build
  that saved each snapshot — the true "last known good" provenance) AND a
  top-level `ExportedSession.appVersion` (the exporting build — the file-level
  migration signal). On import the per-version stamp is *preserved verbatim*,
  not re-stamped, so provenance follows the geometry.

- **Pure logic split into `appVersionCompat.ts`** (mirrors the
  `languageFallback.ts` precedent) so it's unit-testable under the node tier —
  `sessionManager.ts` can't be imported there (DOM/IndexedDB/engine deps). The
  module defines a local structural type rather than importing `ExportedSession`,
  keeping the dependency graph acyclic (sessionManager → appVersionCompat, never
  the reverse). `lint:deps` confirms no cycle.

- **The migration seam is explicit.** `appVersionCompatibility()` classifies a
  file's authoring major vs the running build: newer-major warns
  (forward-incompatible), same/unknown is silent, and **older-major is the
  documented hook point** — when v2 ships, the forward codemod runs in that
  branch. Wired into `importSession` alongside the existing schema warning,
  routing through the same `onWarning` path.

- **No DB version bump needed.** IndexedDB tolerates extra fields on records, so
  adding `appVersion` to the `versions` store needs no `onupgradeneeded` change —
  old records simply lack it. The `saveVersion` API already takes an options
  object (the CLAUDE.md "16 positional args" warning is stale), so threading the
  field was a one-liner per call site.

- **Dev/test stamp nothing.** When `buildInfo.version` is 'unknown' (no define
  applied) we store `undefined` rather than persisting the placeholder.

No UI/API-parity gap: this is automatic provenance, not a new affordance; the
compat warning surfaces via the existing import-warning toast path.

Verified: typecheck clean; full unit tier 1364 pass (incl. 11 new
`appVersionCompat` cases); `lint:deps` acyclic; `npm run build` clean;
`chat-export` e2e green with a new `appVersion` round-trip assertion; and a
throwaway browser probe confirmed both the top-level and per-version stamps come
through the real runAndSave→export path as "1.0.0" (deleted before commit).
