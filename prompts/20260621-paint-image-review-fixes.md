---
session: "483euo"
timestamp: "2026-06-21T01:57:00Z"
model: claude-opus-4-8
tools: [playwright]
---

## Human

(Automated work-reviewer pass over PR #816.) Address the review findings.

## Assistant

## Key decisions

Acted on the one should-fix and two nits from the branch review:

- **`imageRef` index contract (should-fix).** `getReferenceImages` numbers its
  list AFTER filtering to entries with a usable `src`, but the `paintImage`
  dispatch indexed the unfiltered `getImages()` result — so a leading empty-src
  attachment would skew the index and paint the wrong image. Fixed the dispatch
  to filter to the same `usable` set before indexing, matching the contract the
  tool advertises.
- **View ordering consistency (nit).** Reordered `VIEW_NORMALS`/`STAMP_VIEWS` to
  `front, back, left, right, top, bottom` so the resolver, schema enum, docs, and
  error strings all agree; updated the unit assertion.
- **Lazy bbox (nit).** Moved the bbox/diag/radius/center computation inside the
  `if (!at)` branch — it's only needed for the auto-anchor ray, so an explicit
  `at` with label-auto-size no longer pays for it.
- **e2e golden path (nit).** Added `tests/paint-image-view.spec.ts`: builds a box,
  projects a transparent-bg orange disc via `paintImage({view:'front'})`, asserts
  triangles painted + orange avg colour, and that an unknown view errors. The
  resolver math stays unit-covered; this proves the full console path.

Verified: typecheck clean, placement unit tests pass, the new e2e spec passes.
