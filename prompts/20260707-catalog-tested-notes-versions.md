---
date: 2026-07-07
branch: claude/catalog-tested-versions-bbov8t
files_changed:
  - src/content/data/catalogCategories.ts
  - src/ui/catalog.ts
  - src/content/build/render.ts
  - public/catalog/manifest.json
  - tests/unit/catalogCategories.test.ts
  - tests/catalog.spec.ts
---

## Human

The catalog already flags entries as print-tested / untested, but every entry
was untested. Mark the three I've actually printed — Spiral Fidget Cone (works,
but coarser finish than a hand-modeled fidget you'd download), Country Manor
Estate (prints really cleanly), and SDF Organic Creature (printed fine) — and
let the tested badge's hover tooltip carry that honest per-model description.
Also capture *which version* I tested, so a later re-bake that bumps the version
can be detected as "changed since tested" and surfaced to the user. All three
were tested at their current latest version.

## Assistant

Extended the existing print-tested badge rather than inventing a parallel one —
the same `printTestedBadge()` pure helper feeds both catalog renderers, so all
the work lands in one place and both surfaces stay identical.

**Two new manifest fields, both optional and default-absent** (matching how
`printTested` itself works): `printTestedNote` (the curator's honest story) and
`printTestedVersion` (the 1-based version index that was physically verified).
Absence keeps every existing entry exactly as-is.

**Badge helper signature → options object.** Changed `printTestedBadge(boolean)`
to `printTestedBadge({ printTested, note, testedVersion, latestVersion })` so it
can compose the tooltip and detect staleness. Three states now: untested
(muted), verified-current (emerald `✓ Print-tested`), and verified-but-stale
(amber `✓ Print-tested (vN)`) when `latestVersion > testedVersion`. The tooltip
leads with the note (falls back to the generic verified line) and always appends
the version provenance — "Verified at version N." when current, or "Tested at
version N; the model has since been updated to version M and has not been
re-verified." when stale. Added a `stale` flag + an `outdated`/`re-test` search
token so the state is findable.

**Staleness needs the current version.** Both renderers already know it — the
in-app catalog from `payload.versions.length`, the static renderer from
`tile.versionCount` — so I threaded that in as `latestVersion`. Only a known
`testedVersion` can trip stale; asserting "a print exists" without pinning a
version never warns. None of the three are stale today (all tested at latest),
but the machinery is in place for the next re-bake.

**Tests.** Rewrote the unit suite onto the options API and added note/version/
stale cases. Updated the e2e catalog spec: it no longer assumes *every* tile is
untested — it now asserts the tested+untested chip counts partition all tiles,
that at least one tested chip exists, that the "untested" search returns exactly
the untested set, and that the Country Manor chip's tooltip carries its note.

Verified in a real browser: filtering the static /catalog on "print-tested"
isolates exactly the three tiles, each showing the green chip. typecheck, unit
(1743 passing), and the production build (static catalog HTML carries the right
chips + tooltips) all green.
