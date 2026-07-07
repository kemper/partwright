---
date: 2026-06-21
session: busycray
topic: oracle / headless render fidelity (#697, #835, PR #834)
---

# 4-Ls — investigate before building (two stale "build X" tasks)

## Liked
- The cheap empirical probe (run model in Node, compute count direct vs ofMesh, then
  the same in headless Chromium) settled a contested root-cause in minutes and
  PREVENTED shipping a no-op "fix" an exploration agent had confidently recommended.
- The existing daemon (`partwright render`/`iterate`) already solved the
  "warm browser" ask — found by reading `bin/partwright.mjs` before coding.

## Lacked
- A standing **SSR-vs-browser parity check**. Trust in the headless count had to be
  re-established by hand; nothing locks it in, so the next agent may re-litigate #697.
- Discoverability of the daemon's app-fidelity render path — it existed but wasn't
  surfaced where agents look (`model:preview` section). Fixed in this PR.

## Learned
- **An exploration agent's root-cause hypothesis is a lead, not a fact.** The
  "browser uses ofMesh, SSR doesn't → divergence" theory contradicted the bug's own
  evidence direction (SSR 1 vs browser 5) and was empirically a no-op. Validate
  before implementing, especially one-line "obvious" fixes.
- The perceived "low quality" of headless figures was 100% the **rasterizer**
  (flat + no AA), not the mesh — browser and Node triangleCount/genus were identical.
  Check whether a quality gap is render vs geometry before touching either.
- For heavy SDF figures, **meshing dominates** (10–70s); no renderer/daemon change
  makes a single heavy figure cheap. The daemon amortizes browser cold-start only.

## Longed for
- A `model:preview --fidelity browser` (or eval `--fidelity browser`) that routes
  through the daemon automatically, so "exact app pixels" is one flag, not a separate
  daemon dance. Deferred (user chose document-only for now).
- A tiny committed parity test (a few figures, assert headless componentCount/genus
  == browser) to stop #697-style re-investigation.
