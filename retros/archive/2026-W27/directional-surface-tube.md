# Retro — api.sdf.tube (directional surface textures)

**Task:** Audit of why the in-app AI couldn't reproduce a ribbed saguaro cactus,
then shipped `api.sdf.tube` (flutes/rings/helix that flow along a path) + docs +
3 catalog entries. PR #799.

## Liked
- `model:preview` made the whole iteration loop fast and honest — verified
  `componentCount: 1` / `isManifold` and saw the directional textures from
  multiple angles *before* paying for an xvfb bake. The colored paint resolving
  in the headless PNG (api.paint.*) was a pleasant surprise that avoided extra bakes.
- The SDF layer's `leafNode` + namespace + `__testables__` pattern made adding a
  primitive a clean, well-bounded change with a pure-logic unit test.

## Lacked
- The audited agent asked for several features that ALREADY exist (`maxComponents`
  assertion that hard-blocks, `runIsolated`/`runAndExplain`/`modifyAndTest`
  non-saving runs). The capability surface is rich but its discoverability from
  *inside* the verb decision tree is weak — agents reach for `warp` before the tool.
- `model:preview` validates `api.surface.*` options but doesn't COMPUTE them
  (filed #801). Cost me a moment of "did the texture apply?" confusion.

## Learned
- The robust recipe for a ribbed branching organic shape is SDF capsules/tubes +
  `smoothUnion` (connected by construction), NOT `Curves.sweep` + lofted caps
  (phase-seam hell) and NOT `warp`/`displace` hand-rolling. A path-local
  rotation-minimizing frame makes directional texture continuous through bends —
  the key insight the agent missed by staying in the sweep mental model.
- First catalog bake after `npm run dev` cold-start produced a 3 KB json with no
  thumbnail; a re-bake was correct. Worth a settle/retry in the bake script.

## Longed for
- A single "directional texture along a path" was a missing primitive that every
  ribbed/threaded/corrugated subject re-derives. Generalize the lesson: when an
  audit shows agents hand-rolling frame math, the fix is usually a primitive, not
  a doc. A capability registry that the verb table + API both derive from would
  stop the recurring "feature exists but agent didn't find it" failure mode.
