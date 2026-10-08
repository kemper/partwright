# Retro — Bambu export printer/nozzle/filament picker

## Liked
- The "mirror a real reference" technique kept paying off: the user's real P1S export was
  both the single-nozzle base AND an independent validation of the N-filament resize
  (17 filaments matched the m=len/T math exactly). Real artifacts > guessing.
- Bambu CLI as a fast load+slice oracle (rc 0 / -50 / -66 / -104 each meant something
  specific) let me validate single-nozzle + PETG without the GUI.

## Lacked
- I over-engineered the first cut: built a vendored BambuStudio profile-composition
  engine (inheritance resolver + 11 vendored JSONs) when the user just wanted simple
  dropdowns + a small override table. Burned a commit + a subagent before the user said
  "I didn't think we'd be pulling in files from bambu." I had the simpler path available
  (override a known-good base) and chose the elaborate one.

## Learned
- For a feature framed as simple UI ("a dropdown to pick X"), confirm the IMPLEMENTATION
  shape with the user BEFORE building the engine — especially when my instinct reaches
  for a general/scalable solution. A 1-line "here's the approach, ok?" would have saved
  the detour. The user's mental model is a design constraint, not just the requirements.
- Cloudflare Pages 0-second check failures = environmental (superseded/transient deploy),
  not a build break. The authoritative gate is build-unit; don't chase Cloudflare blips.

## Longed for
- A headless way to validate the Bambu *GUI* load path (the crash class is GUI-only;
  CLI load+slice misses it). Every GUI-crash fix needed a user round-trip.
- A "scope check" reflex prompt when a task's implementation balloons past the user's
  stated intent (N files / a new engine for "add a dropdown").
