---
date: "2026-10-24T19:00:00Z"
task: "feat: AI can drive Partwright — parity audit + six-PR series (#1086 #1087 #1088 #1089 #1094 #1098)"
pr: 1098
areas: [agents, git-workflow, pr-flow, ai-panel, tooling]
cost: high
---

## Liked / Worked
- **Audit → split → parallel worktree agents.** One read-only audit agent produced a gap list and PR split. Four, then two, implementer agents each worked in its own worktree on its own `E2E_PORT`. This got six reviewed PRs through in one session.
- **A `work-reviewer` pass after every agent round caught real bugs every time.** Examples:
  - an AI-opened export dialog downloaded on a stray Enter;
  - a customize prefill bypassed the runCode scope;
  - "https-only" image fetches could redirect to localhost;
  - the AI's URL import ran remote model code;
  - undo-clear restored another object's paint.

  The agents' own self-checks missed all of these. A second re-review of each *fix* commit still found more, e.g. a known secret nested in another leaked its tail.
- **The invariant unit tests paid for themselves.** `aiToolGating.test.ts` (every tool gated and dispatched) caught a dropped `ALL_TOOL_NAMES` line in a hand-resolved merge. `appConfigApi.test.ts` (bounds table vs modal) caught `main`'s new settings fields after a merge.
- **`git rerere` plus a pre-built integration branch** (main + PR1–4 merged, conflicts resolved once) made rebasing the stacked PR5/PR6 mostly automatic.

## Lacked
- **Merge order matters for stacked PRs and nothing says so.** Merging PR1 into the PR5 branch first put all of PR3's content on "our" side against `main`, giving 16 conflicts. Aborting and merging PR3 (the branch with the biggest overlap with `main`) first dropped it to 8. (~6 turns)
- **gitleaks scans full history.** Fake API keys in a redaction test failed CI, and the fix meant rewriting the branch. The CLAUDE.md test guidance should say "build key-shaped fixtures at runtime". (~5 turns)
- **No local gitleaks.** Downloading the pinned binary was blocked by the sandbox classifier, so the fix was verified only by CI.
- **Hand-resolving conflicts in `src/main.ts`** needs Python byte slicing (NUL bytes). I wrote ad-hoc resolvers (`resolve.py`, an import-union script) four times.

## Learned
- **Throw → `{error}` silently breaks callers.** Converting API methods from throwing to returning `{error}` broke callers that only check `status === 'error'`: the CLI's `iterate`/`render` and the catalog scripts. It also made the in-app AI see failures as successes, because `executeTool` set `isError: false`. Any such conversion needs a grep of `scripts/` and `bin/`, and an `isError` mapping.
- **The agent Worker can't see main-thread registries.** `buildToolList` runs inside it, so anything dynamic (the openTool id enum) must be snapshotted on the main thread and passed in the `run_turn` message.
- **Squash vs merge commits:** #1094 contained #1086–#1089 as merge commits, so merging it first landed all five at once.

## Longed for
- **`npm run pr:stack-sync`:** given a list of stacked branches, merge `main` into each in dependency order with rerere on, run typecheck + unit tests after each, and stop at the first real conflict. I did this by hand four times.
- **`scripts/resolve-gates.mjs`:** a structural merge for the `tools.ts` gate `Set([...])` literals (union the names). Nearly every conflict in this series was two branches appending to the same Set literal.
- **A checked-in conflict helper for `src/main.ts`** that understands its NUL bytes: list hunks, take ours/theirs per hunk, union import lines.
- **CLAUDE.md:** a "test fixtures must not contain key-shaped literals (gitleaks scans history)" line under Tests.
