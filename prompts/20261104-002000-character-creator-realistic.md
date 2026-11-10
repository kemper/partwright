---
session: "01U8g7w9"
timestamp: "2026-11-04T00:20:00Z"
sequence: 15
---

## Human

Keep both character builders, letting people choose a top-level style: the
human-based one, or the SDF one (more like Miis or VR avatars). Later: "Wait,
isn't the character generator supposed to support human?"

## Assistant

## Key decisions

**Two families, one panel.** The Character Creator gets a Type switch at the
top: Realistic (`api.human`) or Avatar (`api.sdf.figure`). The Avatar spec and
its schema-driven controls stay as they were. Realistic gets its own spec
(`src/human/humanCharacter.ts`), presets, random roll and hand-written
controls, because `api.human`'s options don't fit the Avatar field schema.

**Switching keeps what both share.** Each family keeps its own spec. A switch
copies the shared settings across (body, age, style, expression, hair style,
clothes, colours) and leaves the rest alone, so going back and forth doesn't
lose a knight's armor or an Avatar's bead eyes.

**The header picks the family on reopen.** Realistic code carries
`// @human-character v1 {json}`, which the Avatar `// @character vN` pattern
never matches. A fresh panel opens on the family last used on this device
(Realistic the first time).

**Console API: Avatar stays the default.** `buildCharacter` builds a Realistic
character only when `spec.family` is `'realistic'`.
`listCharacterPresets(family?)` and `randomCharacter({ family })` follow the
same rule, so existing scripts and prompts behave as before. The in-app AI
tool schemas are unchanged: their full-list budget has under 30 characters of
room (#1234). The AI reaches the Realistic spec through `human.md`.

**Preset cards use colour silhouettes for now.** Baked thumbnails overlap with
catalog work, which the owner reviews first.

**Only the active family's controls exist.** Hidden duplicates ("Hair",
"Fringe") confused the Avatar tests' text queries, and would confuse screen
readers too.

## Review fixes (same PR)

A review pass found that switching Type and back changed the character: each
direction overwrote shared fields with a lossy map (a "slight smile" became
"smile", anime hair became spikes, gender snapped to 0.95). Each field now
keeps the target's current value whenever it already maps to the source's, so
a round trip with no edits is a no-op in both directions. A unit test checks
every preset of both families. Edits made on one side still carry over.

Also fixed:
- A `null` section (a hand-edited header, or `{...spec, colors: undefined}`)
  crashed validation. It is now reported.
- A header that fails validation, or has an unknown version, reads as no
  header, so it can't break the panel.
- Avatar values outside the Realistic ranges (bust and belly to 2, a tiny
  height, `#rgb` colours) are clamped or expanded on the way in.
- A preview that can't build now says why, in one toast per distinct error.
- The family preference is per tab (perTabPref), like other app preferences.
