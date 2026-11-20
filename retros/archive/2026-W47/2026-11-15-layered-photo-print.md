# Retro — HueForge-style filament layering from photos (#1249)

**Liked:** Building the core as a pure, seeded module meant one solver served the vitest tier, a Vite-SSR CLI and a browser Worker, and the plans matched exactly across all three. Reading BambuStudio's own `bbs_3mf.cpp` / `GCode.cpp` from GitHub raw beat guessing the custom-gcode schema, and it caught that M600 ColorChange is compiled out (so manual swaps must use PausePrint).

**Lacked:** No way to run a real slicer here: GitHub release downloads are proxy-blocked, so the layer-swap 3MF is only structurally verified.

**Learned:** For schedule search, one-block-at-a-time exhaustive local search from a greedy start gets trapped: one filament fills the stack, and any single insertion splits it. Multi-start plus annealing plus an exhaustive polish fixed it. Coarse (3-bit) colour histograms silently wreck the objective; reduce fine bins by nearest-merge instead.

**Longed for:** A headless Bambu/Orca CLI (or a cached AppImage) in the environment, to slice-verify 3MF features like per-layer custom gcode.
