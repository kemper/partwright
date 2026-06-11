---
session: "01VMh3m9Tu7EUiEYp8vDCBYn"
timestamp: "2026-06-11T00:00:00Z"
---

## Human

Run the weekly retro-review: process all entries in `retros/inbox/`, cluster by
theme with cross-agent frequency as the vote, apply confident process diffs to
`CLAUDE.md` / `docs/` / `.claude/skills/`, write a durable report to
`retros/reports/2026-W25.md`, archive the inbox to `retros/archive/2026-W25/`,
and open a draft PR.

## Assistant

## Key decisions

**10 entries, 10 sessions, date span June 9–11.** W24 already had a report
(June 5–7 entries), so this batch becomes W25. All 10 entries were moved to
`retros/archive/2026-W25/`.

**Applied 5 CLAUDE.md changes, all from multi-agent or high-signal findings:**

1. **Sandbox `api.*` namespace discoverability** (2 agents: fasteners-joints,
   surface-paint-hardening) — added a directive to search `public/ai.md` for
   existing namespaces before designing new ones, with a list of key ones.
   Root cause: `api.printFit` already existed when an agent designed a new
   fasteners namespace from scratch.

2. **`build-catalog-entry.cjs` xvfb requirement** (2 agents: figure-face-quality,
   fasteners-joints) — added a note that the script requires `xvfb-run -a` in
   this container (headed Chromium, no X display); `catalog-regen.cjs` doesn't
   need this.

3. **UI label rename breaks e2e selectors** (1 agent, 2 CI rounds wasted) —
   added a grep-tests-first directive to the E2E tier section. Clear pattern:
   text-matched selectors break on label renames unless caught before pushing.

4. **Conflicted PR silently drops `pull_request`-event CI** (1 agent) —
   added to "After Opening a PR" step 1: `git merge-tree` diagnoses this
   in seconds; the asymmetry (pr-checks stops, CodeQL keeps running) is the
   signature.

5. **`src/main.ts` NUL bytes in cache-key separators** (1 agent) — added a
   warning to the search ladder. `rg`/`grep` silently treats the file as
   binary; `--text` / `-a` or Serena `find_symbol` are the workarounds.

**Filed 12 backlog items** covering: help() parity test, api.* namespace index,
schema-bump skill, build-catalog-entry.cjs headless fix, model:preview SDF
label stats, --max-genus/--require-labels bake gates, v.solidifyDiagonals(),
NUL separator fix, dbSaveVersion options-object refactor, button-label lint,
pose-recipe regression suite, and the ai.md azimuth line.

**Kept as one-offs:** send_later unavailability (platform limit, CLAUDE.md
already says "if available"), catalog palette survival (.plans gitignored),
CodeQL JSON.stringify advice (one mention, low frequency), FK ARM hinge
instability (acknowledged in session notes, not a process gap).
