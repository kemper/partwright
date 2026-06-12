---
session: "6sobw6"
timestamp: "2026-06-11T19:00:00Z"
tools: [playwright, vitest, subagent]
sequence: 5
---

## Human

Reported three gaps after using the in-code textures on a real model (sphere +
fuzzy + cable): (1) any edit — even a newline — dropped all surface effects to
the base mesh + "textures stale" pill; wanted auto-apply with an "Applying
textures…" timer + Cancel like the "Rendering…" pattern, with the pill only
after Cancel. (2) With textures stale, the Surface panel previewed modifiers
on the untextured original. (3) Applying an engrave after two textures locked
the main thread — asked for the surface apply to run in a Web Worker.

## Assistant

## Key decisions

**The three gaps share one root: the chain computed synchronously on the main
thread.** A usable timer + Cancel requires the compute off-thread (a sync op
can't repaint a timer or receive a click), and that same fact is the engrave
freeze. An explore-agent survey confirmed every chain modifier is
Worker-clean — pure math, three.js used only as data structures, WebGPU
available in Chromium Workers — with exactly one DOM blocker (the engrave
IMAGE mask path, not part of the chain).

**Surface Worker, geometry-worker idiom.** The apply kernel moved to a pure
leaf (`applyChain.ts`) hosted by `surfaceWorker.ts`; `surfaceOps.computeChain`
becomes the client — prefix-resume stays main-side, intermediate prefixes
come back as structured clones for memoization, the final mesh transfers
zero-copy. Cancellation is terminate+respawn (the only true interrupt for
synchronous per-op math), surfaced as a typed `SurfaceComputeCancelled`
rejection; a newer compute supersedes an in-flight one latest-wins, mirroring
run generations. Where `Worker` doesn't exist (vitest node env) computeChain
falls back to in-process — the entire existing unit suite passes unchanged.

**Memo key = base mesh content, not source text.** The original key hashed
src+params+imports, so a newline re-keyed the chain — the literal complaint.
`meshContentKey` (FNV-1a over the vertex/index buffers) makes any edit that
produces identical geometry an instant cache hit, however the text changed,
and is strictly safer than text normalization (which could equate different
string literals). Params/imports fell out of the key entirely — they're
already manifest in the mesh. Phase-3 persisted textures with old-format keys
just recompute once on first load (self-validating by design).

**Every run applies; Cancel parks.** The live-typing gate is gone: a cache
miss computes off-thread behind an inline "Applying texture… Xs" status +
the shared Cancel button (400 ms delayed show, generation-tokened so a
superseded compute's cleanup can't kill the newer timer — same shape as
startRunTimer). Cancel keeps the base mesh and parks the chain behind the
existing "⟳ stale — Re-apply" pill; the progress modal path was removed in
favor of the one inline pattern. The Cancel button's dispatch order is carve →
surface chain → engine run.

**Panel previews force the chain first.** New console method
`ensureSurfaceTexturesApplied()` (help() + docs added); the Surface panel
awaits it at the top of every preview, so previews always show the modifier
on the textured model — and it doubles as the agent-facing recovery from the
parked state.

**Engrave's own SDF sweep stays main-thread (cooperative yields) — explicitly
follow-up.** The chain offload removes the texture-recompute share of the
reported freeze; hosting the bake-path modifiers in the same Worker is the
natural next PR.

**Verification.** Unit: meshContentKey identity/sensitivity/cache-hit tests +
the full surfaceOps suite over the fallback path (1177 green). E2e reworked:
the stale-export test now reaches the parked state the only way it still
exists (catch the compute in flight, cancel) and covers pill-recovery;
new test pins the whitespace-edit-keeps-textures guarantee. Regression sweep:
surface-panel-as-code, ai-surface-texture-tool, paint-in-code,
surface-voronoi, surface-engrave (25 green). Browser screenshots of the
"Applying 2 textures… + Cancel" state and the finished 294k-tri result posted
in chat. lint:deps acyclic (surfaceOps no longer imports modifier math
statically — the graph got shallower).
