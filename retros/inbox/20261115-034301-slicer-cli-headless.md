---
date: "2026-11-15T03:43:01Z"
task: "chore/fix: run the real slicer's CLI headless as a 3MF checker"
pr: 1252
areas: [tooling, import-export, agents]
cost: medium
---

## Liked / Worked
- The 2026-W27 3MF export retro named the gap exactly ("a headless GUI-load
  smoke check would have collapsed ~6 user round-trips"). It made the case for
  this tool before any code was written.
- `build3MFProject` + `parse3MF` run in plain Node (`npx vite-node`), so a
  painted test file took one short script and no browser.

## Lacked
- The cloud session's safety check refuses to execute a downloaded binary, and
  nothing in CLAUDE.md says so. Cost: one PR round-trip to add an allow rule
  before the first real test. Naming a hash-pinning wrapper in the rule (not
  the binary) is what made the rule reviewable.
- `github.com` pages and the API for an unattached public repo return 403
  through the session proxy, which reads like a network block. Release
  **assets** and `raw.githubusercontent.com` do go through. Asset file names
  can't be listed from inside the session; the `web-fetch` agent can read the
  release page.

## Learned
- The pinned slicer build's windowing layer is Wayland-only: `xvfb` is never
  consulted. It needs a headless `weston`, and `XDG_RUNTIME_DIR` must be short
  (Unix socket paths cap near 108 bytes; the scratchpad path is too long).
- Its GL loader is GLX-flavoured and treats a GLX start-up failure as fatal,
  while the context it creates is OSMesa. A ~20-line preload shim that answers
  five GLX calls from OSMesa is enough; then `--export-png` renders painted
  filament colours in about 1 s.
- The slicer writes `result.json` into the current directory when
  `--outputdir` is omitted (even for `--help`).

## Longed for
- `partwright slicer-check model.3mf`: one command that runs the render and the
  slice and prints a single JSON report, so an agent validates a print job in
  one call instead of two plus JSON digging. Tracked in #1253.
