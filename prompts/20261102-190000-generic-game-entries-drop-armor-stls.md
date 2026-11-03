---
session: "ad71db73"
timestamp: "2026-11-02T19:00:00Z"
---

## Human

Following the third-party content audit: rename the two catalog entries named
after video-game characters, remove the armor STLs (source and license never
recorded), and find and credit the original Wikimedia Commons reference photos.

## Assistant

## Key decisions

- **Generic names, same models.** The cube became "Heart Cube" and the ghost
  diorama "Arcade Ghost". The ids, file names, session names, code comments,
  label names (`pacman` → `chomper`, `paceye` → `chomper_eye`) and paint calls
  all changed, so no character name is left in shipped content. The geometry
  is unchanged, so the baked mesh and thumbnail stay valid. Old
  `?catalog=<old file>` links fall back to a fresh session, which the loader
  already does for a missing file, so no alias that keeps the old name.
- **Shape nickname too.** The Dummy 13 notes called a wedge-cut disk a
  "pac-man" shape; reworded to "wedge-cut" so a search for the name stays clean.
- **Armor STLs removed, reconstructions kept.** The 16 armor STLs came from a
  user-attached 3MF whose license was only assumed. The frame STLs stay: their
  source (soozafone, CC BY 4.0) is recorded. The design spec now says the
  armor STLs must be supplied locally to re-verify. The converged armor
  reconstructions are derived from those STLs; that call is the owner's.
- Earlier changelog, prompt-log and retro mentions were reworded to match.
