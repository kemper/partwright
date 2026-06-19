---
date: 2026-06-19
branch: claude/bold-knuth-fhd0b9
files_changed:
  - src/main.ts
  - tests/catalog-cancel-color-preserve.spec.ts
---

## Human

I did a test where I clicked cancel as a long initial render was happening
(opened a figure from the catalog). Then I clicked save after cancel. Then I
edited the code to cause a rerender. The rerender took a while like it normally
does and had a fast preview figure, but when the render completed the model had
no color.

## Assistant

Reproduced with a scratch Playwright spec on the archer (a slow SDF figure whose
14 colours are saved as `byLabel` colour regions): a normal load shows 14 regions;
after cancelling the initial render the in-memory region count was **0**, and a
Save then persisted **0** — destroying the figure's colours. A later edit→rerender
re-resolves only the in-memory regions, so it rendered colourless.

Root cause: `loadVersionIntoEditor` runs `runCodeSync` and, when it returns false,
does `if (!applied) return` — which skips `rehydrateColorRegions`. Cancelling the
initial render makes runCodeSync return false, so the version's colour regions
never enter memory. `rehydrateColorRegions` can't simply be called on that path:
it resolves `byLabel` regions against the finished mesh + labelMap, and a cancel
leaves neither (only a throwaway coarse preview mesh, no labelMap), so every
region would resolve to 0 triangles and be dropped.

Notably this is only reachable *because* of the sibling fix in this PR (wiring the
Cancel button to work during the initial render) — before that you couldn't cancel
an initial figure render at all. So the two fixes ship together; merging the
button fix alone would expose this colour-loss regression.

Fix: added `stageUnresolvedColorRegions(geometryData)` — it loads the version's
colour-region *descriptors* into the store with empty triangle sets (no mesh
needed). Called on the cancel path in `loadVersionIntoEditor` (guarded by a
`_runGeneration` check so a newer version-switch that superseded ours doesn't get
clobbered). Because `serialize()` persists descriptors (not triangles), a Save now
keeps the colours; and runCodeSync already re-resolves every in-memory region
against the fresh mesh+labelMap on the next successful run, so the colours reappear
on the rerender. Regions that genuinely no longer match just resolve to 0, exactly
as the existing reconcile tolerates.

Verified: after cancel → save the persisted session keeps all 14 colour regions
(was 0), and the edit→rerender shows the fully-coloured archer. Added
`tests/catalog-cancel-color-preserve.spec.ts` (asserts `exportSessionData()`'s
latest version still has colour regions after cancel+save). build + 1508 unit
tests + both cancel e2e specs green.
