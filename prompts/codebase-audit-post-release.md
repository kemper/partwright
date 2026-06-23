---
date: 2026-06-21
branch: claude/codebase-audit-post-release-lr28ye
files_changed:
  - src/ai/agentWorker.ts
  - src/ai/openai.ts
  - src/color/imagePaint.ts
  - src/color/imagePaintUI.ts
  - src/content/data/help.ts
  - src/content/data/whatsNew.ts
  - src/export/threemfProject.ts
  - src/geometry/engine.ts
  - src/geometry/engineWorker.ts
  - src/geometry/engines/manifoldJs.ts
  - src/geometry/sdf.ts
  - src/main.ts
  - src/relief/reliefSettings.ts
  - src/renderer/viewport.ts
  - src/share/shareLink.ts
  - src/surface/surfaceOps.ts
  - src/ui/aiDiagnosticsModal.tsx
  - src/ui/characterCreatorPanel.ts
  - src/ui/sessionList.ts
  - src/ui/versionTile.ts
  - tests/unit/sdf.test.ts
  - tests/unit/shareLink.test.ts
---

## Human

"I released a lot of features recently … since the last big production release …
I wanna do a really in-depth investigation into the codebase in relation to all
the recent work … see if there's any bugs or missed work or inaccuracies … Use
up to ten sub agents … and investigate. And then if you can find concrete fixes,
please fix them." Follow-up: "don't purely constrain yourself to recent changes.
I want to find defects anywhere in the code base."

## Assistant

Scoped the audit to v1.0.0 (`4cf3caed`) → `origin/main` (115 commits, 51 feat/fix,
~17.6k insertions) then, per the follow-up, widened to a whole-codebase defect
hunt. Fanned out 13 read-only investigation agents (8 release-themed: attachments/
schema, publish+Bambu, figures/Character Creator, studio viewport, paint/palette,
api.sdf.tube, AI tools/parity/units, cross-cutting; 5 whole-codebase: geometry
workers, IndexedDB, AI providers, renderer lifecycle, import/export+security). Each
returned ranked findings with file:line; I applied the high-confidence, low-risk
ones and verified with typecheck + unit + targeted e2e.

Fixes applied (why, not what):

- **Silent UI hangs.** The geometry Worker forwards escaped WASM panics as a
  `callId:null` error that the main thread's handler dropped on the floor — the
  no-timeout render promise then hung forever. Added the `else` branch to recycle
  the Worker (`engine.ts`). The surface Worker's `onerror` left the *dead* Worker
  installed, so the next compute posted into the void and hung; now it
  terminates+nulls so the next compute respawns (`surfaceOps.ts`).
- **AI correctness.** A stale `workerQueuedBlocks` buffer delivered a queued
  user follow-up twice when a turn ended without a tool round; cleared it at
  `run_turn` start (`agentWorker.ts`). OpenAI-compatible servers that close the
  stream with no `finish_reason` left `stopReason:'unknown'` → a confusing
  "other" outcome; default streamed-text-then-EOF to `end_turn` (`openai.ts`).
  Diagnostics list keyed on `id` to avoid same-ms row collisions.
- **Cross-tab data loss (whole-codebase).** Relief settings packed every
  session into one shared localStorage map written read-modify-write — two tabs
  on different sessions clobbered each other. Split into per-session keys
  (disjoint writes) with a read-only fallback to the legacy map (`reliefSettings.ts`).
- **Doc inaccuracy (the user's explicit concern).** The 1.1 changelog/help said
  studio lighting was "off by default"; it ships ON. Corrected both, and added
  the changelog bullets that shipped but were missing (14-printer Bambu picker,
  paintImage, mm default, mobile Parts pane).
- **API validation gap (UI↔API parity).** The Bambu 3MF export API interpolated
  a raw `nozzle` string into the profile and silently defaulted unknown
  printer/filament ids — the modal's dropdowns enforce a fixed set but console/AI
  callers didn't. Added boundary validation + `isBambu*` predicates.
- **Geometry.** `api.sdf.tube` grooves could carve clean through the centerline
  (split/non-manifold) for `depth > radius`; clamped to ≤90% of the local tapered
  radius (`sdf.ts`) + regression tests for that and the integer-count seam.
- **Resource lifecycle.** Disposed the leaked `RoomEnvironment` after the PMREM
  bake (`viewport.ts`); revoked blob URLs on the image-load *error* path in three
  places (`imagePaint.ts`, `imagePaintUI.ts`, `versionTile.ts`, `sessionList.ts`).
- **Concurrency.** Memoized `manifoldJsEngine.init()` so two concurrent
  first-callers share one WASM instantiation instead of double-building every
  namespace singleton (`manifoldJs.ts`).
- **Share bloat / privacy.** `trimForShare` left full attachment data-URL
  payloads (now incl. STL/STEP/PDF) in the share URL, blowing the decode cap;
  strip `data:` payloads, keep metadata + http refs (`shareLink.ts`).
- **UI consistency.** Migrated the Character Creator's native `<input type=color>`
  rows to the shared palette modal swatch (`characterCreatorPanel.ts`).

Deferred to GitHub issues (need external verification, are architectural, or are
policy calls): unverifiable speculative Bambu printer presets (rc -17 risk),
replicad `lastShape` interleave race, Anthropic-vs-others abort-usage billing
inconsistency, the `buildCharacter` AI-tool parity gap, and a handful of LOW
latent items.
