---
session: "sharpbell"
timestamp: "2026-06-23T14:30:00Z"
sequence: 9
---

## Human

Is it possible to separate patterns into regions? ... could we target just the
head or maybe apply one pattern above an XY plane and another below? Could it
have been labeled as a head and given its own pattern? ... Do both. I like the
idea of having leg, tail, etc labels. Proceed and show previews.

## Assistant

## Key decisions

**Geometric scope predicates over SDF sub-labels — because SDF labels seam.**
The user wanted per-region patterns (head vs body, above/below a plane) and
liked the idea of head/leg/tail *labels*. But `src/geometry/sdf.ts` partitions
the tree at each `.label()` and meshes each labelled subtree independently —
"smooth blends ACROSS labels degrade to a hard union" (sdf.ts header). So
labeling head/legs/tail as separate SDF labels would put a **hard seam/pinch at
every joint** (neck, hips, tail root) — exactly what the rubric forbids, and the
reason the body is one fused `body` label today. Reported that finding and
delivered the seam-free equivalent instead.

**`PatternScope` geometric predicates.** Extended the pattern op's `scope` from
`{ label }` to `{ label?, above?, below?, box?, sphere? }`. The geometric
predicates AND together and narrow the base set by triangle centroid
(`filterScopeTriangles` in `colorPattern.ts`, a pure helper shared by both the
headless `paintOpsResolve` and the browser `resolveDescriptorTriangles`). This
gives the full regional capability with **no relabel and no seam**:

- `scope: { label:'body', sphere:{center, radius} }` → a head/paw blob (spotted
  head + striped body verified on one continuous mesh, clean neck).
- `scope: { label:'body', above:{axis:'z', at:zCut} }` + the matching `below` →
  one pattern above an XY plane, another below (calico head / striped body).

Multiple `api.paint.pattern` calls already composite (later wins), so regions
layer. Scoping by `label` still keeps eyes/nose untouched; the geometric
predicate further narrows within that.

**Validation + tests.** Strict arg validation for the new scope keys in
`manifoldJs.ts` (unknown-key rejection, axis/vec checks). Added
`tests/unit/colorPattern.test.ts` (pure module → unit tier): palette
quantization, stripes produce both tones, 3-color patches, and the
above/below/box/sphere filters. Full unit tier green (1594).

**On the user's "leg/tail labels" preference:** the seam-free way to give them
*named* regions is named geometric scopes in the model (head sphere / leg boxes
derived from the model's own anchors), not SDF labels — flagged as the wiring
step. The pattern engine stays untouched; only the model declares the named
scopes.
</content>
