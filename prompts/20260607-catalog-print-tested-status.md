---
date: 2026-06-07
branch: claude/catalog-print-tested-status-Lvt9F
files_changed:
  - src/content/data/catalogCategories.ts
  - src/content/build/render.ts
  - src/ui/catalog.ts
  - tests/unit/catalogCategories.test.ts
  - tests/catalog.spec.ts
---

## Human

Add a print-tested status to catalog items so people can have confidence a
model is actually printable. Default every model to "not print-tested yet".
Create a PR for that work. Separately, consult me on the best way to upload
photos of my prints and associate them to catalog items, given this is a
stateless single-page app.

## Assistant

Two deliverables: ship the print-tested badge (this PR) and open a design
discussion about print photos (chat, no code yet).

**Why a manifest field, not a payload trait.** The other tile badges split two
ways: language comes from the entry/payload, while the Parametric chip is
*derived* from session code (`deriveCharacteristics`). Print-tested can't be
derived — it's an editorial fact about the physical world — so it has to be
declared. The manifest entry (`CatalogManifestEntry`) is the right home: it's
already fetched by both render paths and is where the curator edits metadata.
Added `printTested?: boolean`.

**Default = absent.** The user wants every model "not print-tested yet" by
default. Rather than stamp `"printTested": false` onto all ~80 entries (noisy
diff, and absent already means the same thing for every other optional field
here), absence is treated as untested. The badge still renders on every tile so
the status is always explicit; flipping one to verified is a one-line
`"printTested": true` edit.

**One pure helper, two renderers.** Both the static pre-renderer
(`render.ts`) and the in-app overlay (`catalog.ts`) must render an identical
chip, so I put `printTestedBadge()` in the shared dependency-free
`catalogCategories.ts` (same place `categorizeOf`/`deriveCharacteristics`
live). It returns label + Tailwind classes + tooltip + searchable tokens.
Verified → green `✓ Print-tested`; untested → muted `Untested`. Distinct search
tokens (`verified` vs `untested`) fold into each tile's `data-search` haystack
so the shared filter can find either state.

Tests: unit coverage for the helper's two branches + that absent ≡ false; an
e2e assertion that every static tile carries exactly one status chip, all read
"Untested" by default, and the status is searchable. Verified both states in a
real browser (temporarily flipped one entry to confirm the green chip, then
reverted).

**Print-photo upload (consult, not built).** Flagged that I can *see* a photo
pasted in chat but can't faithfully reproduce its bytes as a committed binary,
so the realistic options are: (A) commit photo files as static assets under
`public/catalog/prints/<id>/` and reference them from the manifest (the natural
fit for a no-backend SPA — the "upload" is a git commit, photos added via a
GitHub PR / web drag-drop or locally), or (B) host photos externally
(Cloudflare Images/R2, etc.) and store URLs in the manifest. Recommended (A)
and asked the user to choose before building the photo-display side.

### Follow-up: work-reviewer fixes

A review pass on the green PR surfaced two should-fixes, both applied:

1. The in-app meta row lacked `flex-wrap` (the static renderer had it). With a
   third chip now on the row and `overflow-hidden` on the tile, chips could clip
   on narrow widths instead of wrapping. Added `flex-wrap` so both renderers
   match.
2. Search-token collision: the untested token `not-print-tested` *contains* the
   substring `print-tested`, and the filter matches substrings — so searching
   "print-tested" matched every tile, not just verified ones. Dropped it to just
   `untested`, and added a unit case asserting untested tokens never contain
   `print-tested`.
