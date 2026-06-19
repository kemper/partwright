# Retro — figure hand rework (PR #748)

**Date:** 2026-06-19
**Task:** 3→4 fingers, flatter/more-anatomical figure hands; ended up a 3-iteration redesign with separated jointed fingers + flat slab palm.

## Liked
- `model:preview` multi-`--view` + sharp montages made before/after and A/B variant review fast and concrete. Letting the user pick from a labeled variant montage (A/B/C/D) converged the aesthetic direction in one round instead of blind iteration.
- The `[tracking]`/follow-up issue (#751 catalog rebake) kept the "bakes are stale" discovery from getting lost across three pushes.

## Lacked
- A headless check at **catalog/production mesh resolution**. The first rework looked great at fine preview `edgeLength` (0.18) but shipped craters/corrupted fingers because the catalog bakes coarse (detail sphere ≈ `r.hand*0.085`). I only caught it because the user reviewed the catalog. There's no gate that renders a hand/figure at the *actual* catalog march and flags sub-resolution features.
- An obvious way to A/B hand/figure sub-parts in isolation — I hand-rolled standalone `.plans` snippets re-implementing the builder math each time.

## Learned
- **Verify geometry at the resolution it will actually mesh at, not the resolution that looks best.** Fine-preview success is not catalog success. For figure sub-parts, render within the real detail-sphere `edgeLength`. This is the single biggest lesson — it caused a full extra rewrite.
- The SDF has no non-uniform scale by design; "flat" comes from clipping with a slab (`eulerAlignZ` for a square slab) or, when roll matters (a rectangular palm), a full basis→Euler orientation (`eulerFromBasis`, added here). Worth promoting `eulerFromBasis` to a shared helper if other parts need canonical-frame construction.
- Building a part in a **canonical frame then orienting** (vs. composing world-space points) is far cleaner for anything with a flat/rectangular feature or internal structure (joints) — and it set up finger joints for free.

## Longed for
- A `model:preview --catalog-res` flag (or a figure-specific smoke) that bakes at the catalog's global+detail `edgeLength` and warns on features that fall below the march — would have caught the crater bug in the fast loop instead of at user review.
- A tiny harness to render an individual figure sub-part (hand/foot/head) in isolation at catalog res without re-implementing the builder in a scratch file.
