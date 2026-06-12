---
date: "2026-06-10T21:15:00Z"
task: "feat: persist computed api.surface.* textures on saved versions (phase 3, PR #578)"
areas: [surface, storage, schema, exports, verification]
cost: medium
---

## Liked / Worked
- **Seeding the existing memo cache instead of adding a load-time render path.** The whole rehydration is two new exports on surfaceOps (`surfaceChainKey`, `seedSurfaceCache`) plus a guarded seed before the version-load run — the force-apply path then does everything (Manifold reconstruction, paint resolution, stats) unchanged. Self-validating keys meant zero new failure modes to handle.
- **The prior session's prompt logs as onboarding.** Reading the two surface-texture prompt logs first (architecture + the hardening pass's invariants, e.g. "partMeshCache entries are always textured", the identity-guard idea) made the design fall out in one pass with no dead ends.
- **`importedMeshes` as the template for every layer** — opaque-at-db, base64-at-export, validate-at-import. Each schema-touching edit had a same-file sibling to mirror.

## Lacked
- **A SCHEMA_VERSION ↔ test-assertion link.** Bumping to 1.14 broke `chat-export.spec.ts`'s hardcoded `'1.13'` assertion — only caught by the CI shard (cost a full re-run round). Either the spec should import `SCHEMA_VERSION`, or the schema doc-comment in sessionManager should name the test(s) that pin it.
- **No CI-success webhooks and no `send_later` in this environment.** Watching shards meant arming a dumb 5-minute timer Monitor as a self-check-in. Worked, but a "notify on check-suite completion" event would remove the polling entirely.

## Learned
- **`dbSaveVersion`'s long positional signature is now 16 args** — both import loops needed `null, null` placeholders to reach the new trailing param. The next field added should probably convert the tail to an options object.
- **`exportSessionData().data` returns the payload object, not a JSON string** — a test that `JSON.parse`s it fails; handle both shapes.

## Longed for
- **An options-object refactor of `dbSaveVersion`** (see above) before the next schema field lands.
- **A schema-bump checklist** (doc comment ladder, SCHEMA_VERSION, ExportedSession type, serialize/deserialize, both import loops, trimForShare, pinning tests) — this change touched all seven and only the test was missed; a 7-line list in CLAUDE.md or a skill would make the next bump mechanical.
