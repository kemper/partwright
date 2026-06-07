---
session: "yEkr1"
timestamp: "2026-06-05T22:30:00Z"
model: claude-opus-4-8
tools: [git, playwright]
---

## Human

Create a new release of staging to production. Update all changelog, help, and
other docs as needed. If main hasn't synced to staging yet, wait for it. Then
create the deployment PR.

## Assistant

## Key decisions

**Docs must land on `main` first — never on the release branch.** The pipeline
rule (CLAUDE.md "superset" / production-promotion-guard) forbids putting
changelog/help/release-note edits onto the `staging`→`production` PR. So this
change is a normal `docs:` PR into `main`; the gate advances `staging`, and the
production release is then a pure promotion. Cutting the release without the
changelog first would reproduce the exact May-2026 drift the guard exists to
stop.

**Scoped the changelog to the genuinely-undocumented payload.** `whatsNew.ts`
was byte-identical on `production` and `main`, so the whole `production..main`
delta (~35 user-facing commits) was undocumented. The newest existing entry is
"June 4, 2026"; today is June 5, so I added a single new top entry. Cross-checked
each payload feat/fix against the existing June-4 / May-31–June-3 entries and the
help page to avoid re-documenting already-shipped work (fabric textures, image
paint, etc. were already covered).

**Five themes captured:** filament palette + slot-aware painting (manager pill,
photo→palette, reconciliation, named collections, slot-ordered 3MF export),
the Self-Modeling Studio (photo → multi-view → 3D, AI reference-image grid),
searchable/filterable catalog + print-in-place Fidget Toys, brush wrap-tolerance,
and capability-sampler starters + the Quality Apply button.

**Help page** got matching updates: a 🧵 Palette viewport-tool bullet, brush
wrap-tolerance + a "Filament slots" paragraph in Painting, search/filter/Fidget
Toys in Catalog, a "Photo → 3D" paragraph + 3MF slot-order note in
Import/Export.

**Left `llms.txt` and `docs/headless-cli.md` alone.** The palette/slot work is
UI-side (agents paint via `paintRegion` colors), so no verified API surface to
add to `llms.txt`. `headless-cli.md` was already updated on `main` by the
agent-grade-CLI commit.

Verified: `npm run build` (tsc clean) + `npm run test:unit` (686 pass), and a
throwaway Playwright spec screenshotting `/whats-new` and `/help` to confirm the
new content renders.
