---
date: 2026-06-20
branch: claude/mobile-part-list-view-aqf2u7
files_changed:
  - src/ui/mobilePane.ts
  - src/ui/layout.ts
  - src/ui/partList.ts
  - tests/mobile-parts-pane.spec.ts
---

## Human

On mobile I don't see any way to view and change parts in the part list.

## Assistant

Root cause: on mobile the activity rail collapses from a vertical left sidebar
to a horizontal top strip, so the parts list can't live inside it as it does on
desktop. `placeParts()` instead nested the parts rail inside `editorGroup` (the
code-pane container) as a cramped 144px column. But mobile shows exactly one of
editor / viewport at a time, and `editorGroup` is hidden whenever the viewport
is showing — and the default mobile pane is `viewport`, plus every rail tab tap
forces the viewport pane. So a phone user almost never saw parts, and the only
desktop "re-show" affordance (the floating » chip) also lived in the hidden
`editorGroup`. Net effect: no reachable, discoverable way to view or switch
parts on mobile.

Fix: give the parts list its own mobile pane. The Code / Viewport toggle becomes
a three-way Code / Parts / Viewport segmented control, and `MobilePane` gains a
`'parts'` value. In the parts pane, `editorGroup` is shown but the code pane is
hidden and the parts rail expands to full width (`flex-1` instead of the `w-36`
column), giving touch-friendly full-width part rows with thumbnail, drag grip,
rename, delete, and the add button. As a secondary win the Code pane now hides
the parts column entirely, so the editor gets full width on a phone.

Details:
- `mobilePane.ts`: extend the union + the localStorage validation with `'parts'`.
- `layout.ts`: add the third toggle button; `syncMobileToggleUI` and
  `syncPaneVisibility` handle three panes (editorGroup shown for editor+parts,
  with `editorPane`/`partsRail` toggled within it; rightPane for viewport).
  `placeParts` mobile class is now full-width, and the desktop-only rail-collapse
  early-return is scoped to the desktop branch. The desktop branch also force-
  un-hides `editorPane` so a `'parts'`-pane hide can't bleed across the
  breakpoint.
- `partList.ts`: hide the « collapse button on mobile (`hidden md:flex`) — it's a
  desktop width-reclaim affordance and would otherwise leave the pane empty.

Verified at 375px in a real browser (screenshots of all three panes) and with a
new golden-path e2e spec (`mobile-parts-pane.spec.ts`) asserting the three-way
toggle, that the parts rail is hidden in viewport mode, and that tapping Parts
reveals a full-width list with a part row + add button. Desktop layout snapshot
confirmed unchanged (parts still in the activity rail with the collapse button).
typecheck, full unit tier (1508), and `npm run build` all pass.
