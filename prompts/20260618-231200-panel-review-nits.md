---
session: "mfhutf"
timestamp: "2026-06-18T23:12:00Z"
model: claude-opus-4-8
---

## Human

(work-reviewer pass on PR #752 returned 0 blocking / 0 should-fix / 3 nits;
fold in the nits before marking the PR ready.)

## Assistant

## Key decisions

Applied all three review nits — cheap clarity wins, no behavior change to the
happy path:

1. **Apron error naming**: `buildApron` delegated key validation to `buildPanel`,
   so an unknown key on `apron(...)` threw an error named `panel(opts).<key>` —
   blaming a function the caller didn't invoke. Threaded an `opName` param through
   `buildPanel` (default `'panel'`) so the apron preset names itself in every
   validation message. Added a regression assertion (`buildApron({wobble})` throws
   `/apron/`).
2. **Documented `wrap`'s 1.15 default** in both the figure.md cheatsheet and the
   ClothingApi JSDoc (was only in code).
3. **Clarified apron accepts `side`** (and every other panel option) — the docs
   previously omitted it from apron's signature though the spread makes it work.
