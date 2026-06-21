---
session: "busycray"
timestamp: "2026-06-21T16:22:26Z"
model: claude-opus-4-8
sequence: 6
---

## Human

Build the warm-browser fast path (#835 deliverable 2). [After finding it already
exists: "just document + close".]

## Assistant

## Key decisions

Investigated before building and found the **warm-persistent-browser daemon
already exists and is production-ready** (`bin/partwright.mjs` → `scripts/cli/
daemon.mjs`): `partwright daemon start/stop`, plus `render` / `iterate` / `call` /
`bake` that hold a warm Chromium + in-process Vite + the real app and render
through the actual WebGL viewport. Verified in-container: `daemon start`
(~60 s cold), then `partwright render --code figure.js` produces a true
app-fidelity 4-view PNG; cold-start is amortized, subsequent renders pay only the
model build.

So deliverable 2 needed **no rebuild** — only discoverability. Documented the
choice of render path:
- `docs/headless-cli.md` — new "Choosing a render path — fast vs app-fidelity"
  section: `model:preview` (now smooth+AA+lit, same mesh) for quick looks vs the
  daemon `render`/`iterate` for exact app pixels; plus the speed nuance (heavy
  SDF figures cost 10–70 s to *mesh* in either path — the daemon amortizes the
  browser cold-start, not the build).
- `CLAUDE.md` — pointer from the `model:preview` section to the daemon for
  app-fidelity, noting the rasterizer is no longer flat/faceted.

Second "look before building" win this session (the componentCount oracle was
also stale). Both #835 deliverables now satisfied: rasterizer upgrade (#834) +
the pre-existing daemon documented.
