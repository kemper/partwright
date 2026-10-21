---
date: 2026-07-06
author: claude (opus-4-8)
task: Multi-part Assembly grid view — read-only overview + shared params + Worker pool (PR #893)
---

## Liked
- The pure-module-first split (`layout.ts`, `sharedParams.ts` with node unit tests) let me land the two trickiest bits — grid packing and the param union with "affects N parts" — fully verified before touching any DOM/Three.js. Fast, and they never regressed through the whole rework.
- The spec-driven browser check was the highest-value step every round: a throwaway Playwright spec that builds a 3-part session via `window.partwright`, opens the view, and screenshots caught the two biggest bugs (the pool never resolving; edit tools acting on the hidden part) that typecheck/unit could never see.
- Asking the design question (read-only overview vs. full multi-part editing) *before* polishing. The user's answer collapsed four separate bug reports into one coherent model — they were all "is this a place you look or a place you edit?" — and saved me from hardening the wrong shape.

## Lacked
- A warm dev-server/browser loop. Each verification round paid the ~4s WASM boot + a fresh session build + ~12s pool-build wait inside a cold Playwright run. For a UI feature I iterated on ~5 times, that's minutes of dead wall-clock per look.
- Any static signal for the pool's missing `init`→`ready` handshake. `buildInPool` silently hung (`Promise.all` never resolved, no error) until I added a debug `console.warn` in the worker-message handler. A one-line "worker got `execute` before `init`" would have saved a debugging round.
- Clarity up front on `src/main.ts`'s module-scope vs. setup-function-scope split. I wrote `openAssembly`/`selectAndExitAssembly` at module scope, then discovered `selectPart` and every tool-close helper are nested inside the setup function — had to reshape into a "module-var assigned-in-setup" callback (`applyAssemblyChrome`). Cost a rewrite of the wiring.

## Learned
- The geometry Worker (`engineWorker.ts`) requires an explicit `{type:'init'}` and replies `ready` before any `execute`; a fresh pool worker that skips it returns `{type:'error', message:'Geometry engine not initialised'}`, not a rejected execute. Any new worker client must do the handshake AND handle the `error` message type, or failed builds hang forever.
- `Version.geometryData` is the stats JSON, not the mesh — there is no persisted raw mesh. "Cache-first" for a 3D part means the in-memory `partMeshCache` (keyed by version id) or a rebuild; the only always-available cheap artifact is the thumbnail PNG. This is why the Parts Overview sibling feature is thumbnail-only.
- All viewport edit tools mount into exactly two popovers (`#viewport-tools-group`, `#viewport-inspect-group`) via `viewportToolsMount`/`viewportInspectMount`. Toggling `hidden` on those two elements is a clean, one-line way to make the viewport read-only without touching any individual tool module.
- A concurrent feature can land on `main` mid-task and collide semantically, not just textually: Parts Overview (thumbnail modal, `▦`) shipped while I built the Assembly grid (`▦` too). The merge conflict was the *cheap* signal; the real work was differentiating them (kept both, `⧉` vs `▦`).

## Longed for
- A headless "warm browser" harness for UI iteration (the repo already has a render daemon for models) — open the editor once, keep WASM hot, drive `window.partwright` + screenshot per iteration. Would have turned ~5 cold 30-40s Playwright runs into sub-second looks. Biggest lever for any multi-round UI feature here.
- A tiny "new-Worker-client" checklist or shared base in `docs/` capturing the init/ready/error protocol, so the next pool/worker doesn't re-derive the handshake by hanging first.
- A note in CLAUDE.md's `main.ts` section on the module-scope vs. setup-scope boundary (which helpers live where) — it's a recurring friction point when adding a feature that needs both console-API reach and setup-local helpers.
