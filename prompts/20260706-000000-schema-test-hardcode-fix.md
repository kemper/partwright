---
session: "inverse-cad"
timestamp: "2026-07-06T00:00:00Z"
model: claude-fable-5
sequence: 58
---

## Human

(CI webhook — e2e shard 1 failed on the schema 1.18 bump)

## Assistant

## Key decisions

`tests/chat-export.spec.ts` hardcoded `expect(exported.partwright)
.toBe('1.17')` — the exact trap item 6 of the CLAUDE.md schema-migration
checklist warns about, and the one e2e-tier assertion the 1.18 bump
missed (the unit tier imports the constant). Fixed by importing the
LIVE `SCHEMA_VERSION` in-page (dynamic `import('/src/...')` from the
spec, the established e2e pattern) so future bumps can't re-trip it.
