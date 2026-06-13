---
date: "2026-06-10T16:35:00Z"
task: "fix: harden the api.paint/api.surface in-code direction (3 bugs + guardrails + doc sync, PR #569) after a 3-agent parallel audit of the paint/surface-as-code merge"
areas: [surface, paint, exports, geometry-api, docs, verification]
cost: medium
---

## Liked / Worked
- **Three parallel read-only audit agents (paint / surface / docs) before touching anything.** Each came back with file:line findings and an explicit "verified FINE" list — the FINE lists were as valuable as the bugs, because they let the fix PR stay small with confidence. The audits found 3 real bugs the original implementation sessions and reviews missed (stale exports, cache under-keying on imports, pill not cleared on the version-cache hit path).
- **Routing the export guard through the existing `ExportWarningInfo` modal** instead of a new gate: ~15 lines, consistent UI, and the console API stayed modal-free for agents by design.
- **The voxel engine's `SDF_BUILD_GUARD` Proxy pattern** was a ready-made idiom for the api.paint/api.surface "manifold-js only" guards — grep for prior art before inventing an error path.

## Lacked
- **`src/main.ts` contains NUL bytes inside template-literal hash separators**, which makes `grep`/`rg` treat the 14k-line core file as binary (silently truncated results). I lost a round discovering `surfaceBaseKey` used `\0` separators only via `cat -A`. Either a printable separator (`\x1f` is just as collision-safe but still trips binary detection — better: `'|'` + JSON-escaping) or a lint note in CLAUDE.md would stop the next agent from trusting truncated grep output.
- **`help()` has drifted ~70 methods behind `partwrightAPI`** (I synced only the surface/transform families). A 10-line script diffing API member names against help keys found it instantly — that check belongs in the unit tier so the parity rule is enforced, not aspirational.
- **No e2e-friendly way to raise the live-typing gate.** Testing the stale-export path required setCode + a real keyboard keystroke to trigger the debounced auto-run, plus knowing the `editorCollapsed` localStorage knob from another spec. A test hook (or documented helper) for "run without surface force-apply" would make sticky-state tests direct.

## Learned
- **`partMeshCache` entries are only ever written by forced runs**, so the version-switch cache-hit branch can assume textures are applied — that invariant is what made the one-line pill fix safe. Worth keeping true if phase 3 (persisting textures) changes the cache population.
- **Generated import-wrapper code is not identity** — it carries only filename + date, so any cache keyed on source text must fold in `getActiveImports()` ids.

## Longed for
- A **unit-tier parity test: every `partwrightAPI` member has a `help()` entry** (allowlist for private/test hooks). The audit found whole tool families (10 texture methods, 7 transforms) invisible to `help('...')` — exactly the drift the CLAUDE.md rule says must not happen, and trivially machine-checkable.
- A **catalog re-validation script** that re-runs entries headlessly and refreshes `geometryData` + `codeHash` together — 14 entries currently carry stale hashes that can't be safely fixed by recomputing the hash alone (the cached stats may be stale too).
