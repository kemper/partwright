# Agent tooling — custom subagents, static analysis, LSP

This repo configures the Claude Code harness for higher-quality automated work:
two custom subagents, a deterministic static-analysis layer they lean on, and a
TypeScript language-server MCP for symbol-aware discovery.

## Custom subagents (`.claude/agents/`)

Claude Code resolves a subagent's model in this precedence (highest first):
`CLAUDE_CODE_SUBAGENT_MODEL` env var → per-invocation `model` → the agent
file's `model:` frontmatter → inherit the main session. We rely on per-agent
frontmatter and deliberately do **not** set the global env var, so the
agents below can run on different model tiers.

| Agent | File | Model | Tools | Role |
|---|---|---|---|---|
| `work-reviewer` | `.claude/agents/work-reviewer.md` | `opus` | read-only (`Read, Grep, Glob, Bash`) | Reviews the branch diff vs `origin/main` for correctness, back-compat, security, **and** UI consistency. Never edits. |
| `explore` | `.claude/agents/explore.md` | `sonnet` | read-only + `mcp__typescript__*` | Codebase discovery / "where is X / who uses Y". Overrides the built-in Explore agent (which defaults to Haiku) with Sonnet + symbol-aware tools. |
| `voxel-sculpt` | `.claude/agents/voxel-sculpt.md` | `sonnet` | `Read, Write, Edit, Bash` | Iterates a voxel-language snippet (photo→figurine, catalog toy) through the headless `model:preview` render→look→adjust loop until it matches a target *and* passes the printability gates. Returns **text only**. |

All three are checked in, so every session and teammate gets the same behavior.
The `work-reviewer` runs the static-analysis scripts below as part of its review
and reasons about the hits against the diff.

> **Gotcha: a freshly-added agent file is not selectable in the session that
> created it.** Claude Code loads the agent registry at session start, so the
> Agent tool errors with "agent type not found" for a `.claude/agents/*.md` you
> just wrote — it becomes available next session. To smoke-test a new definition
> in-session, run its instructions through `general-purpose`: point that agent at
> the file and tell it to follow the instructions exactly.

> Why a `voxel-sculpt` agent? Sculpting a model to look like a photo is an
> iterative render→**look**→adjust loop, and every preview PNG the modeller
> Reads to judge a pass stays in context and is re-billed on every later turn of
> the *main* session. Delegating the loop moves those image tokens into the
> subagent's disposable context: it Reads the PNGs, judges them, and returns only
> a text verdict + the final file/preview paths. The main agent then decides
> whether to `SendUserFile` the preview (it can ship the PNG to the user
> *without* Reading it into its own context). Net effect: a many-pass visual
> iteration costs the main thread a few sentences instead of a stack of images.
> It runs on Sonnet so the cheap-to-judge geometry loop doesn't burn Opus tokens.

> Why override `explore`? The stock Explore agent runs on Haiku — fine for
> locating a string, weaker for this codebase's cross-file reference questions
> ("every reader of the `?notes` param", "does this export have importers").
> Sonnet + the TS LSP makes that discovery precise.

## Static analysis (`npm run lint:*`)

These are **advisory candidate-finders**, not a clean-code gate. The codebase
predates several conventions, so they intentionally over-report; treat each hit
as a lead, and scope it to the diff (a finding *introduced or worsened* by a
branch is in scope; a pre-existing one usually isn't).

| Script | Tool | Finds |
|---|---|---|
| `lint:consistency` | ast-grep (`sgconfig.yml`, `.ast-grep/rules/`) | UI-convention deviations: native dialogs vs `showToast`/modals, mouse-only drag vs Pointer Events. |
| `lint:deadcode` | knip (`knip.json`) | Exports with no importers, unused files/types (the CLAUDE.md dead-code rule, mechanized). |
| `lint:deps` | madge | Circular dependencies. |

### ast-grep severity → CI gating

`ast-grep scan` exits non-zero **only** on `error`-severity rules. Every rule
today is `warning`/`hint`, so `lint:consistency` is green now while still
printing candidates. The moment the codebase is brought into compliance for a
given rule, bump that rule to `severity: error` and it becomes a hard gate —
no workflow change needed.

### knip severity → CI gating

`knip.json` sets per-category `rules`. The **trustworthy categories gate**
(`error`): `dependencies`, `unlisted`, `unresolved`, `files`, `binaries` — these
reflect real import-graph facts. The **judgement categories stay advisory**
(`warn`): `exports`, `types`, `duplicates`, etc. Two reasons exports can't gate
yet: (1) knip can't see exports used **only** through the e2e suite's dynamic
`import('/src/…')` calls (it resolves the path via the `paths` map but can't
track which named exports a runtime namespace access uses — e.g. `resetClient`),
and (2) the standing dead-export backlog needs per-symbol triage (cruft vs.
unwired-but-intentional API). `tailwindcss` (used via `@tailwindcss/vite`) and
`replicad-opencascadejs` (dynamic sub-path `import()`) are in
`ignoreDependencies` — they're real, just invisible to static analysis.

### CI wiring (`.github/workflows/code-quality.yml`)

Runs on PRs into `main` (alongside `pr-checks.yml`, which owns build + unit +
e2e). `lint:consistency` (ast-grep) and `lint:deadcode` (knip) are **gates**;
`lint:deps` (madge) stays advisory (`|| echo ::warning::`) while the 17 known
circular deps are worked down. This job does **not** gate the `main → staging`
promotion.

## TypeScript LSP MCP (`.mcp.json`)

`.mcp.json` configures a `typescript` MCP server (`typescript-mcp`) that wraps
tsserver, giving agents find-references / go-to-definition / hover-types /
diagnostics over the real type graph instead of string search. The `explore`
agent allowlists `mcp__typescript__*` and prefers it for reference questions.

Caveats:
- **MCP servers load at session start.** Editing `.mcp.json` takes effect in a
  fresh session, not the current one.
- **Managed/remote environments** gate MCP servers by their own config and
  network policy; the server `npx`-installs `typescript-mcp` on first use, so
  it needs registry access. If the server isn't loaded, `explore` says so and
  falls back to ast-grep + grep.
- `typescript-mcp` is marked under active development upstream — pin/replace it
  if its API drifts.

## Backlog surfaced by these tools (worth a follow-up)

- **~43 unused exports + 4 unused types** (knip, advisory). These need
  per-symbol triage: most are cruft (query helpers, listener registrations,
  homonyms, dead types), but some look like unwired-but-intentional API
  (`viewport.dispose`, the `relief/filaments` CRUD, session draft management)
  whose removal is a maintainer call. Delete in reviewable batches; once a
  module is clean, the `exports` rule can graduate from `warn` to `error`.
- **17 circular dependencies** (madge, advisory), clustered `annotations/` ↔
  `color/`. Architectural; untangle opportunistically.

Already cleared: the native-dialog backlog (migrated to `showToast` +
`src/ui/dialogs.ts`; `no-native-dialogs` is now `severity: error`), and knip's
config false-positives (unresolved `/src` test imports, `tailwindcss` /
`replicad-opencascadejs` deps).
