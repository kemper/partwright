---
session: "01Po4u3H"
timestamp: "2026-10-28T02:15:00Z"
---

## Human

A model reviewing my contexts with the app found that the AI chat starts at
~100K tokens before I type anything, mostly from ai.md and the agent tooling.
I thought I'd already split it into a progressive-disclosure, skill-like
system. Research it and make a plan. Then: file the tracking issue, do Phase 0
and Phase 2, and update from the latest main since other work has merged.

## Assistant

## Key decisions

**Measured first.** On main the hosted turn-0 payload was ~111K tokens:
164 tool schemas ≈ 66K and preamble + ai.md ≈ 44K. The tools were the bigger
half, so Phase 2 (on-demand tool groups) is the largest single win. ai.md had
regrown past its pre-#355 size because nothing measured it. That made a
budget gate (Phase 0) part of the fix, not an extra. Tracking issue #1175.

**Groups decide what is SENT, not what may RUN.** `buildToolList` gating
stays the permission check (offeredTools = gated set), the same split
#1125 used for the Custom tier trim. A grouped tool the model calls without
loading still runs. That gives an auto-load fallback for free, and no gated
behaviour changes.

**Loaded groups are derived from the history, not stored.** loadTools calls,
readDoc topics (colors → paint, …) and any grouped tool call are read back
out of the transcript. Groups are sticky per chat with no schema/IndexedDB
change, survive reloads and the Worker hand-off, and reset after compaction.

**Cache stability.** Core tools are always first, in the same order, then
loadTools, then loaded groups appended in a fixed order. The loadTools
description is static (lists every group), so it caches with the tool
prefix. Each group load costs one prompt-cache miss. Stickiness keeps that
to a few per chat.

**Scope.** Hosted providers and Full-tier Custom only. Plan mode, Local and
the Custom Medium/Slim tiers already have their own trimmed lists. An
Advanced setting (`ai.onDemandToolGroups`, default on) sends every tool
again if a model struggles.

**Preloads.** An imported mesh preloads `import` + `parts`. Paint regions
deliberately don't preload `paint`: the core paintByLabel creates them, so
that would load the whole paint group on nearly every chat.

**Preamble fix.** It said a missing tool means "the user turned it off —
don't ask". With groups that is usually wrong, so it now points at the
tool-groups suffix line and loadTools first.

**Phase 0.** `tests/unit/aiContextBudget.test.ts` caps the system prompt,
turn-0 tools, the full tool list and per-tool schema size, with an allowlist
for today's three oversized tools. Ceilings ratchet down only.
`npm run ai:budget` prints the report. `toolGroups.test.ts` fails on a tool
that is in neither core nor exactly one group. The context meter now counts
the tool schemas actually sent for every non-Local provider (#1126).

Result: default turn-0 ≈ 62.5K tokens (from ~111K). Tools are 17.3K (from
66K). The rest is ai.md, which is Phase 1.
