---
session: "01U8g7w9"
timestamp: "2026-10-27T02:43:46Z"
tools: [vite-ssr, playwright, vitest]
---

## Human

Doesn't want the puffy SDF bodies; wants far more realistic characters (MakeHuman
or Daz quality is enough) that are still fully code-driven, so an AI can create
and modify them through a tool library. Mesh output is fine. Approved a 5-step
plan (tracking issue kemper/partwright#1151) and asked for step 1, the spike, as
its own PR.

## Assistant

## Key decisions

**Data, not code, from MakeHuman.** Its assets (base mesh hm08, targets, default
skeleton + weights) are CC0 per its LICENSE.md §C; its code is AGPL. The build
script only reads data files and re-packs them; the runtime (macro corner
weights, FK, skinning) is written fresh.

**Ship a trimmed asset (4.3 MB).** The 72 per-build height targets alone were
8 MB, so only the average-build height pair ships. Adult ages (young/old) only.
The asset lazy-loads in the Worker only when code mentions `api.human`, the
same pattern as text fonts. `/human/` joined the Worker's asset-fetch allowlist
(the first editor run failed without it).

**Pose vocabulary reused from the SDF rig.** `armL.raiseSide/raiseFwd/bend/twist`,
`spine`, `head` use the sdfFigure formulas, applied as rest-frame → posed-frame
rotations per bone, so existing pose presets carry over.

**Printability: the body mesh is already watertight.** The default
`weld: 'mesh'` keeps the exact skinned surface (crisp, about 26k tris). Eyeball/lid
contact left zero-volume slivers, so pieces without volume are dropped after the
union. `weld: 'voxel'` (nonzero-winding rasterize → EDT → levelSet) is the escape
hatch for deep self-intersecting bends.

**Iris/pupil as labelled runs.** Front-facing eyeball triangles get iris and
pupil labels via one ofMesh with per-label runs, so the eyes stay one closed mesh.
