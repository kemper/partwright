---
date: "2026-10-25T01:55:00Z"
task: "fix/feat: sandbox model code — Worker lockdown (#1109) + opt-in iframe sandbox with benchmark (#1110)"
pr: 1110
areas: [security, geometry-engine, agents, ci, e2e]
cost: high
---

## Liked / Worked
- **Every review round found real security bugs.** I ran a `work-reviewer` pass after each implementer round, and each one found something the implementer's own checks had missed:
  - #1110's fallback failed open: a dead frame got its buffered `execute` replayed into an app-origin Worker.
  - Voxel paint and export still ran model code on the main thread.
  - `isPlainData` let a DAG freeze the main thread, and later accepted cycles.
  - SharedArrayBuffer typed arrays could be rewritten after validation.
  - A paint descriptor allow-list was missing `pattern`.

  The re-reviews of the *fix* commits also found new issues, e.g. the session-isolation recycle being reported as an error instead of a cancel.
- **Checking a real Cloudflare preview settled two disputes.**
  - `curl -D -` against `*.pages.dev` showed that `/current//evil.com/` 302s to the same-origin `/evil.com/`, so the suspected open redirect wasn't exploitable.
  - It also showed that `/sandbox` gets both CSPs (applied as an intersection) and that `/sandbox.html` 308s.
  - A small Playwright script against the preview checked opaque mode, `/v1/`, BREP wasm and fonts under the production headers. Local dev can't show any of this.
- **Running the same spec on `origin/main` in a throwaway worktree** (with `node_modules` symlinked) proved in about 2 minutes that `ai-cli-bridge-setup` was flaky on main itself, so not caused by either PR. The fix became its own PR (#1113) and I ported it into the stack.

## Lacked
- **Stacked PRs with two worktree agents and a reviewer kept moving each other's base.** #1110 merged #1109 four times. Each #1109 fix round needed a "your base moved, merge X" message, plus a re-run of the same specs.
- **Agents ending their turn while their own background job ran.** The benchmark agent ended its turn while its bench was still running and reported "waiting for notification". It had to be resumed by hand (about 3 turns).
- **The test's wait condition accepted the stale value.** In `stl-import.spec.ts` it accepted any numeric volume, so a 0.25 s latency increase turned into a deterministic failure that looked like a correctness bug. It took a full investigation round to find out it wasn't one.

## Learned
- **Chromium 141 doesn't fire MessagePort `close` when a sandboxed iframe goes away.** Crash detection for a frame-hosted Worker needs an app-level heartbeat answered by the *frame document*, not the Worker, or long model builds look like crashes.
- **Chromium refuses a module-type `blob:` Worker from an opaque-origin document.** A classic blob that dynamic-imports the module works, and it inherits the frame's CSP.
- **`getGeometryData().stale !== true`** is the app's own "geometry matches the editor code" signal. Specs that switch sessions or code should wait on it, not on "volume is a number".
- **Engine Worker recycles must use a reason containing "cancel".** That is how `rejectAllPending` and `runCode` decide cancel vs error. Any new recycle reason without it shows up as a red error in the status bar.

## Longed for
- **`npm run e2e:on-base -- <spec>`:** run a spec against `origin/main` in a temp worktree that reuses this checkout's `node_modules`, and print pass/fail next to the current branch. It answers "is this failure mine?" in one command; I did it by hand twice.
- **`npm run preview:check -- <preview-url>`:** a checked-in Playwright script that loads `/editor` and `/v1/editor` on a Cloudflare preview, runs one manifold, BREP, SCAD and text model, optionally with `engineSandbox=opaque`, and reports volumes and console errors. Header and redirect behaviour is only real on Cloudflare.
- **A lint rule that engine Worker recycle reasons go through a shared constant**, so cancel vs error can't drift.
