---
date: "2026-06-10T16:25:00Z"
task: "chore: replace typescript-mcp with Serena MCP, promote ast-grep to a search tool, encode the Grep→ast-grep→Serena search ladder (PR #571)"
areas: [tooling, agents, docs, mcp]
cost: low
---

Research-then-implement task: surveyed the agent code-search space, recommended
the three-modality ladder (lexical / structural / symbol-graph), then shipped
the config + docs changes.

## Liked / Worked
- **The remote harness hot-loaded the edited `.mcp.json`** — the Serena server
  connected mid-session, which let me verify the *actual* tool surface and
  smoke-test `find_symbol` / `find_referencing_symbols` against the repo
  before pushing. Zero-false-positive reference results on `applyVoxelize`
  validated the whole premise in two calls.
- The repo's own `docs/agent-tooling.md` had already flagged `typescript-mcp`
  as "pin/replace if it drifts" — prior documented misgivings made the
  replacement decision easy and defensible.

## Learned
- **Serena's `ide-assistant` context does NOT expose `search_for_pattern`**
  (or `list_dir`/`find_file`); it does expose `find_declaration`,
  `find_implementations`, `get_diagnostics_for_file`. Upstream docs/blog
  posts list the full tool set — always verify tool names against the live
  server before writing per-tool permission allowlists.
- Serena drops a `.serena/` project-metadata dir in the repo root on first
  connect — needs gitignoring (done in PR #571).
- `uv`/`uvx` is preinstalled in the remote container image at
  `/root/.local/bin`, so Serena worked without a setup-script change here;
  the setup-script additions are pre-warm + network-policy belt-and-braces.

## Lacked
- No deterministic check that the per-tool names in `.claude/settings.json`
  `permissions.allow` match what the pinned Serena version actually serves —
  a tag bump could silently orphan the allowlist. A tiny CI probe (or a note
  in the bump procedure, which I added to the docs) covers it for now.

## Longed for
- A `send_later`-style scheduler in this session to self-check the PR; not
  available, so PR #571 babysitting rests on webhook events only.
