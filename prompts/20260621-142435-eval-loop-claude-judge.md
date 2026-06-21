---
session: "busycray"
timestamp: "2026-06-21T14:24:35Z"
model: claude-opus-4-8
sequence: 3
---

## Human

For now let's just use a claude model as the judge; I want to be able to run and
test in the container.

## Assistant

## Key decisions

**Added a `claude` judge that runs in-container, made it the default.** The
`claude` CLI is present in the Claude Code container (`/opt/node22/bin/claude`,
authed via the Max OAuth), so the judge shells to `claude -p --output-format
json --model <id>` and parses the envelope's `.result` (our strict judge JSON)
plus `.total_cost_usd` / `.usage` for the spend tally. Two gotchas handled:
- Run from `tmpdir()`, NOT the repo cwd — otherwise the project's own Stop hook
  intercepts and replaces the model's answer (observed the reconcile-nudge text
  coming back instead of JSON).
- Attach the contact sheet via the `@<abs-path>` mention so it's inlined into
  context with no Read-tool permission prompt.

Verified live: scored the shoulders case 72–74/100 with genuinely actionable
part-level critique (deltoid too cylindrical → inflate ~10–15% lateral;
trapezius angular kink → add loops, relax to a curve; clavicle absent/"doll-like"
→ low-amp bevel sternal-notch→acromion). ~$0.06/call equivalent (billed against
Max). This is the quality moat working.

**Two real bugs the live run exposed, both fixed:**
1. **Baselines must be per-judge.** The first claude run flagged a false
   regression (72 < 100) because the baseline was set by the *pixel* judge —
   apples-to-oranges. `baseline.json` is now keyed `cases[name][judge]`, and the
   regression gate only compares like-with-like.
2. **LLM judge is noisy** (72→74 between identical runs). Added `--tolerance N`
   so a regression only fires at `score < baseline - tol`; the deterministic
   pixel judge stays at tol 0. Validated the band for free with the pixel judge
   (98 vs 100: tol 5 passes / exit 0, tol 0 regresses / exit 1).

`gemini` kept as an alternate (separate-quota) judge; `pixel`/`human` unchanged.
`execFileSync` stays injection-safe (args array, no shell).
