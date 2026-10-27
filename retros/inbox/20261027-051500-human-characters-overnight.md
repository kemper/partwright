# Retro: parametric human characters, steps 1–5 overnight (#1151)

**Liked**
- `model:preview` with `--view` close-ups plus sharp crops caught almost every quality defect that type checks and stat checks couldn't: ragged hems, crumpled plates, nipples through cloth, painted-toe shoes, a floating necklace. Every one was fixed because a 1400–3000 px crop showed it.
- Tiny vite-node probes (`probe-toes`, `probe-neck`) turned "looks wrong" into a number in one call: toe verts 0.34 outside the shoe, neckR 4.2 vs 1.5. That beat iterating on renders.
- One reusable preview session made the photo fit cheap (~0.4 s per build).

**Lacked**
- No CI-like timing locally: a unit test that ran ~4 s here timed out at vitest's 5 s default on CI and cost a round.
- No standard way to stack PRs. Each step is a draft PR into main carrying the previous steps, so its diff isn't readable until the lower PR merges.

**Learned**
- Offsetting a shell along raw normals folds in concave regions. Smooth the base and the normals, not the result, and use Taubin rather than plain Laplacian, or the clearance clamp pops bumps back out.
- A scorer that aligns silhouettes by bounding-box centre is fine for judging likeness but useless as an optimisation objective (one arm moves the whole silhouette). Re-align before scoring.
- Footwear as a closed SDF beats a skin shell. When the lattice is coarse, size the shell's thickness from the voxel or thin features (toes) escape.

**Longed for**
- A `--crop region` option on `model:preview` (head, hands, feet) instead of hand-written sharp extract scripts.
- Proper stacked-PR support (base a PR on the branch below) so step PRs review as their own diff.
