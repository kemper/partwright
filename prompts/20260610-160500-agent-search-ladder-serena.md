---
session: "01UvAb"
timestamp: "2026-06-10T16:05:00Z"
---

## Human

I'd like to upgrade you and other agents' abilities to search without
literally using the basic grep command/tool. I've seen a lot of new libraries
recently that are better tools for AI agents than grep. Consider this space in
relation to this codebase, recommend tools, and make a PR with the changes.
Also tell me what to add to the remote-environment setup script.

## Assistant

Surveyed the 2025–26 agent-search space and applied the "three modalities"
framing (lexical / structural / symbol-graph) rather than picking one
grep-killer, because the repo already had partial coverage of all three.

Key decisions and why:

- **Replaced `typescript-mcp` with Serena MCP** (`.mcp.json`). Our own
  agent-tooling doc already flagged typescript-mcp as unstable upstream.
  Serena is the mature LSP toolkit for agents (find_symbol /
  find_referencing_symbols / get_symbols_overview), runs fully locally, and
  returns compact symbol chunks instead of file dumps. Pinned to `v1.5.3` by
  git tag per the repo's own pin-or-replace guidance. Launched with
  `--context ide-assistant` so it doesn't duplicate Claude Code's file tools.
- **Promoted ast-grep from lint-only to a search tool.** `@ast-grep/cli` was
  already a devDependency (lint:consistency); the change is guidance
  (CLAUDE.md search-ladder section, docs/agent-tooling.md, explore agent) plus
  settings permissions so `npx ast-grep …` doesn't prompt.
- **Deliberately skipped embedding/vector search** (mgrep, Semble, ColGrep):
  mgrep's index is cloud-backed (code leaves the environment), the local ones
  are immature, and at this repo's scale the lexical/structural/graph trio
  answers conceptual queries via CLAUDE.md + the explore agent. Documented the
  skip and the revisit condition so the decision is visible.
- **Tool names verified against the live server, not docs.** The
  ide-assistant context exposes find_declaration / find_implementations /
  get_diagnostics_for_file but NOT search_for_pattern; the settings allowlist
  and docs name tools individually, so they were corrected to the actual
  surface after the server connected.
- Smoke-tested both new rungs in-session: Serena resolved `applyVoxelize` and
  its single true call site (src/main.ts:7610) with zero false positives;
  `npx ast-grep run -p 'showToast($$$)'` found call shapes in src/main.ts.
- Remote-env requirements (uv install, network-policy domains, `npm ci`)
  documented in docs/agent-tooling.md; the environment setup-script snippet
  was delivered in chat since that config lives outside the repo.
