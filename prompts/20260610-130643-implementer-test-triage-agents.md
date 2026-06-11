---
session: "9182pf"
timestamp: "2026-06-10T13:06:43Z"
tools: [agent-definitions]
---

## Human

Discussion about how to best structure agent usage in this repo: should the
main (expensive, top-tier) session drive subagents as workers? Should
manager/worker profiles be added to `.claude/agents/`? The user specifically
valued (a) parallelizing implementation by handing Sonnet a spec, and (b) the
mid-task communication channel (workers can ask the manager questions via
SendMessage). Follow-up: if the primary manager model is later scaled back to
Opus, would the implementer still work — and is there a way to gate an agent
to "only when driven by a top-tier model"?

## Assistant

## Key decisions

**No manager profile, no model gate.** Agent definitions only configure
subagents; the main session is inherently the manager and its model comes from
session settings. Claude Code has no per-model selectability switch in agent
frontmatter, and a `PreToolUse` hook gate would be brittle for no real benefit
— the delegation economics (parallelism + context firewall) hold under any
manager tier. The `description` field is the right lever: it states when
delegation pays, and any manager reads it. Added explicit "use this when…"
triggering language because recent Opus-tier models under-delegate by default.

**Added `implementer` (Sonnet) rather than relying on `general-purpose` +
per-invocation model override.** The override covers tiering, but a checked-in
definition bakes in the repo conventions every worker must follow (UI↔API
parity, appConfig constants, module layering, verify-before-reporting), so
specs stay short and consistent across sessions. The definition tells workers
to ask the caller on ambiguity — making asking the expected behavior is what
activates the mid-task SendMessage channel. Scoped it away from entangled core
files and from git mutations on the shared checkout (worktree isolation is the
recommended launch mode), because git is single-writer.

**Added `test-triage` (Sonnet) as a log firewall.** Same cost rationale as the
existing `model-sculpt` agent but for Playwright/vitest output instead of
preview PNGs: failures emit hundreds of lines that would otherwise be re-billed
in the main context every turn. It diagnoses (failing test → hypothesis →
file:line, flake-vs-real) but deliberately never fixes, keeping diagnosis and
change authorship separable. Encoded the known flake signature (30 s WASM-boot
timeouts) and the workers=1 invariant so workers don't "fix" flakes by raising
parallelism.

**Verification scope**: markdown-only change (agent definitions + docs +
this log) — no build/test impact; CI validates on the draft PR. Per the
documented registry-load gotcha, the new agents become selectable next
session; smoke-testing in-session goes through `general-purpose`.
