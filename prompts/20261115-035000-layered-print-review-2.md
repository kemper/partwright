---
session: "b01bd443"
timestamp: "2026-11-15T03:50:00Z"
model: claude-opus-5-5
sequence: 4
---

## Human

(Continuation: acting on the independent review of the code-native layered
print commit.)

## Assistant

## Key decisions

**Blocking fixes**: (1) a reload/reopen ran the version's code before its
session attachments were restored, so `api.image` failed (reviewer reproduced
it) — attachments are now restored at the top of `loadVersionIntoEditor`,
which also closes a cross-session read of the previous session's images.
(2) The mesh cache restored geometry but not the plan, so an object switch
could export one object's mesh with another's swaps — the plan is now part of
`PartMeshCacheEntry`, and `applyLiveGeometry` clears it. Both have e2e
regression checks (reload; switch to a plain object and back).

**Hardening**: images are decoded before the Worker claim (no await between
claim and post); the validator bounds layer heights, layer counts and block
order like the solver's own ranges (untrusted Worker output); the sandbox
parser caps schedule/name sizes and refuses search-only options next to a
pinned schedule; the pool carries the plan for multi-object export; the solve
cache hashes every pixel; the decoded-image cache is a small LRU keyed on the
size setting and cleared on session change; a failed create deletes its
half-made session; share-link and headless errors say what actually happened.

Kept the explicit triangle descriptors on the height bands: without them a
mesh refine would re-resolve the regions by label name and drop them.
