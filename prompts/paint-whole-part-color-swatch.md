---
title: Set the colour of a whole part from the paint menu
date: 2026-06-20
labels: [enhancement]
---

## Human

We should have the ability to set the color for a whole part. Maybe part of
the paint menu? Investigate and recommend, but go ahead and make a PR.

## Assistant

**Investigation.** The app's notion of a "part" is an `api.label(shape, name)`
feature, already surfaced in the Paint menu's **Labels list**
(`src/color/paintUI.ts`). Clicking a label row already painted the whole part —
but only with whatever the *active* paint colour happened to be, and only via a
passive colour dot that couldn't be edited. The persistent mechanism (`byLabel`
region descriptor, re-resolved against the live label map on every run) was
already in place and is exactly what `partwright.paintByLabel` emits, so
UI↔API parity was already satisfied — the only gap was a direct UI affordance.

**Decision.** Rather than add a new connected-component tool (the Bucket tool
in colour mode at 100% tolerance already floods a whole mesh island, and the
codebase's "part" concept is the label), I made each Labels-list row's colour
indicator an interactive `<input type="color">` swatch. Picking a colour:

- recolours the part's existing `byLabel` region **in place** when one exists
  (no duplicate-region stacking), via `updateRegionColor`; otherwise
- commits a fresh `byLabel` region over the label's triangle set (the same
  descriptor `paintByLabel` produces, so it persists and re-resolves).

The swatch defaults to the active paint colour (previewing "the part will become
this") and stops click propagation so it doesn't also fire the row's
paint-with-active-colour handler. The row click is unchanged, so existing
behaviour and the existing e2e test still hold.

No new `window.partwright` method was needed — `paintByLabel` already covers the
capability for console/AI callers. Added an e2e case to
`tests/paint-labels-panel.spec.ts` covering set + recolour-in-place.
