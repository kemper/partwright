---
date: "2026-06-12T01:06:36Z"
task: "feat: figure spanGrips + poseProbe DX primitives and a holdAt demo"
pr: 608
areas: [tooling, agents, docs]
cost: low
---

## Liked / Worked
- `model:preview --json` round-trips in ~2 s and gates (isManifold / componentCount
  / genus / warnings) made it trivial to prove the rocker refactor was a pure
  geometric no-op: I rendered `origin/main`'s rocker via `git show ... > /tmp` and
  compared volumes to 12 digits (8950.147997…). That "diff the volume against main"
  trick is a fast, high-confidence regression check for any catalog refactor.
- Delegating the staff-mage pose iteration to `model-sculpt` kept ~5 preview PNGs
  out of my context; it returned text + one PNG path I shipped with `SendUserFile`
  without ever Reading it. The image-token discipline in CLAUDE.md paid off.
- `poseProbe` dogfooded itself: the subagent reported it cut ~4–5 render passes by
  turning a blind pose search into a targeted two-param sweep (read gripAxis Z,
  raise the arm until it points up). Building the DX tool and immediately using it
  to build its own demo validated the design in one session.

## Lacked
- No `gh` CLI and no `send_later` in this remote session, so the standard
  "subscribe + schedule a check-in for the CI-success gap" pattern degrades to a
  background `sleep` timer that wakes me to re-poll via MCP. Works, but it's a
  workaround the PR-monitoring instructions don't mention for the gh-less case.
- The `.thumb.png` sidecar convention (untracked; real thumbnail is embedded in
  the `.partwright.json` data URL) isn't written down — I had to confirm via
  `git ls-files` that 0 thumbs are tracked before deciding not to commit them.
  The Stop hook nags about these untracked files every turn, which is noise.

## Learned
- `model:preview`'s `-p k=v` does NOT reach `api.params` (re-confirmed from a prior
  retro — still true), and the npm banner pollutes `--json` unless you use
  `npm run --silent`. Both are easy to trip on.
- A `holdAt` consumer must be a prop that *follows the grip* (sword/wand/staff at
  the hand's angle). A *planted vertical* staff (chibi_wizard) is a `placeAt`+weld
  case, not `holdAt` — so reusing it as the consumer would have been wrong. The
  two helpers are not interchangeable and the distinction isn't obvious.

## Longed for
- A `model:preview --joints <file.js>` that prints `poseProbe` for the rig a figure
  model builds — but it can't, because preview only sees the returned Manifold, not
  the rig. The real fix would be a convention: if a model assigns `globalThis.__probe`
  (or returns a `{ manifold, probe }`), preview surfaces it. Would close the last
  gap between `poseProbe` (callable) and a one-command CLI dump.
- A documented `.gitignore` rule (or CLAUDE.md note) for `public/catalog/*.thumb.png`
  so the Stop-hook git check stops flagging the intentional sidecars every turn.
