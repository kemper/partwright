---
session: "inverse-cad"
timestamp: "2026-07-03T15:15:00Z"
model: claude-fable-5
sequence: 10
---

## Human

(continuation — v2 framework build)

## Assistant

## Key decisions

**optimize.mjs — the agent decides structure, the machine tunes numbers.**
Nelder-Mead over the candidate's declared `api.params({...})` numeric knobs,
minimizing exact signed-distance RMS against the target, with jittered
restarts, per-param sensitivity (central differences at the optimum), and a
`structure-limited` verdict when nothing moves the objective — the signal
that tells an agent to stop tuning and restructure.

**Warm-engine session is the enabler**: added `createPreviewSession()` to
scripts/cli/preview.mjs (one Vite SSR server + engine module reused across
previews; `runPreview` now delegates to it). Measured: ~0.15s/eval vs ~2s
cold — 80 evals in 11.7s. Hard-errors when the candidate declares no
paramsSchema (the known silently-ignored `-p` trap).

**Two integration facts discovered** (recorded for the PLAYBOOK):
- `stats.paramsSchema` is an ARRAY of `{key, type, label, default, min,
  max}`, not an object keyed by name.
- Overrides bind per-key: `preview(code, { params: { socketR: 3.2 } })`.

Validation on the ankle: optimizing the socket sphere (r, cx, cy) around the
probe's RANSAC fit returned "already-optimal" (r 2.896→2.901, ΔRMS 0.0003)
with near-zero sensitivities — i.e. the probe measurement was already
exact, and the optimizer proves it instead of the agent guessing further.
