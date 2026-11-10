---
session: "01U8g7w9"
timestamp: "2026-11-04T01:45:00Z"
sequence: 16
---

## Human

Can you refactor the existing tools to keep them in budget?

## Assistant

## Key decisions

**Measure duplication before trimming wording.** One sentence was most of
the problem. The optional `object` description is injected into every
object-targetable tool (91 of them) and was about 330 characters. That's
30K of the 260K full tool list. Shortening it to one line and saying the full
rule once, in ai.md's in-app tool note, freed 24K of the full list and 8K
of the first request. The system prompt grew by 285 characters. No tool lost
a parameter, and no guidance was removed.

**The paint tools' `withinPart` description** is now one shared, shorter
constant (10 copies).

**A guard keeps it from creeping back.** A budget test now fails when a
parameter description shared by 10 or more tools runs over 120 characters.

**The room went to the Realistic family in the chat tools** (#1170).
- `buildCharacter` takes a Realistic spec as a JSON string, `realisticJson`,
  instead of a second large object schema. The JSON string is cheap and
  works on every provider: Gemini only fills fields its schema declares.
- `listCharacterPresets` and `randomCharacter` take `family`.
- `getCharacterSpec` describes both headers.
- Reading the `human` doc loads the character tool group, as `figure` does.

**The ceilings stay as they are.** Lowering them would lock in the headroom,
but the headroom is there so features can land without another trim pass.
