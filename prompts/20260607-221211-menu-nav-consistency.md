---
session: "a7f3c2"
timestamp: "2026-06-07T22:12:11Z"
sequence: 8
---

## Human

Pre-production audit follow-up: "fix them and group the prs however you think
is most appropriate." This PR collects the menus / navigation / keyboard
findings.

## Assistant

## Key decisions

**Command palette fell behind the toolbar** (`main.ts`): after the view-menu
refactor moved Surface, Resize, Place/Rotate, Print, and Voxel-Studio behind the
collapsed Tools/Inspect popovers, those tools had no command-palette entry — yet
the palette is documented as "the flat, searchable index of everything" and is
now the only keyboard/search path to them. Added five `tool-*` commands that
fire the existing overlay toggles by id (click works even while the toggle sits
in a collapsed popover, matching the existing tool entries). Verified all five
toggle ids exist; gated the mesh tools on `viewportToolEnabled` and voxel-studio
on the voxel language (mirroring export-vox).

**Guided tour spotlighted hidden popover buttons** (`tour.ts`): steps targeting
`#measure-toggle`/`#paint-toggle`/`#simplify-toggle` now live inside collapsed
popovers, so on first run their targets reported a 0×0 rect and the spotlight
rendered over an empty corner. The skip loop only checked existence, not
visibility. Added an `openSelector` to those steps (the Inspect/Tools popover
trigger, mirroring hintsData), clicked open before measuring, plus a zero-rect
skip as a safety net (matching coachmark's guard).

**Find/Replace advertised an unbound key** (`layout.ts`, `shortcutDefs.ts`): the
button title said "Ctrl+H", which nothing binds — the button opens CodeMirror's
search panel (Mod-F; Mod-Alt-F for replace). Fixed the title to the real,
platform-aware binding via the shared MOD_LABEL/combo helpers, and added a
Find/Replace row to the `?` cheat sheet (it was absent), so the documented keys
match what actually fires.
