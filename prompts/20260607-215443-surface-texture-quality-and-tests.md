---
session: "a7f3c2"
timestamp: "2026-06-07T21:54:43Z"
sequence: 3
---

## Human

Pre-production audit follow-up: "fix them and group the prs however you think
is most appropriate." This PR collects the surface-modifier findings.

## Assistant

## Key decisions

**Mesh-detail slider dead for 5 of 6 textures** (`main.ts` `buildSurfaceModifier`):
the opts objects for fuzzy/cable/waffle/fur/woven omitted `quality`, so the pure
functions fell back to `opts.quality ?? 3` and the slider — shipped specifically
to control mesh detail — was a no-op in both preview and apply for everything but
knit (which builds its own opts on a separate async path). The `base` defaults
already carry `quality: 3`, and every texture function reads `opts.quality ?? 3`,
so threading `quality` into each opts object fixes preview and apply at once.
Added it to all six branches and refreshed the stale "all three modifiers" /
partial-id-list doc comments (there are eight modifiers now).

**Unguarded scaleMesh** (`modifiers.ts` `applyScale`): a negative factor mirrors
the mesh (inverting winding → non-manifold) and a zero factor collapses an axis.
The public `scaleModel`/`previewScale` API takes raw numbers from callers/AI with
no validation. Added a positive-finite guard at `applyScale` — the engine-agnostic
boundary both API methods route through inside a try/catch, so a bad factor now
returns a clear `{ error }` instead of broken geometry.

**Dead code + test pointed at it** (`knitTexture.ts`, `surface.test.ts`): the
sync triplanar `knitTexture` was superseded by the UV rewrite (`knitTextureUV*`)
but never deleted, and the only thing importing it was the unit test — so the
knit invariants were verified against an algorithm production never runs. Deleted
`knitTexture` (and its now-orphaned `triplanarCoords` import), and retargeted the
test at the live `knitTextureUV`. Added a parameterized test table covering the
four newest textures (cable/waffle/fur/woven) for determinism, finite output,
subdivision, and color carry-through — they had zero unit coverage. Also fixed
`subdivideToMaxEdge(c, 3)` → `{ maxEdge: 3 }` (a bare number left `maxEdge`
undefined, so the test asserted nothing about edge length).
