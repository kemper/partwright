---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T00:10:00Z"
model: claude-opus-5-5
tools: [subagent, git-worktree, playwright]
---

## Human

Review follow-ups for #1110 (engine iframe sandbox): merge #1109 (engine
Worker lockdown) and route its per-session Worker recycle through the sandbox
façade; make the sandbox FAIL CLOSED (never replay buffered model code into a
direct app-origin Worker; restart the iframe when a spawn hangs after the
frame was up; a persistent status pill with an explicit per-tab "Run without
sandbox"); capture the mode once per tab and expose the saved value as
`pendingAfterReload`; guard setReferenceGeometry against stale async results;
origin-mode hardening (frame-ancestors, parent-origin check in the frame,
redirect requirement for the sandbox host); Playwright fixes (own Vite
cacheDir, port+1000, CORS probe for opaque); fix the pendingSpawns leak and
terminate crashed Workers; a unit test pinning the Worker message types; keep
the frame protocol out of the app bundle; loadEnv; exact sandbox path match;
screenshots of the new settings section and the pill.

## Assistant

## Key decisions

**Fail closed, with no automatic fallback at all.** The review's "better"
option: every failure (frame not isolated / not loading / restart budget
spent / origin misconfigured) marks the sandbox unavailable for the tab.
`createEngineWorker` then returns an always-failing stand-in Worker, so every
call rejects with "engine sandbox unavailable", and the pill offers the only
way out (`runWithoutEngineSandbox`). The façade's buffer is only ever
delivered to a sandboxed Worker: on a frame restart, waiting façades re-spawn
in the NEW frame with their buffer, and connected ones error out so the
client re-runs.

**Crash detection.** A stuck spawn after `frame_ready` restarts the frame, and
so does an unexpected MessagePort `close` event (the frame renderer died).
Restarts are bounded by the new `renderer.engineSandboxMaxFrameRestarts`
(AppConfig + bounds + modal).

**One list of Worker message types.** protocol.ts now reuses #1109's exported
`ENGINE_WORKER_MESSAGE_TYPES`. The old private copy was missing
`voxel_grid_result`, which #1109 added, so sandbox mode would have dropped
voxel-grid replies. A unit test extracts the `type: '…'` literals
engineWorker.ts posts and asserts they equal that set.

**Frame protocol split.** The frame-only half (frameProtocol.ts) is imported
only by the frame and its Worker, so the app no longer loads a shared chunk
with the sandbox off. A unit test asserts the duplicated constant matches.

**Shim hardening against #1109's shared realm.** The shim captures
`MessagePort.prototype.postMessage`, `dispatchEvent` and `MessageEvent` before
model code runs, so patched built-ins can't read or forge later traffic.
#1109's lockdown pins the shim's `postMessage` and keeps its private
same-origin asset fetch working through the shim's URL-resolving `fetch`.

**Heartbeat instead of MessagePort `close`.** Chromium 141 never fired `close`
on the app's port when the frame went away (verified by removing the iframe),
so the host pings the frame (`renderer.engineSandboxHeartbeatMs`). About three
unanswered pings restart the frame. A tick that itself fired late (the app's
main thread stalled) only re-pings and never restarts, so a busy same-process
frame isn't mistaken for a dead one. The e2e simulates the crash by removing
the iframe: CDP `Page.crash` on the frame took down the whole page, because
headless Chromium kept the opaque frame in the app's process here.

**Surfacing the refusal.** API runs used to report a rejected run as
"superseded — retry", which the AI loop treats as transient. Only the
fail-closed refusal is now passed through verbatim (`runFailedMessage()`).
Other rejections keep the old text, so the AI retry behaviour is unchanged.

**Re-review nits.** When the sandbox is unavailable, the engine pool used to
treat each stand-in Worker's refusal as a crash. It respawned until the
budget ran out and then reported "failed to initialise". It now rejects
in-flight and queued builds with the refusal itself and doesn't respawn. A
unit test with a mocked `createEngineWorker` covers this; it fails on the old
pool code. A replacement frame (from `restartFrame`) that misses its boot
timeout now counts as one more restart against the budget, instead of
failing closed straight away. Only the tab's first frame fails closed on boot
timeout. The vite.config origin list keeps only http(s) origins. Stale "falls
back" wording is gone.
