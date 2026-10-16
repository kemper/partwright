---
date: "2026-10-09T01:00:00Z"
task: "feat: rename parts to objects and list each object's parts and pieces"
pr: 995
areas: [ui, agents, testing, docs]
cost: medium
---

## Liked / Worked
- `tests/unit/apiParity.test.ts` immediately enforced help() coverage for every
  new and alias method. That made the rename-with-aliases safe to do mechanically.
- The work-reviewer subagent found two real blockers I had missed. One was that
  the highlight overlay leaked into GLB export, because `serializeSceneToGLB`
  walks the live scene. The other was that labelling an arrange-mode op result
  re-IDs (`asOriginal`) and erases the user's inner labels.
- Writing the golden-path spec first surfaced a product bug: 0-triangle labels
  sit in `labelMap` as empty sets, not in `lostLabels`.

## Lacked
- CLAUDE.md's "NUL-byte zones" warning for `src/main.ts` is stale (0 NUL bytes
  on main). I worked around a hazard that no longer exists. Filed as #996.
- There's no documented convention for attaching PR screenshots. The only
  precedent was a `<branch>-pr-assets` branch, which the branch rules forbid. I
  used a commit-then-delete on the feature branch, pinned by SHA.

## Learned
- `currentLabelMap` indexes the RUN mesh only. Paint refine, simplify, texture
  and the SDF preview all replace `currentMeshData` without rebuilding the map.
  Anything that reads label triangle ids must pair the map with the mesh it was
  built against (`currentLabelMesh`).
- Any child added to the viewport `meshGroup` is exported to GLB unless its name
  is in `EXCLUDED_NAMES` (`src/export/gltf.ts`).

## Longed for
- A documented, allowed way to attach screenshots to a PR, e.g. a
  `scripts/pr-proof.mjs` that uploads PNGs and prints markdown. Visual proof is
  requested often.
- A lint, or a viewport helper (`addOverlay(name, mesh)`), that registers
  transient overlays as raycast-ignored and export-excluded in one place.
