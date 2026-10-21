# 20260706 — in-app mesh→code reconstruction (PR #899)

**Liked** — The headless kernel (scripts/inverse-cad/*.mjs) was already pure
math with Node APIs only at the CLI edges, so the browser port was nearly
mechanical; the explore agent's integration map (import register, engrave
worker idioms, tool/slash/palette templates) let every wiring step be a
copy-of-a-sibling rather than an invention. The `exportSTLData ↔
importMeshData` round-trip made a self-contained e2e golden path possible
with no fixture files.

**Lacked** — A way to update a hardcoded expected-list unit test
(slashCommands "prefix 'c'" match) without tripping on it in CI first…
caught it locally this time only because I ran the targeted unit file after
adding the command. Also: `showToast(msg, variant)` vs `showToast(msg,
{variant})` — guessed the old signature from CLAUDE.md prose and paid one
typecheck round-trip.

**Learned** — The first timing probe silently converted the 1×1 warmup cube
because my invented `api.sdf.shape` call failed *upstream* and the scratch
spec's error guard passed vacuously; an explicit `importTris < 10000 →
error` assertion made the probe honest. Empirical: browser
`Manifold.levelSet` cost is dominated by the WASM→JS callback boundary
(~4µs/cell), so a *cell budget* makes preset cost model-size-independent —
draft 8s / standard 26s / fine 100s — and sampled chamfer saturates at the
noise floor even at draft.

**Longed for** — A worker-side progress channel into the existing
"Rendering… Xs" indicator for the levelSet run itself (the generated code
runs as ordinary user code, so convertToCode's slow phase shows only the
generic run status, no percentage). Also a headless twin of convertToCode
(CLI: `partwright convert <file.stl>`) so quality-knob tuning doesn't need
a Playwright loop.
