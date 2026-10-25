---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T12:40:00Z"
model: claude-opus-5-5
tools: [subagent, git-worktree, playwright]
---

## Human

The engine-Worker lockdown from #1109 strips a denylist of network, storage and
cross-context globals before model code runs. A denylist misses whatever a
browser adds later. Keep the removals, and after them add an allowlist audit in
the same place `verifyLockdown` runs. It should enumerate every string and
symbol property on the Worker global, on each prototype up its chain, and on
`navigator` and its chain, then compare them with an explicit, grouped and
commented allowlist module. Unexpected names are removed by default, unless an
engine needs one. If a name can't be removed, fail closed. Log what was
removed. Get the lazy engines right empirically (SCAD + BOSL2 + text, BREP in
both forms + STEP, voxel, `api.text`, surface textures, the Assembly pool). Make
it work in the #1110 iframe-sandbox Worker too. Add a unit test for the pure
planner, an e2e test that checks the real Worker, and docs on how to add an
entry. Before making changes, run six specs on clean main with no retries and
report the one test that had failed earlier.

## Assistant

## Key decisions

**Baseline finding (not fixed here):** on clean main,
`surface-in-code › select scope takes a shared selector (part AND facing)`
fails. The #1109 main-thread validator (`checkSurfaceOp` in
`workerMessageValidation.ts`) accepts only the `label`/`point` scope kinds.
#1111 added `{ kind: 'select' }`, so the legitimate execute_result is rejected
as malformed and the Worker is recycled. I left it for the human to route, as
instructed.

**Default deny with an "inert" rule instead of listing neutralised names.** A
data property holding a primitive carries no capability. That covers the
names already pinned to `undefined`, and also the WebIDL constants
`TEMPORARY`/`PERSISTENT`. Those constants are non-configurable, so they can't
be deleted, and the first strict version of the audit failed every Worker
closed because of them. The rule also covers style-mod's `Symbol.for("ͼ")`
counter. Listing `fetch` and the other pinned names on the allowlist would
have weakened the audit, because the list would then also accept the live
capability. A unit test asserts that no denylisted name is allowlisted.

**Engine needs measured, not guessed.** For a temporary trace build, I
replaced each name the audit would remove with a logging getter. Then I drove
every engine path in both the direct Worker and the opaque-sandbox Worker, and
in a pool Worker. The only access was opentype.js's module-load
`typeof DecompressionStream` probe, which falls back to its built-in inflater.
So no engine needed a new allowlist entry. `Blob` (STEP import), `URL`,
`TextDecoder`, `performance`, `crypto` and timers are allowlisted on their own
merits.

**`crypto.subtle` kept.** It is pure computation on caller-supplied bytes.
With IndexedDB gone it has no key persistence, and it has no I/O.

**Logging via console.debug, not a new Worker→app message.** A new message
type would need its own branch in the main-thread message validator for a
diagnostic-only payload. The e2e test reads the debug line from the page's
console stream instead.

**The e2e test can't fail on removable new names.** Default deny removes
them, so the test asserts only that nothing non-allowlisted survives (that
catches undeletable additions, like the constants above). It also logs the
default-deny count. An engine that comes to need a removed name breaks in the
engine specs, and the docs say how to triage that.
