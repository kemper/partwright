---
session: "017xgfPQK41H8feC99NhRjKm"
timestamp: "2026-10-23T15:44:10Z"
---

## Human

(Driving PR #1063 to green.) CI shard 6 failed twice on
landing-static › "a catalog tile loads that entry into the editor".

## Assistant

## Key decisions

**Root cause, not "flake".** The landing grid shows
`shuffle(manifest.entries)`, so the test's first tile is a random catalog
entry, and it waits 30 s for that entry to run. Heavy entries (SDF figures,
lighthouse_brep at about 20–25 s locally) exceed that on CI runners. I checked
it isn't #1063's change: every BREP catalog entry loads with no errors and the
same timings on main and on this branch, and main's gate passed the same shard
only because it drew a light tile.

**Ported the fix into this PR.** I couldn't re-run the job (403 for this
integration), and the fix is three lines of test. The test still asserts the
tile's `/editor?catalog=` href shape, then loads a known-light entry
(parametric_vent_panel), so it checks the deep-link wiring rather than how
fast a random model meshes. Filed as #1064.
