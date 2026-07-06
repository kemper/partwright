---
session: "inverse-cad"
timestamp: "2026-07-03T23:45:00Z"
model: claude-fable-5
sequence: 35
---

## Human

(continuation — armor wave 1)

## Assistant

## Key decisions

**armor_waist — the hardest bootstrap in the corpus (score 9.73, freeform
on all three axes) — converged 0/6 → 6/6+2/2 MUST in ONE authored turn**
(chamfer 0.005, IoU 0.9953, genus 2/2 exact). The agent abandoned the
band-stack scaffold outright and applied the levelSet SDF-interpolation
restructure: 115 measured sections at 0.15mm with STRADDLE PAIRS around
the six measured ledges (blend zone 0.01mm instead of one pitch), flat
caps, decompose-and-drop-junk guard, ~7s build via per-polygon bbox
early-reject + per-column memoization.

This is the levelSet technique's first production win on exactly the
geometry class it was designed for — and topology interpolated correctly
for free (plate → two lobes → band transitions). Ratcheted as §5.25/5.25a.

3/16 armor converged. genLevelSet.mjs left uncommitted deliberately — the
hands-productionization agent still owns that file mid-flight.
