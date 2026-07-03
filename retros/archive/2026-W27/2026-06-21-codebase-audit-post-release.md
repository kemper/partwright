---
date: 2026-06-21
task: Post-release codebase audit (v1.0.0 → main + whole-codebase) — PR #824, tracking #825
---

## Liked
- **Fan-out of scoped read-only agents was the right shape for "audit everything."**
  13 agents, each with a tight file scope + a checklist of repo-specific traps
  (the 7-location schema rule, the get/put-await IDB trap, Three.js dispose, the
  Gemini schema subset), returned ranked `file:line` findings with proposed fixes.
  Frequency across independent agents acted as a confidence vote: `trimForShare`
  not stripping attachments was independently flagged by both the attachments
  agent and the AI-parity agent, which is what made it worth fixing now.
- Keeping the agents **read-only** and doing every edit myself avoided git
  single-writer contention while 13 ran concurrently. Findings in, edits serial.

## Lacked
- **No headless way to verify the Bambu printer-preset strings.** The single
  HIGH I couldn't fix is "are these 14 `process` strings real BBL presets?" —
  it needs the actual BambuStudio profile bundle or a slicer load. The 3MF retro
  (#681) already learned this lesson (validate against the real importer); the
  toolkit still doesn't have a checked-in BBL preset list to assert against, so
  speculative printers can ship broken. A `resources/bbl-presets.json` fixture +
  a unit assertion would close it.
- **No `gh` CLI and no `send_later` in this remote session**, so I could not arm
  an automated CI self-poll — a shell Monitor can't call the GitHub MCP. Watching
  a PR to green is therefore webhook-only (failures), and CI-*success* never wakes
  the session. A Monitor recipe that polls the local git http endpoint for the
  merge-base, or an MCP-callable poll, would make "watch until green" actually work.

## Learned
- The studio-lighting **doc inaccuracy had a clear root cause**: the changelog
  commit was authored against an earlier "off by default" design that a *later*
  commit reversed to "on." Writing release notes mid-stream rather than at the
  release cut is the structural cause — the same thing left 4 shipped features out
  of the 1.1 changelog entirely. Cutting the changelog as the last step before
  promotion (not when the first feature lands) would prevent both.

## Longed for
- A **capability registry** both the command palette and `window.partwright`
  derive from. The `buildCharacter` parity gap (UI button, no AI tool) is exactly
  the drift CLAUDE.md says a static lint can't catch — a registry would make it a
  type error instead of an audit finding.
