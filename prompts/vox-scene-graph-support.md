---
session: "i9i55h"
timestamp: "2026-06-10T22:40:00Z"
tools: [subagent, websearch, playwright, vitest]
---

## Human

Research question about MagicaVoxel / MagicaCSG: how they work, whether the
source was published, and whether techniques could be adopted into Partwright.
After establishing that the only openly-licensed asset is the MIT-licensed
`.vox` format spec (the apps themselves are closed freeware), and that the SDF
smooth-CSG capability MagicaCSG embodies already exists in Partwright via
`api.sdf`, the actionable gap was `.vox` round-trip fidelity. Instruction:
"Do the VOX fixes."

## Assistant

## Key decisions

**Scoped to the real fidelity gap: scene-graph (multi-object) import.** The
importer previously walked only MAIN's direct children and parsed
`SIZE/XYZI/RGBA`, picking model 0 and silently dropping every other model — so
any multi-object MagicaVoxel scene (the common case; MV emits one model per
object) collapsed to a single piece at the origin. Added full `nTRN/nGRP/nSHP`
+ `DICT`/`STRING` parsing and a graph traversal that composes each node's
translation **and** rotation (the `_r` signed-permutation byte) and assembles
every shape's model into one grid at its world position. Models are positioned
by their center (`floor(size/2)`), matching MV's transform convention and the
existing single-model centering.

**Kept a legacy fallback rather than changing behavior for old files.** When no
explicit `modelIndex` is requested *and* a scene graph is present, assemble the
whole scene; otherwise (no graph, or an explicit `modelIndex` picking one
model) keep the prior center-one-model path. This preserves every existing
test and the `modelIndex` escape hatch, and means hand-built `SIZE/XYZI`-only
files are untouched.

**Defensive parsing — a malformed scene node degrades, never throws.** Scene
chunks are read through a bounds-checked `ChunkReader` that throws past the
chunk end; each node parse is wrapped so a truncated/garbage node is skipped
and the file falls back to the legacy path. A cyclic graph is guarded with a
`seen` set. A scene that yields no shapes also falls back.

**Export now emits a canonical scene graph** (`nTRN`→`nGRP`→`nTRN`→`nSHP`) so
our output matches the structure MagicaVoxel itself writes, and the export
round-trip tests now exercise the new import path. The shape transform
translates by the model center so the round-trip reproduces the same occupancy
the old center-on-corner layout produced.

**Deliberately did NOT emit `MATL`.** A Partwright voxel grid carries only RGBA
color — there is no metal/glass/emissive/roughness data to serialize — so a
`MATL` chunk would be fabricated defaults: bytes, not fidelity. Documented the
omission in the export header comment. (Likewise left the 256/axis single-model
limit in place; multi-model tiling to lift it would be a separate, larger
change.)

**Verification.** Added unit tests for two-model placement, the `modelIndex`
bypass, a 90°-about-Z `_r` rotation (line in x → line in y), and malformed-node
fallback. Ran the full unit tier (1050 pass) + typecheck, and a throwaway
Playwright spec that imports a hand-built two-cube scene through the real
import→voxel-render path and screenshots both cubes at their offset positions.
