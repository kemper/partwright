---
session: "ubcb5x"
timestamp: "2026-10-29T03:43:24Z"
---

## Human

The model console drawer that pops open whenever model code prints (often
while the in-app AI is editing) is annoying. Instead show a small console icon
in the lower-left corner of the viewport with the message count; click to
expand, a little X to dismiss, maybe auto-hide after ~10 seconds — but then
there needs to be a way to bring the console back. Pick the best UX and open
a PR.

## Assistant

## Key decisions

**One element that morphs, not two widgets.** The collapsed state is the
drawer's own header shrunk to a content-sized pill (terminal icon, "Console",
count, ▸, ×); clicking it expands into the existing drawer with Copy and the
log body. Same ids, so the toggle/body wiring and tests carry over.

**Always arrives collapsed, but an open drawer stays open.** A new run's
output shows as the pill (no more drawer over the model); if the user already
expanded it, a later run updates in place rather than snapping shut on them.
The old persisted collapse preference was dropped — it was what made the
drawer reappear expanded on every run.

**Auto-hide with escape hatches.** The collapsed pill fades after
`ui.modelConsoleAutoHideMs` (default 10 s, 0 = never; config + Advanced
Settings + bounds), paused while hovered or focused. Output containing errors
never auto-hides, since that is the case where the user most needs it. The
count badge is tinted by the worst level (grey / amber / red).

**Bringing it back:** the next run that prints shows it again, and a "Show
console output" command-palette entry reopens the last run's output expanded.
No new `window.partwright` method: agents already receive the same lines as
`logs` on run / runAndSave / getGeometryData, so this is a view toggle, not a
capability gap.
