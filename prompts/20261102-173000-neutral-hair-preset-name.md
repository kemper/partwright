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

## Human

Yes to all three: push the branch, scrub the prompt/retro logs, and treat the
creature example (a band's character) the same way. I'll rewrite the whole git
history later, after landing the open branches.

## Assistant

- **Creature example**: renamed to `examples/creature_horned.js`,
  with the creature guide's worked-example heading and the code/test comments
  made generic. It isn't in the catalog, so nothing else references it.
- **Logs**: 28 prompt/retro files reworded ("the figurine", "the soccer figure",
  "the creature") and the 5 whose file names carried a character name renamed;
  references to the old file names updated. The two logs about the owner's own
  deck-shield project are left as they are (their own design, not a third-party
  name).
- PR/issue text on GitHub was scrubbed the same way, outside git.

**`main` was over the AI context budget** (system prompt +50 chars, tool
schemas +356) after kemper/partwright#1198, which turns every PR's unit tier
red. Fixed by trimming, not by raising the ceilings: the zoom options'
descriptions repeat across four tool schemas, so shortening them recovers the
schema budget; the `ai.md` renderView line drops default values that the
visual-verification subdoc documents (the reference-ghost default moved there).
