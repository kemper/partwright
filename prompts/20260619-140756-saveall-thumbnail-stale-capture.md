---
session: "beautiful-pascal-z0esff"
timestamp: "2026-06-19T14:07:56Z"
model: claude-opus-4-8
---

## Human

I created about 7 parts and saved them all at once and it looks like one
thumbnail got used for all/many of them. [Screenshot of parts rail with several
near-identical grey thumbnails.] Fix the thumbnail issue in the current PR.

## Assistant

## Key decisions

**Root cause** (separate from the color-on-switch fixes already in this PR):
new parts seed a rotating starter primitive that renders AND colors itself, but
`loadPartIntoEditor`'s version-less branch called `startNewPartInEditor()`,
which fires `seedStarter()` via `void` — not awaited. So a part switch
"completed" (its `await selectPart(...)` resolved) before the starter actually
rendered. The Save-all loop (`saveSelectedParts`) does `await selectPart(part)`
then immediately `captureThumbnail()` (which renders `currentMeshData`), so it
captured the PREVIOUS part's stale mesh. Every freshly-created part got the same
wrong, colorless thumbnail; only the current part (saved in place, no switch)
got its real colored starter.

Reproduced: 5 parts created via "+", saved at once → 4 byte-identical grey
spheres + 1 correctly-colored sphere. After the fix → 5 distinct, colored
thumbnails (the starter rotation: cube/sphere/cylinder/cone/pyramid).

**Fix:** in `loadPartIntoEditor`'s version-less branch, `await
seedStarter(getActiveLanguage())` instead of the fire-and-forget
`startNewPartInEditor()`. A part switch now isn't done until the new part's
geometry (and its label color) is on screen, so any post-switch thumbnail
capture sees the right mesh. `startNewPartInEditor()` stays for its other
(non-awaited-context) callers.

**Verification:** added `tests/save-all-thumbnails.spec.ts` (create several
parts via "+", Save-all, assert all thumbnails are distinct). Fails before /
passes after. `parts`, `save-all-parts` suites still green; typecheck clean.
