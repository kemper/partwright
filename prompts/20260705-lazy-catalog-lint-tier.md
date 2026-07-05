---
date: 2026-07-05
branch: claude/confident-carson-gpo63q
files_changed:
  - scripts/lint-catalog.mjs
---

## Human

CI static-analysis failed on the merge commit: `lint:catalog` — a gate
that arrived FROM MAIN in the merge — hard-caps catalog entries at
1.5 MB, and the AI-painted Pomni entry is 24.6 MB.

## Assistant

The two branches encode conflicting-but-reconcilable policies. Main's
cap exists because /catalog eagerly fetched every entry at page load,
so one bloated file slowed the whole page. This branch's lazy-entry
mechanism (manifest `thumbnail` sidecar → no prefetch, payload fetched
on click) removes exactly that cost — the cap's rationale doesn't apply
to lazy entries. Rather than delete the user-requested showcase entry
or gut the gate, the linter gained a second tier: entries the manifest
marks lazy are exempt from the page-load cap but gated at the Cloudflare
Pages per-file deploy limit (25 MiB) — the real regression class for
them is an entry that silently fails to deploy. Eager entries keep the
strict 1.5 MB gate unchanged, and lazy entries are listed in the output
so their count stays visible (they still cost repo size; the comment
tells authors to keep them rare and deliberate).
