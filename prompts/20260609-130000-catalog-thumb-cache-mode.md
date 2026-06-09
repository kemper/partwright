---
session: "5c6e31e7"
timestamp: "2026-06-09T13:00:00Z"
model: claude-opus-4-8
sequence: 4
---

## Human

"Let's fix the cache mode in its own PR." (Follow-up to the catalog-thumbnail
investigation: new entries showed blank thumbnails for some visitors.)

## Assistant

## Key decisions

**Root cause was the request cache mode, not the data.** The catalog hydrates
each tile's thumbnail by fetching `/catalog/thumbs.json` (404s today) then
falling back to the per-entry `*.partwright.json`, both with
`cache: 'force-cache'`. `force-cache` returns a cached response *without
revalidating, even if stale* — so a visitor who loaded `/catalog` during the
window when an entry existed but had no thumbnail yet keeps being served the
thumbnail-less JSON from their HTTP cache indefinitely. That's why thumbnails
showed on some tiles and not others.

**Fix: `force-cache` → `no-cache` on both fetches.** `no-cache` forces a
conditional revalidation (ETag), so the browser always picks up a changed file
but pays only a cheap 304 when nothing changed. Deterministic freshness without
the staleness trap. Deliberately scoped to *only* the cache mode — the larger
rework (removing `thumbs.json`, lazy-loading near the fold) is a separate PR so
this urgent symptom fix can ship on its own.
