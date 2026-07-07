---
session: "bambu-multipart-export-options"
timestamp: "2026-07-07T06:04:29Z"
model: claude-opus-4-8
sequence: 2
---

## Human

Follow-up to the plate-layout PR: the armor group exported and fit cleanly on
one plate, but the frame parts spread way outside the plate. Can we pack shapes
into the estimated plate size?

## Assistant

## Root cause

The first cut of `grid`/`group` placed parts in a `⌈√count⌉` square grid with a
**uniform pitch = the single largest part's max dimension**. The frame has a few
long limbs (≈180–200 mm), so one big part inflated the pitch of every cell → a
5×4 grid at ~200 mm pitch spreads ~800 mm across a 330 mm bed. The armor parts
are compact and similar-sized, so their uniform pitch happened to fit — which is
why only the frame ballooned.

## Fix

**Replaced the uniform-pitch grid with a real shelf bin-packer** (`packPlates`,
pure + exported). It lays parts left→right into shelves using each part's ACTUAL
footprint (`prepared[k].width/depth`), wraps to a new shelf when the row is full,
and **starts a new plate when a shelf would exceed the bed depth** — so an
oversized bin spills onto extra plates instead of off one plate. First-fit-
decreasing by depth for tidy shelves; each plate's used area is centred on the
bed.

**Split the two concerns cleanly.** `assignBambuPlates` now returns logical
*bins* (which parts may share a plate, per the layout mode); `packPlates` turns
each bin into one-or-more *physical* plates with in-bed centres.
`buildBambuPackage` packs every bin, then assigns plate-grid cells + world
positions from the packed centres. A one-part bin (the default `separate`
layout) centres it exactly as before, so that path — and the existing per-axis-
stride test — is byte-identical.

## Verification

- Unit: 6 new `packPlates` cases (single-part centring; small parts pack to one
  plate; overflow spills to multiple plates with all centres in-bed; a lone
  oversized part is still placed; the big-part-doesn't-inflate-neighbours
  regression; empty bin).
- E2E: new integration case asserts a 180 mm part + four 15 mm parts pack onto
  ONE H2C plate with centre-X span < bed width. A throwaway probe of 20
  varying-size parts (incl. 200×40 limbs) packed onto a single 330×320 plate with
  a 290 mm span — vs the ~800 mm balloon before.
- Updated the modal hint ("Packed together — spilling onto more plates as
  needed") and `ai/file-io.md`.
