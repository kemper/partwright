---
session: "busycray"
timestamp: "2026-06-21T14:14:37Z"
model: claude-opus-4-8
tools: [work-reviewer]
sequence: 2
---

## Human

(Automated PR-activity follow-up.) A work-reviewer pass over the eval:figures
branch diff surfaced one blocker, three should-fixes, and two nits. Address the
confident, small ones.

## Assistant

## Key decisions

Applied the reviewer findings to `scripts/eval-figures.mjs`, `scripts/cli/judge.mjs`,
and the corpus README:

- **Blocker — viewless case crash.** `resolveViews` returns `views: null` when a
  case omits `views`; `null` defeats `composePng`'s `= DEFAULT_VIEWS` default
  (only `undefined` triggers it) → `null.map` TypeError on `--all` over any
  future viewless case. Pass `c.views ?? undefined` at the call site so the
  default applies.
- **Should-fix — `--budget NaN` silently uncapped.** A non-finite `--budget`
  made the cap check always false (uncapped judging, the opposite of "spend is
  visible"). Now validated at parse time → exits 2 with a clear message.
- **Should-fix — dead `--record` flag.** Parsed but read nowhere; the human judge
  already reads a filled verdict on the next run regardless. Dropped the flag and
  the "re-run with --record" wording from the template + README rather than imply
  behavior that didn't exist.
- **Should-fix — Gemini image not actually attached.** The contact sheet was
  appended to the prompt as prose ("Image: <path>"), which a vision judge won't
  load. Switched to the Gemini CLI `@<path>` file-injection syntax so the image
  enters the vision context.
- **Nits.** `--set-reference`/`--set-baseline` pin operations no longer fold the
  build's gate state into the process exit code; `contactSheet` heights fall back
  to the tile width if `sharp` metadata is missing.

Re-verified: clean run 100/100 exit 0; `--budget abc` exits 2; `--set-reference`
exits 0. `execFileSync` confirmed injection-safe (args array, no shell).
reference.png unchanged (deterministic render).
