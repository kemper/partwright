---
session: "sharpbell"
timestamp: "2026-06-23T15:10:00Z"
sequence: 10
---

## Human

proceed to the next step  [wire the procedural colourways into the real
cat & dog models; add the gradient face-darkening refinement; docs]

## Assistant

## Key decisions

**Gradient (siamese) refinement — anchor-driven extremities.** Added an optional
`anchors: [x,y,z][]` to the pattern spec. When present, `gradient` marks
triangles within `scale` of the nearest anchor (so the *face mask* darkens, not
just top/bottom); without anchors it keeps the distance-from-centre fallback.
The cat passes its existing `markAnchorsFor()` ear/paw/tail/face points — no new
anchor math, and the seal-point siamese now reads correctly (dark mask + ears +
paws over a cream body, blue eyes from the palette).

**Replaced the box-based tabby/brindle with `api.paint.pattern` colourways.** The
hand-placed `paint.box` stripes (which the user disliked) are gone. The cat now
has `tabby` (stripes), `calico` (patches), `spotted` (spots), `siamese`
(gradient); the dog has `brindle` (stripes), `merle` (patches), `spotted`
(dalmatian spots) — all scoped to the `body` label so the face features survive,
all pose-aware, all verified headlessly (manifold, face labels nonzero). The
proud-blob `tuxedo`/`points`/`tan-points` colourways are untouched, and `solid`
still emits zero paint ops so the eval default case is byte-identical.

**Coats live in code, faces in the palette.** Each colourway's coat colours are
the in-code `api.paint.pattern` args; the per-colourway palette JSONs only set
the face features (eye/iris/nose/muzzle/…) — e.g. blue eyes for siamese, amber
for the dalmatian. Since the pattern paints the whole body, the palette's `body`
value is cosmetic for patterned variants.

**Docs/parity.** `api.paint.*`/`api.surface.*` are code-gen for the in-app AI
(docs-only, no dedicated tool), so parity = documenting it: added the
"Algorithmic colourways — api.paint.pattern" section to `public/ai/colors.md`,
including the regional-scope predicates and the **why-not-SDF-labels** seam note.

Engine remains pure + shared between the headless preview and the browser
resolver; unit tier green; tsc clean.
