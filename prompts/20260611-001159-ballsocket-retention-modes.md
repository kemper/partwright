---
session: "01BFo9d6wfik7wiXfWT4h8yB"
timestamp: "2026-06-11T00:11:59Z"
model: claude-opus-4-8
---

## Human

(After the earlier defaults-only fix merged.) Reprinted the ball-socket mount:
the lip that retains the ball is still so tight that getting the ball in broke
the stem again. Also dubious the joint is useful at all — once the ball is in,
it rotates freely with no friction, and a mount needs to hold the angle you set
it to. Never asked for friction originally but it's the only way it's useful.
The defaults at minimum are not great. What should we do?

Chose (via AskUserQuestion): add a `retention` mode param to the builder,
default to friction, keep snap available.

## Assistant

## Key decisions

**Root cause is a design conflict, not a defaults tweak.** A solid snap-fit
ball-and-socket can't satisfy its three requirements at the same time: the lip
must be smaller than the ball to retain it (captive), but a rigid FDM lip can't
flex so the insertion force is driven straight through the stem (snaps it), and
once the ball is past the lip the clearance gap means it rotates freely (no
friction). Tightening for grip worsens insertion; loosening for insertion kills
grip. No parameter combination wins.

**Added `retention: 'friction' | 'clamp' | 'snap'` to `joints.ballSocket`,
default `'friction'`** (`src/geometry/joints.ts`). Return shape `{ ball, socket }`
is unchanged for back-compat; only the socket geometry varies:
- **friction** — `slots` (default 4) axial relief cuts split the rim into
  springy fingers. Fingers splay on insertion (low force → stem survives) then
  spring back and clamp the ball → holds the set pose. Grip is tunable via
  `openingRatio`/`slots`, independent of insertion ease. The slots are what
  convert "lip too tight → breaks stem" into "lip grips → friction hold."
- **clamp** — a single pinch slot + a lug block (split by the same slot into two
  ears) bored transversely for an M-screw (`screwD`, default 3.4 = M3
  clearance). Ball drops in free; tighten to set friction up to a hard lock.
- **snap** — the legacy solid lip, kept verbatim for back-compat.

**Stem fix for all modes:** added a conical fillet at the stem root (the stress
riser that snapped thin stems) and dropped the catalog default `stemL` 12→10 to
shorten the lever. Kept `stemD` 8 from the prior fix.

**Catalog model** (`examples/ball_socket_mount.js` + the embedded copy in
`public/catalog/ball_socket_mount.partwright.json`) gains a `retention` select
(default friction) + a `slots` slider, with friction-tuned defaults
(`openingRatio` 0.86, `clearance` 0.25). Reused the prior rebake flow
(`runAndSave` + `exportSession`) to refresh the embedded thumbnail and cached
`geometryData`, preserving the catalog's session-identity fields.

**Verification:** `model:preview` confirms all three modes are
`isManifold: true` with the socket a single component (slots/pinch don't sever
the floor ring) and the assembly `componentCount: 2`. Added clamp + snap socket
cases to `tests/print-fit.spec.ts` (all 27 pass on the real kernel). typecheck,
1046 unit tests, and `lint:deps` clean. Friction/clamp grip is printer-dependent
so the docs note to dial it in on a real print.
