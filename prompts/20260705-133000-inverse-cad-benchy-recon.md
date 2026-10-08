---
session: "inverse-cad"
timestamp: "2026-07-05T13:30:00Z"
model: claude-fable-5
sequence: 51
---

## Human

Attached the classic 3DBenchy STL: "Let's reverse engineer the benchy
next. It was designed to be a 3d print torture test and I bet it's a good
test for this." (This is the first foreign mesh — the genericity proof
for the v2 loop, Phase 5 of #878.)

## Assistant

## Key decisions

**The Benchy broke the topology gate before the first candidate — by
design of the experiment.** The mesh is watertight but self-touching
(502 non-manifold edges each shared by 4 faces, Euler characteristic 277
— odd), so the mesh-χ genus came out −137.5 and the gate's reference
was garbage. Every Dummy 13 target was clean, so this path had never
been exercised.

**Fixed it generically, not with a Benchy hack: `voxelGenus.mjs`.**
Ray-parity voxelize (reusing `voxelDiff.mjs`'s machinery, watertight by
construction), then the Euler characteristic of the occupied cubical
complex (χ = nV − nE + nF − nC) gives the *solid's* topology:
totalGenus = solidComponents + cavities − χ. Validated on synthetic
cube/hollow-cube/ring/double-ring (all exact) before trusting it.
`turn.mjs init` now auto-falls-back to it whenever the mesh genus is
fractional or negative, cross-checks res 0.25 vs 0.15, and records
provenance (`meshGenus`, `genusSource`) in target-profile.json.

**Benchy truth: genus 5, 1 component, 0 cavities** (stable across res).
Side discovery while validating: the dummy13 open-hand *solid* is genus
1 (touching finger loop) though its *surface* χ says 0 — the
mesh-genus/solid-genus distinction became PLAYBOOK §5.38, the foreign-
mesh fallback §5.37.

Convergence delegated to an inverse-sculpt agent (levelSet safety best
first, then optional hybrid semantic decode of the CSG-born
superstructure). Kept the driving model as the session default so the
foreign-mesh variable is isolated; the Opus 4.8 validation stays a
separate controlled run.
