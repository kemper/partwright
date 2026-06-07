---
date: 2026-06-06
branch: claude/inspiring-brown-MHzmu
pr: 403
tags: [catalog, print-fit, joinery, thumbnails, color]
---

## Human

The four print-fit catalog entries all had problems: the enclosure had a stray
hole, the T-slot bracket had mixed round+square holes, the dovetail couldn't lock
(wasn't a proper trapezoid in use), and the mounting plate was an irregular
kitchen-sink with a peg poking through one side. None had screenshots or color,
and they didn't showcase genuinely useful parts (e.g. a dovetail mounted to
something that holds it together). Revisit the whole catalog section, and report
any API improvements that would prevent these mistakes.

## Assistant

### Root-cause of each defect (verified by rendering, not guessing)

- **Dovetail "couldn't lock":** the builder is correct (isosceles trapezoid,
  narrow root / wide top). My old model omitted the `rotate` that stands the tail
  up, so the rail flopped sideways and never matched the socket. Rendering the
  mate (`tail.rotate([0,-90,0])` rail + `socket.rotate(...)` groove) confirmed a
  clean interlocking pair.
- **Bracket round+square holes:** the `nutPocket` double-rotation was nonsense.
  Root issue: every negative builder assumes "entrance up at z=0, cut −Z", so
  mounting on a side face needs error-prone manual rotation.
- **Mounting plate:** genuinely a confusing demo (horizontal pin through one
  edge + socket on the other). Replaced entirely.
- **Enclosure stray hole / componentCount drift:** coplanar bosses don't fuse;
  the asymmetric 2-boss + pin + socket layout read as random holes.

### Rebuilt catalog: 4 useful, correct, two-tone-colored parts

Each verified via `npm run cli -- preview` (the new CLI) before baking:

1. **Electronics Project Box** — base tray with 4 full-height M3 heat-set insert
   bosses + lid with 4 flush countersunk M3 holes. (insertBoss + screwHole)
2. **Captive-Nut Tightening Knob** — knurled hand knob, captive M4 nut pocket in
   the base (opens downward via `rotate([180,0,0])`) + clearance bore through.
   (nutPocket captive + screwHole through)
3. **Dovetail Wall Mount** — wall plate (flush countersunk screws) with a
   dovetail rail + a J-hook that slides on and locks. This is the "screw to
   something + dovetail holds the removable part" idea. (screwHole countersunk +
   dovetail tail/socket)
4. **Snap-Fit Parts Box** — box + lid that clicks shut with cantilever tabs, no
   hardware. (snapFit clip/catch)

Colors are baked into the code via `api.label(shape, name, {color})` so they
render with no paint step. Thumbnails generated with
`BAKE_CATALOG=1 npx playwright test _catalogBake` (real WebGL capture).

### API improvement suggestions reported to the user

Compiled a list (face-aware placement for negative tools; explicit dovetail
slide axis; auto-embed for boss/pin to avoid the coplanar-fusion footgun;
clearanceCoupon font fallback for the CLI; suppressing the harmless sub-0.4mm
LIP-tip warning). Reported in chat for the user to prioritize rather than
expanding this PR's scope.
