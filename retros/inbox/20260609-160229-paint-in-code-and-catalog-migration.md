---
date: "2026-06-09T16:02:29Z"
task: "feat: api.paint.* (declare paint in code) + migrate the whole catalog (50 versions / 237 regions) from the colorRegions sidecar into code"
areas: [paint, geometry-api, catalog, tooling, verification, docs]
cost: high
---

Two PRs from one thread: #532 added an `api.paint.*` sandbox API (box/slab/
cylinder/label) that records paint during a run and resolves it post-tessellation
into the model-colour underlay; #536 used it to migrate the curated catalog so
paint lives in code, not the saved sidecar, via a deterministic converter +
five parallel read-only audit sub-agents.

## Liked / Worked
- **Building on the existing `api.label({color})` → model-underlay path made the
  primitive tiny and low-risk.** The descriptor types, `resolveDescriptorTriangles`,
  and the underlay layer already existed; `api.paint.*` just records descriptors
  and feeds the same machinery. New code was mostly validation + plumbing.
- **Deterministic converter script over agent hand-editing.** A 112-file mechanical
  JSON→code transform belongs in a script, not in N agents editing curated files.
  The script was instant, re-runnable, and reviewable; agents then *audited* in
  parallel (read-only) — the right division of labour.
- **The "safe-prefix" ordering rule made the migration provably pixel-identical.**
  Converting only the lowest-`order` prefix of convertible regions (stop at the
  first retained one) guarantees no overlay region jumps above a moved underlay
  region. Independently checkable (`max(converted) < min(retained)`), so it was
  easy to verify exhaustively rather than trust.
- **Parallel read-only audits caught a real bug the deterministic verifier missed**
  (see below) — independent eyes on a mechanical transform paid off.

## Lacked
- **No headless way to verify PAINT.** `model:preview` runs the engine in Node but
  doesn't resolve colour regions, so paint correctness could only be eyeballed in
  the browser — and the e2e browser path is serial (WASM contention), so I could
  spot-check 3 entries, not all 50. I had to fall back to a *deterministic
  descriptor-faithfulness* check (colours/params verbatim, ordering invariant)
  for breadth. A `model:preview --paint` that resolved regions and tinted the
  PNG would let an agent verify migrated colours across the whole catalog headlessly.
- **No single "rewrite a saved version's code" helper.** The converter had to
  hand-replicate `simpleHash` and update *three* coupled fields (`code`,
  `colorRegions`, `geometryData.colorRegions`) plus `geometryData.codeHash`. I
  missed `codeHash` on the first pass — every migrated entry would have loaded
  flagged `stale` (spurious re-run). Only the audit caught it. A canonical
  `setVersionCode(version, newCode)` that keeps the hash + region mirrors in sync
  would make this class of edit safe by construction.
- **The model-colour underlay isn't re-resolved by the mesh-refine paths.** Four
  paths (`rebuildPaintedGeometry` sync/async + `appendStrokeRefine` sync/async)
  each re-resolve *user* regions after subdivision but none touched model regions
  — a latent staleness bug for `api.label({color})` too, which I had to fix in #532
  by adding `reresolveModelRegions` to all four. That duplicated re-resolve loop
  across four sites is a smell; a shared "re-resolve all regions (user + model)
  against this mesh" helper would prevent the next path from forgetting one.

## Learned
- **Model-underlay regions don't drive mesh subdivision**, so a `smooth`
  slab/cylinder can't be moved to the underlay without coarsening its edge — which
  is *why* the migration must leave smooth/Tier-B regions in the sidecar. The
  "code is the artifact" line runs exactly along "does this descriptor need the
  refine pass?".
- **`codeHash` is the cached-stats staleness signal** (`simpleHash(code) !==
  geo.codeHash`); any tool that rewrites stored code must recompute it or trip a
  spurious re-run on load.

## Longed for
- A headless **paint-aware preview** (`model:preview --paint`) so colour
  correctness is verifiable without the (serial, contention-prone) browser.
- A canonical **`setVersionCode`/`rewriteVersion` helper** that keeps `code` +
  `codeHash` + both `colorRegions` mirrors consistent — the converter, surface
  modifiers, transforms, and import codegen all hand-roll slices of this.
