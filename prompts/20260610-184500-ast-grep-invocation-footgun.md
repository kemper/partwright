---
session: "z3al0u5"
timestamp: "2026-06-10T18:45:00Z"
model: claude-opus-4-8
tools: [serena-mcp, ast-grep, explore]
---

## Human

Audited the search tooling (ast-grep / Serena / explore agent) against three
real questions, then asked: "Is there anything we need to improve or fix that
would make it all work better?" — followed by "Create a PR with your
recommended changes."

## Assistant

## Key decisions

**Root cause found during the audit.** Running the doc'd `npx ast-grep run …`
on a fresh remote container (which CLAUDE.md says starts with no
`node_modules`) does **not** use the pinned `@ast-grep/cli@0.43.0`. The bare
name `ast-grep` on npm is an unrelated squatted package (`ast-grep@0.1.0`);
`npx` happily downloads and runs it, producing a `SyntaxError` (or, worse,
plausible-but-wrong output) instead of a clear "not installed" error. This is a
correctness hazard for any agent following the docs literally before deps are
installed.

**Fix: an `ag` npm wrapper, not a doc-only caveat.** Added `"ag": "ast-grep"`
to `package.json` scripts so `npm run ag -- run -p '…'` always binds to the
pinned local binary via `node_modules/.bin`, removing the `npx` resolution
gamble entirely. Updated the search-ladder guidance in both `CLAUDE.md` and
`docs/agent-tooling.md` to invoke it that way and to state the `npm ci`
prerequisite (the same one Serena already needs).

**Second caveat: bare-identifier patterns silently miss method calls.** The
audit's `runAndSave($$$)` returned zero hits even though live call sites exist,
because ast-grep's identifier-callee pattern doesn't match member expressions
(`api.runAndSave(...)`). Documented the member form `$OBJ.method($$$)` and the
string-literal-arg variants so the next agent doesn't read a false zero as "no
call sites."

**Scope.** Docs + one npm script only — no source/TS touched, so no behavior
change to gate. Verified the wrapper for real: `npm ci`, then
`npm run ag -- --version` → `ast-grep 0.43.0` (the pinned binary), and
`npm run ag -- run -p '$OBJ.runAndSave($$$)'` returns the two true call sites.
