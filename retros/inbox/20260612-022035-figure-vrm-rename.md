# Retro — figure API full VRM rename (PR #613) + DX primitives (PR #608)

**Task:** consolidate `api.sdf.figure` onto one canonical VRM/plain-language
vocabulary (retire abduct/flex/elbow/knee, shoulder/hip/ankle, pelvis/navel,
thigh/shank/foreArm), update all examples + rebake all catalog data. Plus an
earlier PR adding `spanGrips`/`poseProbe` and a `holdAt` consumer.

## Liked
- The **numeric unit-test assertions were the perfect safety net for a rename.**
  97 figure tests assert joint *positions/proportions* (not names), so after
  renaming both the code and the test accessors, a passing suite proved the
  geometry was bit-identical. A rename where the tests only checked names would
  have proven nothing.
- `model:preview` volume as a second check: the rocker re-previewed to its exact
  prior volume (8950.147997…), independent confirmation of the no-op.

## Lacked
- **No semantic rename tool.** Did the rename with word-boundary `perl` on
  prefixed patterns (`j.shoulderL`, `p.abduct`, `r.thigh`). It works but is
  error-prone — three classes of miss each needed a separate grep+fix pass:
  (1) **template-literal keys** `` `knee${side}` `` and (2) **loop-var
  shorthands** `{ abduct }` that a `key:`-anchored pattern can't see; (3)
  **direct `rig.joints.X`** accesses where the code didn't go through the `j`
  alias. Serena's `rename_symbol` doesn't help for object-literal *string keys*.
- **`turn` is overloaded** (head→`yaw` vs spine→stays `turn`). A blind rename
  corrupts spine. Had to scope by line context (`if /head:/`). Any figure rename
  touching `turn` must special-case this.

## Learned
- **Catalog `.partwright.json` embeds the model SOURCE verbatim — including
  comments.** A rename isn't done when the examples compile: the embedded code
  (and stale DOF comments like "abduct 165, elbow 78") must be regenerated, or
  catalog entries throw / mislead. Required two rebake passes (code, then a
  comment-scrub pass). Grep every `.partwright.json` for retired tokens as the
  final gate.
- Geometry-identical rebakes are cheap to *verify* (volumes unchanged) but still
  need a headed `xvfb-run` bake per entry (~45s × 11). A "patch embedded code
  only, keep thumbnail" fast path would save ~8 min when geometry can't change.

## Longed for
- A **figure-API rename codemod** (or a registry the names derive from) so
  pose-DOF / joint renames are one declarative map, not 6 careful perl passes +
  3 grep-driven cleanup rounds across src/tests/examples/docs/catalog.
- A `model:preview --rebake-code <entry.partwright.json> <source.js>` that swaps
  the embedded source without re-rendering when the author asserts geometry is
  unchanged.
