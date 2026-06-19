---
date: 2026-06-19
branch: claude/clever-hypatia-eyspgw
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_locs_musician.js
---

## Human

Looking at the relaxed musician with shoulder-length locs: the nose has a
"triangular corruption" defect and the mouth is just a slightly extruded bump
that doesn't look good. Investigate and fix both. Also: it feels like the
pursed/colored-lips and mouth-style work got reverted from the catalog — is the
feature gone? Land a solid fix; show preview images; keep code-only here and
re-bake the whole catalog in a separate PR.

## Assistant

Two separate root causes, plus a reassurance on the "reverted" worry.

### Nose — the carve, not the body, was broken

The SDF nose body (`buildNose`) is sound: dorsum chain + tip bulb + alae weld
to "one solid extrusion." The defect was purely the **nostril carve**. It
`smoothSubtract`-ed two cavities that tunnelled ~60% deep into a small figure
tip (radius ≈ 0.47, right at the 0.46 carve-safety floor), so the thin walls
between the two openings fell below the marching-cubes cell size and shattered
into the jagged "triangular" crater. This tore on *every* normal-sized figure,
not just the musician — the prior #703 "soft blend" ramp wasn't enough at the
floor.

Fix: make each nostril a **shallow, well-separated, large-blend dish** instead
of a deep tunnel — Z extent ≈ the in-plane radius (was 1.5×), smaller `nRad`
(0.4→0.3·tipR), wider spread (so a thick septum survives), and a much larger
`carveK` (≥0.18, ~1.3·nRad) so the subtraction resolves as a smooth depression
that physically can't alias. Verified genus-0 / manifold and visually clean
across `straight`/`broad`/`bulbous`/`roman` presets and on the full musician.
Reads as a subtle nostril from below; aligns with the "clean solid nose" intent
over an anatomically-deep opening that the grid can't hold. All 254 figure unit
tests still pass (they assert geometric properties — "carve removes real
geometry", silhouette deltas — which still hold).

### Mouth — not reverted, just not opted-in

The musician used `mouth: { style: 'lips', ... }` with no `lipShape`, which
falls back to the historical flat capsule ridge (the "bump"). The sculpted
two-lip form needs a preset, so I set `lipShape: 'natural'` — cupid's-bow upper
+ fuller lower + parting groove.

On the "feature reverted" worry: it is NOT. `lipShape` presets, the
smile/lips/open styles, and colored `mouthAccents` are all live in code and in
the baked catalog (30 entries carry painted lip/teeth geometry, 17 palettes
define lip/teeth colors). Proven by rendering `bust_natural_lips` in colour
through the same engine — sculpted, painted lips resolve perfectly. The one
real gap: the `rosebud` (pursed) preset exists but no example/catalog entry
showcases it — a candidate follow-up.

Scope per the request: code + the one example here; full catalog re-bake (which
propagates the nose fix to every figure thumbnail) is a separate PR.
