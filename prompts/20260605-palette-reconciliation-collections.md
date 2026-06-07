---
session: "stylized-paint-effects"
timestamp: "2026-06-05T17:20:00Z"
---

## Human

Phase 3 (one PR): reconcile a model's off-palette colours (replace a colour with
a palette/history colour, merge two colours keeping one), an auto-matcher that
snaps colours to the nearest palette slot, named saved palettes you can switch
between, and — for image imports — just a toast nudge to the palette tool rather
than constraining the importers. History should only hold deliberately-chosen
palette colours (not colours pulled in when a model opens).

## Assistant

## Key decisions

**Never mutate a model on open; reconcile on demand.** Opening a model keeps its
exact colours. The palette manager grew a "Colours in this model" section that
lists the distinct used colours tagged in/off-palette, with per-colour **Replace**
(swap to a palette/recent colour) and **Merge** (collapse one model colour into
another, target = the kept colour), plus **Apply palette** (auto-match every
colour to the nearest slot). All are explicit, user-driven edits.

**Reconciliation primitives live in `regions.ts`, palette-independent.**
`reassignRegionColor(from, to, slotId?)` (recolour + re-attribute matching
regions) and `applyPaletteAutoMatch(slots)` (nearest-slot snap by RGB Euclidean)
are pure and take the palette as an argument — so `regions` never imports
`palette` (no layering edge). Reused the existing `getDistinctRegionColors`.
Replace/Merge set `slotId` correctly (a swap to a slot attributes the regions;
a merge into an ad-hoc colour clears it).

**Named collections via a storage generalisation that preserves the whole slot
API.** `palette.ts` now stores `{ palettes: NamedPalette[]; activeId }`; `load()`
/`save()` operate on the *active* palette, so every existing slot function works
unchanged. First access migrates the pre-collections single palette into one
"Default". New/duplicated palettes get **fresh slot ids** — so a region's
`slotId` stays bound to the palette it was painted under; switching palettes
surfaces the model's colours as off-palette, which the reconciliation tools then
resolve (the two features compose). Capacity stays global (a printer trait).

**Imports: toast, not coupling.** After a colour-bearing import (voxel art,
colour relief) a neutral toast points to the palette tool — no palette logic
wired into the relief/voxel pipelines. Opt-in "quantize to palette" in those
modals is a clean later follow-on.

**History semantics confirmed.** `recordColor` already fires only on a
slot-colour commit and on photo import — opening a model never records — so
history holds only deliberately-chosen colours, matching the ask. No change
needed.
