# Retro: figure hands — fine-mesh + natural grips (Option 3, PR #780)

**Task:** Fix figure-finger spikes/webbing and "alien" open hand; make hands bigger + add a size param.

## Liked
- `genus` from `model:preview` JSON is a *fast, objective* defect detector for this class of bug — a tight loop (`--json | grep genus`) caught webbing the eye misses, and a per-grip sweep mapped clean vs broken in seconds. Far cheaper than reading PNGs each pass.
- The transparent `fineHands` marker + additive `partitionByLabel` branch fixed the whole figure with ZERO example churn and zero blast radius on non-figure SDF (gated on the marker). Worth the extra plumbing over editing ~46 examples.
- Isolating a single hand via a half-space `subtract` + recenter gave clean fillable-frame close-ups for the per-grip aesthetic review.

## Lacked
- I burned several passes treating the genus as a pure resolution problem (kept cranking `fineEdge`) before noticing **genus RISING with finer resolution** — the unmistakable tell of a non-Lipschitz `smoothUnion` (smin) field. That signature should be in CLAUDE.md.
- I shipped the first Option 3 with the spread-sign bug + smin palm latent (coarse mesh masked them). A per-grip close-up review BEFORE the first PR — not after the user flagged it — would have caught the alien fan.

## Learned
- **smin (`smoothUnion`) marching artifacts get WORSE as the grid refines** (more cells sample the bad field region) → genus climbs with resolution. Plain `union` (min) is Lipschitz and clean. If finer = more handles, suspect a smin, not under-resolution.
- **Mesh thin-feature SDFs in their canonical (axis-aligned) frame, then transform the MESH** — not the SDF. A rotated SDF marches thin gaps diagonally to the grid → pose-dependent webbing. The SDF `.rotate` matches `Manifold.rotate` (Rz·Ry·Rx), so meshing canonical + `m.rotate(euler).translate(c)` is identical geometry, minus the artifacts, plus a tight cheap bbox.
- A boolean splice of one *fused* field (re-march a sphere of arm+hand, subtract+union) can't replace a sub-feature cleanly: coarse vs fine sample the shared limb at different radii → seam handles. Two *distinct* overlapping solids (forearm capsule + palm slab) hard-union cleanly instead.
- Refinement-after-coarse-march (`sdfRefine`) **cannot change topology** — it only subdivides+reprojects what the march produced, so it frays webbing into spikes rather than removing it. Topology must be right at the march.

## Longed for
- A standing CLAUDE.md note: "genus rises with resolution ⇒ smin field" and "mesh thin features canonical-then-transform." Both cost me multiple passes to rediscover.
- Same as prior retros: a shell-accessible CI-status probe in web/remote sessions (no `gh`), so the post-push green-watch isn't manual MCP polling.
