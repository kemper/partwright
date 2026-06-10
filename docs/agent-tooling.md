# Agent tooling — custom subagents, static analysis, LSP

This repo configures the Claude Code harness for higher-quality automated work:
custom subagents, a deterministic static-analysis layer they lean on, and a
Serena (language-server) MCP for symbol-aware discovery.

## Custom subagents (`.claude/agents/`)

Claude Code resolves a subagent's model in this precedence (highest first):
`CLAUDE_CODE_SUBAGENT_MODEL` env var → per-invocation `model` → the agent
file's `model:` frontmatter → inherit the main session. We rely on per-agent
frontmatter and deliberately do **not** set the global env var, so the
agents below can run on different model tiers.

| Agent | File | Model | Tools | Role |
|---|---|---|---|---|
| `work-reviewer` | `.claude/agents/work-reviewer.md` | `opus` | read-only (`Read, Grep, Glob, Bash`) | Reviews the branch diff vs `origin/main` for correctness, back-compat, security, **and** UI consistency. Never edits. |
| `explore` | `.claude/agents/explore.md` | `sonnet` | read-only + `mcp__serena__*` | Codebase discovery / "where is X / who uses Y". Overrides the built-in Explore agent (which defaults to Haiku) with Sonnet + symbol-aware tools. |
| `model-sculpt` | `.claude/agents/model-sculpt.md` | `sonnet` | `Read, Write, Edit, Bash` | Iterates a model snippet (photo→figurine, catalog toy, mechanical part) through the headless `model:preview` render→look→adjust loop until it matches a target *and* passes the printability gates. Engine-aware: **manifold-js / voxel / scad** (not replicad — see below). Returns **text only**. Driven by the `/sculpt` skill. |
| `implementer` | `.claude/agents/implementer.md` | `sonnet` | `Read, Write, Edit, Bash, Grep, Glob` | Spec-driven implementation worker for parallelizable, well-bounded units (a new modifier/provider/export following an existing sibling). Runs build + unit + the targeted spec before reporting; asks the caller instead of guessing on ambiguity. Launch with `isolation: "worktree"` so parallel workers never share the checkout. |
| `test-triage` | `.claude/agents/test-triage.md` | `sonnet` | `Read, Bash, Grep, Glob` | Runs vitest / Playwright (targeted, shard, or full) in its own context and returns only a digest: failing test → root-cause hypothesis → `file:line`. Diagnoses, never fixes. The log firewall for the e2e suite. |

All five are checked in, so every session and teammate gets the same behavior.
The `work-reviewer` runs the static-analysis scripts below as part of its review
and reasons about the hits against the diff.

> **Gotcha: a freshly-added agent file is not selectable in the session that
> created it.** Claude Code loads the agent registry at session start, so the
> Agent tool errors with "agent type not found" for a `.claude/agents/*.md` you
> just wrote — it becomes available next session. To smoke-test a new definition
> in-session, run its instructions through `general-purpose`: point that agent at
> the file and tell it to follow the instructions exactly.

> Why a `model-sculpt` agent? Sculpting a model to look like a photo is an
> iterative render→**look**→adjust loop, and every preview PNG the modeller
> Reads to judge a pass stays in context and is re-billed on every later turn of
> the *main* session. Delegating the loop moves those image tokens into the
> subagent's disposable context: it Reads the PNGs, judges them, and returns only
> a text verdict + the final file/preview paths. The main agent then decides
> whether to `SendUserFile` the preview (it can ship the PNG to the user
> *without* Reading it into its own context). Net effect: a many-pass visual
> iteration costs the main thread a few sentences instead of a stack of images.
> It runs on Sonnet so the cheap-to-judge geometry loop doesn't burn Opus tokens.
>
> **Engine coverage mirrors the headless preview tier.** `model:preview` runs
> `manifold-js`, `voxel`, and `scad` in Node (no browser), so `model-sculpt`
> sculpts in any of those three — the only per-engine differences are the API
> idioms and the one-piece check (a `keepLargest()` weld for the voxel grid,
> `componentCount === 1` for the manifold-js / scad solids). **`replicad`/BREP is
> excluded**: its OpenCASCADE WASM won't init under Node SSR, so it can't preview
> headlessly and must be verified in the browser. The `/sculpt` skill
> (`.claude/skills/sculpt.md`) is the launcher — it picks the engine, briefs
> `model-sculpt`, and surfaces the preview via `SendUserFile` **without** the main
> agent Reading it, keeping the cost invariant intact.

> Why an `implementer` agent? Two reasons, both manager-model-independent.
> (1) **Parallelism**: when work fans out into independent units (the surface
> modifier family, the AI providers, the export formats), spec-and-delegate to
> concurrent workers in isolated worktrees beats implementing serially — the
> manager writes the specs, answers worker questions mid-task (`SendMessage`),
> and integrates. (2) **Conventions travel with the agent**: the definition
> bakes in the repo rules every worker must follow (UI↔API parity, appConfig
> constants, layering, verify-before-reporting, ask-don't-guess), so specs
> stay short. The `model: sonnet` frontmatter pins the worker tier regardless
> of what model drives the main session — there is no per-model selectability
> gate in Claude Code, and none is needed: the `description` states when
> delegation pays, and any manager tier reads it. Note recent Opus-tier models
> under-delegate by default, which is why the description carries explicit
> "use this when…" triggering language. Keep entangled cores (`src/main.ts`,
> `chatLoop.ts`, `engineWorker.ts`) and cross-worktree integration with the
> manager.
>
> Why a `test-triage` agent? Same cost shape as `model-sculpt`, but for logs
> instead of PNGs: a Playwright failure emits hundreds of lines that would
> otherwise sit in the main context and be re-billed every turn. The agent
> runs the suite, reads the noise in its own disposable context, and returns
> a digest (failing test → hypothesis → `file:line`, flake-vs-real verdict).
> It deliberately does not fix — the caller (or an `implementer`) applies
> fixes, keeping diagnosis and change authorship separable.

> Why override `explore`? The stock Explore agent runs on Haiku — fine for
> locating a string, weaker for this codebase's cross-file reference questions
> ("every reader of the `?notes` param", "does this export have importers").
> Sonnet + the LSP-backed Serena tools make that discovery precise.

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

## The search ladder — pick the right modality, not just grep

Code search for agents has three modalities, each answering a different
question. Use the cheapest rung that answers yours; escalate when the answer
needs more precision than the rung can give:

1. **Lexical — "where does this text appear?"** The built-in `Grep` tool
   (ripgrep) and `Glob`. Zero setup, always available. Right for literals,
   comments, error strings, and quick locating. Weakness: false positives from
   comments/strings, and a common name like `update` drowns in noise.
2. **Structural — "where does this code shape appear?"** ast-grep, already a
   devDependency (`@ast-grep/cli`, the binary behind `lint:consistency`). It
   matches parsed AST nodes, so formatting and comment/string collisions don't
   produce false hits:
   `npx ast-grep run -p 'showToast($$$)' -l ts src` — find every call shape;
   `npx ast-grep run -p 'new Worker($$$)' -l ts src` — regardless of spacing.
   Pattern syntax: `$X` one node, `$$$` any number. Right for call-site
   sweeps, convention checks, "find code shaped like this sibling".
3. **Symbol/graph — "who actually calls or uses this?"** The Serena MCP tools
   (below): `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`,
   `find_declaration`, `find_implementations`. Resolved references over the
   real type graph — no string-collision false positives at all, and compact
   symbol-chunk output instead of file dumps. Right for "every importer of X",
   rename-impact, "does this export have users" (cross-check with
   `lint:deadcode`).

The `explore` agent encodes this ladder; prefer delegating broad discovery to
it so the main context gets conclusions, not search output. We deliberately do
**not** run an embedding/vector code-search layer: the repo is single-language,
well-mapped by `CLAUDE.md`, and the leading agent stacks get better results
from the lexical/structural/graph trio than from semantic indexes at this
scale. Revisit if the codebase grows past what these answer in a few calls.

## Serena MCP — the symbol layer (`.mcp.json`)

`.mcp.json` configures [Serena](https://github.com/oraios/serena) (pinned to a
release tag), an MCP toolkit that wraps real language servers (tsserver for
this repo) and exposes symbol-level retrieval: `find_symbol`,
`find_referencing_symbols`, `get_symbols_overview`, `find_declaration`,
`find_implementations` (plus symbol-anchored editing and per-file
diagnostics). It runs entirely locally — no code leaves the machine. It replaced the earlier
`typescript-mcp` server (TS-only, unstable upstream API). The `explore` agent
allowlists `mcp__serena__*` and prefers it for reference questions;
`.claude/settings.json` pre-allows the read-only retrieval tools so they don't
prompt.

Caveats:
- **MCP servers load at session start.** Editing `.mcp.json` takes effect in a
  fresh session, not the current one.
- **Serena is Python, launched via `uvx`** — the machine needs
  [`uv`](https://docs.astral.sh/uv/) installed, and first run downloads Serena
  from GitHub plus the TypeScript language server. In managed/remote
  environments the setup script must install `uv` (and run `npm ci`), and the
  network policy must allow `github.com`, `pypi.org`/`files.pythonhosted.org`,
  `astral.sh`, and the npm registry. If the server isn't loaded, `explore`
  says so and falls back to ast-grep + Grep — the ladder degrades gracefully.
- **Pinned by tag** (`@vX.Y.Z` in `.mcp.json`). Bump deliberately; check the
  tool-name surface hasn't drifted before bumping, since the permission
  allowlist and agent docs name tools individually.

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
