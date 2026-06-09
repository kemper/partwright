---
session: "serene-allen"
timestamp: "2026-06-08T00:36:00Z"
sequence: 4
---

## Human

Pre-release cleanup (12-agent audit, leader-verified): fix the
hygiene/architecture findings as a topical PR off latest main.

## Assistant

## Key decisions

**Wipe + Data inventory ignored two stores** (`storage/dataInventory.ts`,
`ui/dataExplorer.ts`): `ALL_STORES` and the `wipeData` modeling-data list omitted
`drafts` (per-part editor buffers) and `reliefSources` (original relief import
images — potentially large blobs). The audit called this a multi-tab edge case,
but it's worse: `wipeData` deletes the database named `'mainifold'`, which is the
*legacy* DB name — `DB_NAME` is now `'partwright'`. So a modeling-data wipe
cleared 6 stores from the current DB and left `drafts`/`reliefSources` behind
**unconditionally**, orphaned forever, while the Data tab under-reported usage.
Added both to `StoreName`/`ALL_STORES`/`STORE_LABELS` and the modeling-data wipe
list. No `objectStoreNames.contains` guard needed: `openPartwrightDB` always
opens at `DB_VERSION = 8`, which creates both stores, so they always exist by the
time any of this runs. Also extended `dataExplorer`'s exhaustive `recordLabel`
switch (TS flagged the missing cases) and taught `recordKey` that
`reliefSources` is keyed by `sessionId`, not `id`.

**Renderer imported a feature layer** (`renderer/multiview.ts`): the offscreen
multi-view renderer imported `buildStrokesGroup`/`disposeStrokesGroup` from
`annotations/annotationOverlay` (which imports back `renderer/viewport`), a
layering inversion the docs forbid — invisible to `lint:deps` because the file
chain is acyclic. Inverted it with the existing leaf-registry pattern: added an
offscreen-overlay provider slot to `viewportRegistry.ts`, registered the
annotation builder in `viewportSubsystems.ts` (the sanctioned side-effect wiring
module that's *allowed* to import features), and switched multiview to pull the
group through the leaf. No renderer module imports a feature layer now; `madge`
stays clean.

**Two palette config fields were unreachable** (`ui/advancedSettingsModal.tsx`):
`defaultPaletteCapacity` and `paletteHistoryMax` exist in `appConfig` (and are
read live in `color/palette.ts`) but had no `<Field>`, so users couldn't override
them despite the numeric-constants convention requiring it (two independent audit
agents flagged this). Added both to the UI section, wired to the defaults.
Verified in-browser (screenshot posted).
