---
date: 2026-07-07
author: claude (opus-4-8)
task: Per-model tested notes + tested-version tracking on the catalog badge (PR #905)
---

## Liked
- The prompt log from the *original* print-tested feature (`prompts/20260607-catalog-print-tested-status.md`) was the fastest possible orientation — it named the exact four files, the "one pure helper, two renderers" shape, and the search-token substring trap. Reading the sibling prompt log before touching code turned a blind exploration into a targeted edit. The promptlog discipline paid off for a later session, exactly as intended.
- Extending the existing `printTestedBadge()` helper instead of adding a parallel one kept the in-app and static renderers automatically identical — one signature change, both surfaces move together.

## Lacked
- Catalog version payloads carry no explicit semantic `version` number (the `version` field is `null`; only an `index` count exists). So "tested version" had to mean the version *count/index*, not a real vX.Y.Z. Fine for now, but a mild impedance mismatch with the package.json versioning the deployment docs describe — worth noting the two "version" concepts are unrelated.

## Learned
- The e2e catalog spec hard-asserted "every tile reads Untested, count == tileCount" — flipping any entry to tested silently breaks it. When a feature's whole point is to *change* a default that a test pins as invariant, grep the test suite for that invariant first (`rg 'Untested' tests/`) before editing data. Caught it here by reading the spec, but it's the class of thing that costs a CI round-trip if missed.

## Longed for
- A one-shot "render just these N tiles" preview for catalog QC. I filtered `/catalog` on a search token to isolate the 3 tested tiles for the screenshot — worked, but only because a matching token happened to exist. A `snap`-style helper that takes entry ids and montages their tiles would make badge/tooltip QC trivial.
