---
session: "aiK0c"
timestamp: "2026-06-12T00:47:00Z"
sequence: 7
---

## Human

(work-reviewer subagent output on the arrange-followups branch.) Two
IMPORTANT findings + a whitespace nit. Address the lot before pushing.

1. `scanPartsJs` greedy RHS pattern stops at the first `;` even inside a
   string literal — `const greeting = "hi;bye";` yields a truncated
   statement, and the header-only fallback's `name`-keyed dedupe lets the
   broken entry stick. Fix: make the header fallback REPLACE the broken
   entry, or drop the greedy path entirely.
2. UI ↔ JS-API parity miss: the panel's "Auto-combine new shapes"
   checkbox isn't on `window.partwright.*`. Add `setAutoCombine`/
   `getAutoCombine` or document the deliberate skip.
3. `partwright.enterArrange()` opens the panel as a side effect.
   Document it (or make it opt-in).
4. Help-table whitespace drift on canUndo/canRedo.

## Assistant

## Decisions

**Rewrote `scanPartsJs` head-only + skip-aware walker.** Instead of patching
the greedy regex, switched to a head-match (`^const name =`) plus a
`findStatementEnd` helper that walks forward from there tracking string,
template, line/block comment, and bracket-balance state. The walker can't
be confused by a `;` inside `"…"` / `'…'` / `` `…` `` or inside a `(…)` /
`[…]` / `{…}` because it only treats top-level (depth-0, outside-string-or-
comment) `;` as the terminator. Drops the prior "header-only fallback"
entirely — there's now a single, correct path.

Used a `byName` index Map instead of a `seen` Set so a future change that
wants to replace (not dedupe) earlier matches has a one-line edit; the
current semantics are still "first wins" / dedupe.

Regression tests: `const greeting = "hi;bye";` produces `statement.endsWith(';')`
and contains the full string literal; a multi-line `Manifold.cube(...).translate(...)`
captures the trailing `.translate` too.

**Auto-combine API: `setAutoCombine(on)` mirrors the checkbox both ways.**
Added a module-level `autoCombineCheckbox` ref so the API path can flip the
DOM toggle when called (otherwise a user who opens the panel after a
scripted `setAutoCombine(false)` would see the box still ticked but inserts
acting un-combined — a real "what is going on" UX trap). `assertBoolean`
validates the arg the same way the other viewport-control booleans do.

**Documented enterArrange's panel side effect, didn't make it opt-in.**
The panel needs to be visible for the chip strip / Undo / Size / Align to
mean anything to the user; making it opt-in would invite "the API moved a
shape but I have no UI to undo it" surprise paths. Added a `**Side
effect:**` block in the JSDoc and a paragraph in the `## Arrange mode`
section of `public/ai.md` so headless callers know what they're getting.

**Whitespace alignment.** Adjusted two `canUndo`/`canRedo` rows in
`help()` to match the surrounding pattern.

## Schema/back-compat (verified during the rewrite)

The new walker can return shorter statements than the prior pattern for one
edge case: a `const x = doSomething(); return …` on the same line would now
stop after `doSomething();` (correct), where the old greedy match would
ALSO have stopped there (matches). No consumer regression — `\.statement`
is only read by parseStatement (graceful null on mismatch) and as tooltip
text.

## Tests

- 2 new scanPartsJs cases (string-literal trap, multi-line).
- All 18 palette e2e + 161 codegen tests still green; typecheck + acyclic
  deps + lint:consistency / lint:deadcode (no new hits).

## Manual verification

Console smoke: `partwright.setAutoCombine(false); partwright.getAutoCombine()`
returns `false`, the panel checkbox unticks live, subsequent shape inserts
go in *without* a chained `.add(...)` join. `partwright.setAutoCombine(true)`
flips it back.
