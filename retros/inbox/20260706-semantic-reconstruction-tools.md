# 4-Ls — semantic reconstruction tools (PR #915)

- **Liked:** the headless→browser port pattern is now a well-worn groove —
  slice.mjs/voxelDiff.mjs ported with zero logic drift (reviewer confirmed
  line-by-line), and the deliberately-skipped-in-v1 fitters were exactly
  where we left them. Deferring them was the right scope call, and picking
  them up cost half a day.
- **Lacked:** a way to run the actual AI-driven /reconstruct loop end-to-end
  in verification (needs a provider key the session doesn't have) — the
  tools are e2e-tested individually but the full agent behavior shift is
  only validated by construction until the user tests it.
- **Learned:** two measured math traps worth remembering: any 4 points fit a
  circle exactly (DP'd squares masquerade as circles — gate primitive
  verdicts on point count, not residual alone), and chessboard DT
  under-reports a Euclidean disc radius ~30% (L∞ vs L2 — inscribed-circle
  problems need a real EDT). Both were caught by unit tests written BEFORE
  debugging, not after.
- **Longed for:** a "run this tool-call script against the app" harness —
  the e2e spec's page.evaluate blocks are hand-rolled mini-agents; a
  declarative fixture (call X, expect Y shape) would make measurement-tool
  coverage much cheaper to extend.
