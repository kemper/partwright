---
session: "01QnZGNLbg"
timestamp: "2026-11-15T19:18:04Z"
tools: [playwright, vite-node]
---

## Human

(After a report that the long "Rendering…" on a big import is mostly the code
sandbox hardening the import's vertex arrays, issue #1259:)

Fix the bug, attach data and proof.

## Assistant

## Key decisions

**Root cause** (measured with timing marks inside the engine Worker): each
engine calls `hardenModelShared(api)` before running model code. `api.imports`
was a plain data property holding the import's `vertProperties` /
`triVerts`, so SES `harden` walked them — and hardening a typed array lists
every element as an own key. 9M elements (a 2M-triangle import) cost ~10 s on
every run, including runs that never touch the import.

**Fix: stop the walk at an accessor, and do harden's job by hand.**
`api.imports` (manifold-js) and `api.meshImports` (BREP) are now accessors;
harden freezes an accessor's functions but never calls them. The list goes
through a new `sealBulkRecords()` in `modelEval.ts`, which freezes the list
and each record and makes each typed array non-extensible. That is exactly
what harden did to them: elements can't be frozen, and the arrays are per-run
copies, so "nothing a run writes outlives the run" is unchanged. The helper is
a no-op without SES, like `hardenModelShared`, so the Node preview and the
kill-switch path behave as before.

**Why not skip hardening imports entirely:** model code could then swap a
record's array or push onto the list. Those objects are per-run too, but the
sandbox tests assert that everything reachable from `api` is locked, and the
shallow freeze keeps that true at no cost.

**Why not teach `hardenModelShared` to skip typed arrays:** the hardener is
SES's own `harden`; wrapping it would mean pre-walking the graph ourselves,
which is the cost being removed.

**Proof of no behaviour change:** the lock-down e2e probe (list frozen, record
frozen, arrays non-extensible, push / swap / expando all throw, a second run
doesn't see the first run's element write) passes on main and on this branch.
The speed test fails on main (10.3 s Worker time for a cube with a 2M-triangle
import attached) and passes here.

**Data:** the same benchmark spec was run on main and on the branch; the
numbers and chart are on the PR. Screenshots use a generated model only.
