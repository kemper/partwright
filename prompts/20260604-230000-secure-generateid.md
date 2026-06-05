---
session: "ZvDxi"
timestamp: "2026-06-04T23:00:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 2
---

## Human

On the June 4 release PR (#438), CodeQL flagged "cryptographically insecure
random number generated at Math.random() in a security context" in
sessionManager.ts. After I investigated and reported it was a pre-existing
false positive (local IndexedDB keys, no auth boundary), the user chose to
"harden anyway for cleanliness."

## Assistant

## Key decisions

**Fixed the real source, not the reported file.** The alert pointed at
`sessionManager.ts` but the `Math.random()` lives in `generateId()` in
`src/storage/db.ts:296` — CodeQL's dataflow follows the generated id to where
it's stored as `session.id`. Swapped the entropy source there.

**Kept the ID format byte-identical (12-char base62).** generateId mints local
IndexedDB record keys (sessions, parts, versions, images, chat messages) that
also appear in URLs (`?session=<id>`). Preserving the 12-char base62 shape means
zero back-compat risk (existing stored IDs untouched, new ones look the same)
while sourcing bytes from `crypto.getRandomValues`. Used rejection sampling
(drop bytes ≥ 248 = 4×62) to keep the distribution uniform instead of a biased
`byte % 62`. Partwright already requires a modern browser (SharedArrayBuffer /
WASM threads), so `crypto` is always present — no Math.random fallback needed.

**Left `sessionLock.ts` alone, deliberately.** Its tab id (line 24) *already*
prefers `crypto.randomUUID()` with Math.random only as a legacy fallback that
never runs in supported browsers, and line 104 is a backoff *jitter delay*, not
an identifier — converting a sleep timer to crypto is noise, not hardening.
Neither was in the CodeQL alert. Scoped the change to the one real finding.

**Release hygiene.** This is a `fix:` PR into `main` (never onto a release
branch) so it flows main → gate → a future release, keeping production
promotions pure. Branch reset to the just-merged `origin/main` so the push
fast-forwards (no force).

**Verification.** build clean; a throwaway Playwright probe generated 200 ids
(all valid 12-char base62, all unique) and confirmed a real session saves a
version through the generateId hot path. Scratch spec deleted.
