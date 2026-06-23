---
date: "2026-06-10T13:55:00Z"
task: "feat: fasteners + joints namespaces with print-in-place builders and catalog demos"
pr: 568
areas: [geometry, namespaces, catalog, docs, subagents]
cost: low
---

## Liked / Worked
- The explore→implement worker pipeline conserved the main context exactly as
  intended: one explore agent produced a pattern report (factory shape,
  validation idiom, catalog schema, test conventions) detailed enough that the
  geometry/docs/catalog workers needed zero re-discovery.
- `model:preview --expect-components 2` is a perfect correctness gate for
  print-in-place builders; the geometry worker iterated the hinge to a verified
  2-component result without any browser round-trip.
- `scripts/build-catalog-entry.cjs` made regenerating six entries (with
  thumbnails) mechanical.

## Lacked
- I designed a "fasteners + joints" feature from scratch before discovering
  ~80% of it already existed as `api.printFit` — the namespace name didn't
  surface in a search for fastener/joint/hinge concepts, and CLAUDE.md's
  architecture list doesn't enumerate sandbox namespaces. Cost: a planning
  round-trip with the user and a scope reset mid-task.

## Learned
- `api.printFit` builders bake the bbox-overlap "interpenetration" warning
  false-positive into any interleaved print-in-place assembly; the reliable
  check is an explicit `a.intersect(b)` zero-volume probe plus
  `--expect-components`.
- Catalog `select`-type params surface their option strings verbatim in the
  Customizer UI, so human-readable option values are the convention.
- `build-catalog-entry.cjs` needs `xvfb-run` in this container (headed
  Chromium, real WebGL for thumbnails).

## Longed for
- A generated one-page index of the sandbox API surface (`api.*` namespaces +
  method names, like `help()` but for the sandbox) checked into docs/ — the
  feature-gap question that started this task could have been answered in one
  read, and it would have prevented the printFit blind spot. Could be emitted
  by a script that walks the `createXNamespace` return objects.
