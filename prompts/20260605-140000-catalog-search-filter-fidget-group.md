---
session: "trusting-dirac"
timestamp: "2026-06-05T14:00:00Z"
model: claude-opus-4-8
---

## Human

Add a catalog search feature and toggleable language filters (hide/show by
engine), plus a new language-independent "Fidget Toys" group, as the first step
toward populating the catalog with ~10 modeled fidget toys (models land in a
later pass). Build the catalog changes first.

## Assistant

## Key decisions

**Two catalog surfaces, one shared behavior.** `/catalog` serves a fully static
`catalog.html` (pre-rendered by `src/content/build/render.ts`, enhanced by the
dependency-free `src/content/catalogEntry.ts`), while the editor SPA soft-renders
an in-app overlay (`src/ui/catalog.ts`). Rather than duplicate filtering logic, I
added one pure-DOM module, `src/content/catalogFilter.ts` (`wireCatalogFilter`),
driven by a small `data-catalog-*` attribute contract that both renderers emit:
`[data-catalog-search]`, `[data-catalog-pill="<lang>"]`, `section[data-category]`
with `[data-catalog-count]`, and `[data-catalog-tile]` carrying `data-language` +
`data-search`. Both surfaces call it. The module imports nothing app/engine, so it
respects `catalogEntry.ts`'s "empty import graph" rule (verified: no new madge
cycle).

**Group is explicit membership, not language-derived.** Existing catalog sections
are *derived from each item's language* via `categorizeOf()`. A "Fidget Toys"
group is deliberately language-independent (it spans manifold-js/scad/replicad),
so it can't be derived. I added a `CuratedGroupId` (`'fidget-toys'`) plus an
optional `group?` field on `CatalogManifestEntry`; `categorizeOf` returns the
curated group first when set, otherwise falls back to the existing parametric →
engine logic. The group leads `CATEGORIES`, so it renders first once populated.
It carries zero entries in this PR, so (empty sections are skipped) it doesn't yet
appear — the search/filter is demonstrated against the existing 77 items.

**Filter semantics.** Search is tokenized, case-insensitive substring match over
name + description + id + language label (mirrors the command palette). Language
pills default all-on; clicking one hides that language (`aria-pressed=false`,
struck-through/dimmed via fixed off-classes so the toggle is renderer-agnostic).
Search + language compose; section counts update to the visible count, empty
sections hide, and a shared `[data-catalog-empty]` "no results" element shows when
nothing matches. Pills only render when >1 language is present.

**Single source for pill order.** `CATALOG_LANGUAGE_ORDER` lives in
`catalogCategories.ts` and is consumed by both renderers so pill order can't drift.

**Verification.** `npm run build` + `npm run test:unit` green; extended
`tests/catalog.spec.ts` with three cases (search narrows + count/empty-section
behavior; a language pill hides its language and restores on re-toggle; the in-app
overlay carries the same live search). Manually exercised in the browser
(screenshots: baseline with pills `JS 52 / SCAD 8 / BREP 11 / VOXEL 6`, search
"cube" → one tile, SCAD pill off → SCAD hidden). `lint:deps` acyclic; `lint:deadcode`
clean for the new exports.
