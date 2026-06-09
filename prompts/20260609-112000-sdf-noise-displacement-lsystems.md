---
session: "thi3d7"
timestamp: "2026-06-09T11:20:00Z"
model: claude-opus-4-8
tools: [model-preview, catalog-regen, playwright]
---

## Human

(Context: user was exploring thi.ng — Karsten Schmidt's ~210-package
TypeScript monorepo for generative/computational design — and asked what
could be useful to Partwright for 3D-printable models, then its license
and AI-use status, then:)

"ok. let's try a spike that you suggested. create a few new catalog
entries that will demonstrate the new capacities. when you're done give me
a list of follow up features that we try next" → "let's do both noise
displacement and L systems growth with multiple catalog demos for each"

## Assistant

## Key decisions

**The originally-pitched spike (SDF→levelSet) was already built.** A scan
of `src/geometry/sdf.ts` (1591 lines) showed a mature chainable SDF layer —
primitives, smooth booleans, TPMS lattices, polar/repeat combinators,
graded thickness — already lowering through `Manifold.levelSet`, with ~14
`sdf-*` catalog entries. So "demonstrate new capacities" required filling a
real gap rather than rehashing it. Surfaced this to the user and picked the
two thi.ng-shaped gaps the SDF layer genuinely lacked: stochastic noise
displacement (`@thi.ng/noise`-style) and L-system growth (`@thi.ng/lsys`-
style).

**Vendored, not depended.** Implemented small dependency-free modules
(`src/geometry/noise.ts` Perlin+fBm, `src/geometry/lsystem.ts` rewriter +
3D turtle) rather than adding `@thi.ng/*` to package.json — this is a spike,
and `node.displace()` takes any `(x,y,z)=>number`, so a real thi.ng field
is a later drop-in with no SDF-side change. Both modules are pure logic,
so they live in the fast unit tier (`tests/unit/noise.test.ts`,
`lsystem.test.ts`).

**API surface (minimal, parity-complete).** Added `SdfNode.displace(amount,
field)`, `api.sdf.noise(opts)`, `api.sdf.lsystem(opts)`. Wired all four
parity surfaces per CLAUDE.md: argument validation via the `assert*`
helpers, `apiCompletions.ts` (SDF_STATIC + SDF_INSTANCE), `public/ai/sdf.md`
(new "Generative fields & grammars" section + a `.displace` modifier note),
and `public/ai.md` (capability-table rows + subdoc trigger). No new
`ai/tools.ts` tool — SDF is authored via `runAndSave` code, so the existing
codegen path already covers chat-driven use.

**The floating-island problem drove the model tuning.** Noise displacement
on an SDF can pinch off detached components two ways: (1) noise octaves
finer than the mesh `edgeLength` alias into hundreds of speckle components —
cap the finest frequency to ~2× edgeLength; (2) ridged noise bumps OUTWARD
into the air and spawns isolated zero-crossings above the surface. The
reliable fix, now documented and used in the bark-vase/brain-coral demos,
is shaping the field to `[-1, 0]` so displacement carves INWARD only, which
can never detach a piece. Verified every model with `model:preview`
(`componentCount`, triangle budget) before packaging.

**L-system cost is `segments × grid`.** `smoothUnion` over a few hundred
capsules at a fine grid times out; kept iterations ≈3–5 and `edgeLength`
≥0.6. Grammar tuning (radial spread needs *rolls between sibling branches*,
not just pitch) was done in the preview loop. The tree's two-region paint
(wood + leaves) comes from one `lsystem({ leaf })` call via the leaf-marker
mechanism in the turtle.

**Six catalog entries**, generated through the real browser app
(`scripts/catalog-regen.cjs`, which runs + paints + exports each), category
auto-derived from `api.sdf` usage: SDF Asteroid, SDF Bark Vase, SDF Brain
Coral (noise); L-System Fern, L-System Coral, L-System Tree (grammars).
Verified in-app via the `/catalog` page and opening the tree in the editor.
