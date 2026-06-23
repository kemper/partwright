---
session: "sharpbell"
timestamp: "2026-06-23T12:00:00Z"
sequence: 7
---

## Human

I merged the recent work, but can we apply tabby patterns to the cats (or any
animal I guess)?

## Assistant

## Key decisions

**The earlier deferral was wrong — `api.paint.*` is the missing tool.** Tabby
stripes were deferred on the previous PR because the proud-blob marking
mechanism (used for tuxedo/points) would emboss stripes as raised welts, and
the conclusion was "flush stripes need true per-triangle surface paint the SDF
label system lacks." But Partwright *has* that: `api.paint.box` / `paint.slab`
color surface triangles flush, changing zero geometry, and `model:preview`
resolves them headlessly (`stats.paintOps`). I proved it on a scratch sphere
first, then on the real cat — stripes resolve to nonzero triangle counts and
every face label (eye/iris/pupil/nose/muzzle) survives.

**Cat → `tabby`, dog → `brindle` (species-accurate striped colorways).** Added a
new option to each model's `pattern` param. Tabby = warm-brown mackerel stripes;
brindle = dark tiger stripes over a fawn coat (the canine term — "tabby" isn't a
dog pattern, and the user's "or any animal" invited the equivalent). Both are
**flush surface paint applied AFTER `.build()`** (paint resolves against the
returned mesh), pose-aware:

- *sitting:* vertical mackerel stripes down the flanks (thin boxes along X,
  bounded to the torso Z so they wrap the body but not the face), a forehead
  "M" of short crown stripes between the ears, and tail rings (cat).
- *standing:* the body is a horizontal barrel, so flank stripes run as thin
  bands along Y (front→rear) up over the spine, derived from `bodyResult`.

The stripe boxes are bounded away from the eyes/nose, and those are separate
labeled solids painted by the palette, so they're never clobbered (verified:
all face labels nonzero in both poses).

**Baseline-safe.** `solid` emits zero `api.paint.*` calls, so the default
render (the only variant the eval case tests) is byte-identical — `paintOps:
None`, genus/manifold unchanged. Paint never touches geometry, so the
`maxGenus` gate is unaffected.

**New palettes** `palettes/tabby.json` (cat) and `palettes/brindle.json` (dog)
set the harmonizing base coat; the stripe color is a const in the model (paint
takes a literal color, and a striped coat's stripe is intrinsically dark).

**Scope.** Delivered the striped colorways asked for. **Calico is now unblocked
by the same `api.paint.box` mechanism** (it's colored patches, not stripes) —
noted as an easy follow-up rather than expanding this PR. Verified every variant
via `model:preview --palette-file` across both poses; no app/src code touched.
