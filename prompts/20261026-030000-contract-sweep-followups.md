---
session: "vibrant-heisenberg-56kfpk"
timestamp: "2026-10-26T03:00:00Z"
sequence: 3
tools: [playwright]
---

## Human

After the high-severity PR for the #1134 bug sweep: "but also fix the other in
a follow up PR" — the medium and low findings.

## Assistant

## Key decisions

**Stacked on the high-severity PR.** The session-open / session-list fixes
touch the same code, so this branch starts from it; it still targets `main` so
PR-checks run.

**Gemini-fillable schemas, not a provider special case.** Object params with no
`properties` (`paintInBox.box`, `normalCone`, `withinBox`, the `paintPreview`
selectors, `paintPattern.scope`) now spell their fields out via small shared
fragments (`boxSchema`, `normalConeSchema`). The two genuinely free-form maps
(`setParams.values`, `applySurfaceTexture.opts`) get a `<key>Json` string
fallback, the pattern openTool's `prefillJson` already uses. A unit test pins
"every object param declares its fields, or is an allow-listed free-form map
with a Json fallback". `assertPaint.expectedTriangleCount` was an untyped
number-or-object union (no union in the Gemini subset), so the tool splits it
into an integer count plus an `expectedTriangleRange` object and folds them
back into the API's shape; the API now also rejects a non-number,
non-object value instead of passing it.

**Digit strings resolve as ids/indices only after a name miss** — for object
targets and region refs, so an object literally named "2" still wins.

**`getObjectPartInfo` pieces are 0-based** like every piece-taking call; the
rail adds 1 only when displaying, matching its "Piece N" rows.

**One import path.** The Sessions modal's Import and `partwright.importSession`
now go through `importSessionPayload` (validation, newer-schema warning, full
version load, offscreen thumbnail backfill in each version's own engine)
instead of re-running every version in whatever engine was active.
`importSession` also had the same paint leak as `openSession` (it only set the
code). `importSessionData` now returns the newer-schema warning.

**The v.sdf budget reaches the Worker** through the execute message and an
`applyWorkerImportConfig` seed, mirroring `applyWorkerAiConfig`.

**The bake warning is emitted by the commit for transforms too**, and the
transform's own fallback reasons are merged with it rather than overwriting.

**Proof:** `tests/ai-contract-followups.spec.ts` — all 8 tests fail on the base
branch and pass here; unit gating/dispatch tests in `aiToolGating.test.ts`.
Merging objects' SCAD companions, off-editor bake params and the assembly
language fallback are one-line pairings with their already-correct twins,
covered by the existing e2e sets rather than new specs.
