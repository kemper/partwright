---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T14:31:46Z"
tools: [subagent, git-worktree, vitest]
sequence: 1
---

## Human

Run the audit agent and fix what's missing. I definitely want core operations
available to the agents; not every UI action needs an AI tool, only the ones
that make sense.

## Assistant

## Key decisions

**The bug**: the parity audit (tracking issue #1085, Gap B0) found that
`evalAgainstImport` had a schema and a dispatch case but sat in no gating set.
`buildToolList` returns only tools that some gate enables, so the tool was never
offered — while the /reconstruct workflow tells the model to verify with it.

**Fix**: gate it ALWAYS + PLAN + RETRY. It is a pure read (chamfer/hausdorff
against the imported mesh), so it is safe in plan mode and safe to retry.

**Guard against a repeat**: rather than test the private gate sets, the new
unit test checks behaviour. With every toggle on, `buildToolList` must offer
every name in `ALL_TOOLS`; a tool in no gate fails it. To make that possible,
`ALL_TOOL_NAMES` is exported; the test is its importer. The same file also checks
four more things:
- names in the exported side sets (confirm / retry / object-targetable) exist,
  which catches typos;
- confirm-required tools are never auto-retried;
- tool schemas stay inside the Gemini-safe keyword subset;
- every tool reaches a dispatch case. This runs against a Proxy-stubbed
  `window.partwright` in Node, so no browser is needed.
