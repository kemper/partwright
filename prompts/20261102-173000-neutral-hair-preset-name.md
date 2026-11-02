---
session: "ad71db73"
timestamp: "2026-11-02T17:30:00Z"
---

## Human

Remove the third-party character name from the code: the captured hair preset
and the docs/tests were named after an anime character we don't own.

## Assistant

## Key decisions

**Rename, keep old figures working.** The preset becomes `shaggy` (file,
export, preset name, default, UI label, docs, AI tool text, tests, fixture
name). Every Character Creator figure stores its spec as JSON in its code
header, and the default spec carried the old preset name, so a plain rename
would make every saved figure's spec fail validation on re-open, and any
AI-written `preset: '<old>'` call would throw. One alias entry maps the former
name to `shaggy`, in a dependency-free leaf (`hairCapture/presetNames.ts`)
used by both `normalizeSpec` and `F.hair` — the only place the old name
remains. The unit test iterates the alias table, so it doesn't repeat it.

**Verified** headlessly: the old and new names build identical hair (same
triangle count, manifold); unit tier and `lint:deps` pass.
