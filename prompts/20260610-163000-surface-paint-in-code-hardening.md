---
session: "6sobw6"
timestamp: "2026-06-10T16:30:00Z"
tools: [subagent, playwright, vitest]
---

## Human

Asked for a review of the new "embed paint and surface operations in code"
direction (`api.paint.*` / `api.surface.*`): incomplete operations, gaps from
concurrent merges, cleanup or follow-up needed. Then: fix the bugs and add the
cheap guardrails as one PR, and fold in the cleanup / doc sync. (Phases 3 and 4
— persisting computed textures on the version, and the Surface panel emitting
code — are handed to a separate session.)

## Assistant

## Key decisions

**Review first, by three parallel read-only audits** (paint integration,
surface integration, docs/tests/cleanup), then one PR scoped to the three real
bugs plus the cheap guardrails the audits surfaced. Everything architectural
(phases 3/4, Tier-B paint kinds, the wider help() backlog) was deliberately
left out.

**Bug — memo cache under-keying.** `surfaceBaseKey` hashed only code + params,
but the generated import wrapper carries only filename + date, so two different
meshes imported the same day yield byte-identical source — the cache would
serve the previous mesh's textured result. Folded the active imports' identity
(`id/numVert/numTri`, ids unique per import event) into the key rather than
hashing mesh bytes: cheap, and the cache is in-memory so cross-reload stability
of the key doesn't matter.

**Bug — stale Re-apply pill across version switches.** The pill is only
cleared inside `applySurfaceTextures`, which the `loadVersionIntoEditor`
cache-hit branch never reaches. Cleared it explicitly in that branch; correct
because `partMeshCache` entries are only written by forced runs, so a restored
mesh is always textured.

**Bug — silent untextured exports.** While the pill is up every export reads
the base mesh. Routed the fix through the *existing* pre-export warning system
rather than inventing a new gate: a `surfaceStale` flag on `ExportWarningInfo`
(UI exports get the confirm modal) and a non-blocking toast + `warning` field
on the console `export*` / `export*Data` API (which must stay modal-free for
agents — `run`/`runAndSave` force-apply, so agent flows only hit this if a
human live-typed in between).

**Guardrails.** `api.paint`/`api.surface` in voxel and replicad sessions now
throw a pointed "manifold-js only" error (Proxy guards, same pattern as the
voxel engine's SDF_BUILD_GUARD) instead of `undefined` TypeErrors.
`replaceColor` returns a `hint` when nothing matched but code-declared colors
exist — it deliberately does *not* mutate them (the code is the source of
truth), the hint just says where to edit.

**Doc sync.** CLAUDE.md surface bullet updated (voronoi/voronoiLamp, the
surfaceOps/surfaceOpSpec in-code path, append-only nature of the option
allow-lists once user code persists them); help() gained the surface-texture
and transform families (the wider ~70-method help() drift is reported as
backlog, not fixed here); colors.md/textures.md document the read-only nature
of code-declared colors, the patch/region exclusion, and the stale-export
warning. The comment claiming a `partwright.applySurfaceTextures()` method
exists was corrected instead of adding the method — `run()` already
force-applies, so a twin would be redundant surface area.

**Not done on purpose:** the 14 stale catalog `codeHash` values (blind
recompute would bless possibly-stale stats — needs per-entry re-run, separate
task) and `scripts/convert-catalog-paint.mjs` retention (left in tree,
dry-run by default).

**Verification.** New e2e: stale-export warning round-trip (pill → warning →
run clears both), replaceColor hint, voxel namespace guards. Build, unit tier
(993), targeted Playwright specs green; export-modal screenshot posted in chat.
