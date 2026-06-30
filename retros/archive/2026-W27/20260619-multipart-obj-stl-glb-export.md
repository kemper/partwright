# Retro — multi-part OBJ / STL / GLB export (PR #761)

**Liked.** The recently-merged 3MF multipart flow had already factored out the hard,
format-agnostic half — pick parts → bake each part's latest version WITH colours
off-editor (`bakeColoredMeshForPart`) + the part picker. So adding three more formats
was mostly per-format *bundling* + wiring, not a rebuild. Routing the existing OBJ/STL/
GLB toolbar buttons to the picker on `parts.length > 1` (mirroring the 3MF button)
meant zero new UI surface to design.

**Lacked.** The investigation subagent's report was thorough enough that I could
design all three builders before reading a single exporter myself — but the GLB path
still had a non-obvious trap: the existing GLB exporter serializes the *live viewport
scene*, which only holds the active part. Nothing in the report flagged that it
couldn't be reused for multipart; I had to discover that the scene had to be rebuilt
from the baked meshes. A note like "GLB reads the live scene, not a MeshData" would
have saved a read cycle.

**Learned.** `GLTFExporter.parseAsync` defaults to `trs: false`, so node positions
land in a baked `matrix`, NOT a `translation` — my first grid-layout assertion read
`node.translation[0]` and saw `undefined` → all-zero → false "parts overlap" failure.
The test now reads `translation ?? matrix[12]`. Worth remembering for any future glTF
node-transform assertion.

**Longed for.** A typed capability registry so "this format has a multipart export"
is declared once and the toolbar + console API + docs all derive from it. Right now
parity across the four export paths (menu button ⇄ `export*Parts` ⇄ `*PartsData` ⇄
help table ⇄ ai.md) is hand-maintained in five places per format — the same drift
risk CLAUDE.md's UI↔API parity section calls out. Adding a 5th format will touch all
five again.
