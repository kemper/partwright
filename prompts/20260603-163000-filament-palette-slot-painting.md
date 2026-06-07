---
session: "stylized-paint-effects"
timestamp: "2026-06-03T16:30:00Z"
---

## Human

(Across a multi-turn design conversation) Explore stylized paint effects, then
narrow to what's best for 3D printing. Target multi-color FDM (AMS/MMU). Build
Phase 1: a filament palette + slot-aware painting, so painting becomes a real
palette-constrained print spec. Create GitHub issues per milestone, then start
Phase 1 so I can test it.

## Assistant

## Key decisions

**Reuse the existing filament substrate, don't fork it.** Research found the app
already had a `Filament` type and a localStorage-backed library in
`src/relief/` (hueforge/relief studio), with the edit CRUD deleted in an earlier
cleanup. Rather than inventing a parallel palette, Phase 1 *promotes* that into
a shared `src/color/palette.ts` (the single source of truth for paint, relief,
and export), and `src/relief/filaments.ts` becomes a thin re-export shim so
relief imports (`listFilaments`/`hexToRgb`) keep working. The team had renamed
the user-facing wording "filament" → "palette"; kept that.

**`color` stays the render source of truth; `slotId` is an additive
attribution.** Adding `slotId?: string` to `ColorRegion`/`SerializedColorRegion`
(rather than replacing `color`) means the entire render/export/rehydrate
pipeline keeps working untouched. When a region is painted from a slot, its
`color` mirrors the slot hex and carries `slotId`; recolouring a slot recolours
every region on it (`recolorRegionsForSlot`). Unslotted (ad-hoc custom-colour)
regions remain first-class — the back-compat default.

**Forward-compat for Phase 3 collections, baked in now at near-zero cost.**
Palette access goes through a `getActivePalette()` indirection (one palette for
now) and every slot has a globally-unique id, so a region's `slotId` will
resolve regardless of which palette is active once collections land — no
region-data migration later.

**Order-stable, in-place editing.** The palette is a single ordered list
(slot index == intended filament/AMS slot). On first read it migrates any legacy
relief filament data into that ordered list; thereafter CRUD edits it in place so
recolour/rename never reorders a slot.

**Slot threading.** `paintMode` tracks `currentSlotId` (set by `setSlot`, cleared
by the custom-colour `setColor`), published via the `paintAccessors` leaf so the
slab/box drag tools and the bucket/brush/label paths all stamp `slotId` without
new import cycles. Rehydrate carries `slotId` through; an unresolved slot keeps
the stored colour.

**Schema 1.9 → 1.10**, additive (missing `slotId` = unslotted). The over-budget
badge (distinct used slots vs `appConfig.ui.defaultPaletteCapacity`, default 4)
and the constrain pref are advisory only — they never block paint or export. The
constrain *pref* lives here in Phase 1; its UI toggle is deferred to Phase 3.

Issues: #412 (Phase 1, this PR), #413 (Phase 2 — slot-aware 3MF export),
#414 (Phase 3 — collections, constrain UI, import/extract).
