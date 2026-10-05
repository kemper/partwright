# 4-Ls — dummy13 multi-part kits + parts overview / composite thumbnail

**Liked** — Per-part `expectComponents` gating paid for itself three times
in one afternoon: it caught simplify fusing articulated pieces, sub-mm
debris masquerading as parts, and a levelSet vertex-degeneracy that made
`decompose()` non-deterministic — all before anything shipped. Also: the
app already had multi-part sessions + a part list, so "split the kit
into parts" was a bake-tooling change, not a feature build.

**Lacked** — A single trustworthy component counter. Engine `decompose()`,
the app's statsComputation count, and the welded-mesh census disagree on
degenerate meshes (and decompose flip-flops run to run). Every probe
round-trip through the bake page costs ~2 min; a headless "count it all
three ways and explain disagreements" tool would have cut the debug loop
from ~8 bakes to 2.

**Learned** — `Mesh.merge()` + `ofMesh` canonicalization BEFORE any
decompose-based filtering is mandatory for levelSet output (debris can be
topologically fused through degenerate shared vertices). Baking against
the live dev server means app-code edits mid-bake are a real hazard (HMR
reloads the bake page) — sequence feature edits and bakes, never overlap.
Composite session thumbnails (schema 1.18) were cheap because thumbnails
were already Blobs one canvas away from a contact sheet.

**Longed for** — (1) The overview modal navigable by keyboard (arrows +
enter) — skipped for scope. (2) A `--verify-entry` mode that imports a
baked entry in a throwaway page and asserts part count + per-part
component counts post-import, closing the bake→import loop the scratch
spec covered manually. (3) Session-level thumbnails on the landing
sessions grid preferring the composite too (catalog got it; landing
still shows latest-version).
