# Retro: AI-driven Tsubasa paint trial → agent-tool fixes (#1052)

**Liked**
- Dogfooding the agent API with a subagent on the real 460k STL surfaced real bugs fast: probePixel on side views, paintStroke beading, an acceptParts race. No synthetic test had caught them.
- A CDP sampling profile with *inclusive* time per function found the actual cause of the 90 s freeze (refining twice: staged before the run, then again in rehydrate) in one run. Self-time alone pointed at leaf math.
- Parallel worktree agents (soccer pattern, colour chips) plus a work-reviewer pass. The reviewer caught a real regression in my own perf change (clamped field fooling the straight-edge skip).

**Lacked**
- No e2e covers "reopen a session with many smooth strokes", so load-time regressions are invisible until a user opens a heavy file.
- The subagent's spec files were deleted at the end. Recovering its final script from the JSONL transcript worked, but was fiddly.

**Learned**
- Any distance field that clamps for speed breaks magnitude-based heuristics downstream (linearity checks). Carry the bound on the region so consumers can tell.
- An async version of a sync path also needs its abort semantics designed: every `resetPaintWorkerState` caller becomes a canceller.

**Longed for**
- A `partwright profile-import <file>` CLI that reports main-thread stalls and the top inclusive functions.
- One branch per deliverable allowed by default in cloud sessions: two finished PRs had to queue behind one branch.
