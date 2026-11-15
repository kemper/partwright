---
session: "5ecjfq"
timestamp: "2026-11-15T03:58:01Z"
sequence: 3
tools: [work-reviewer]
---

## Human

No new request. This follows the repo's standing step of running the review
agent over a PR's diff before it is marked ready.

## Assistant

## Key decisions

**Hash what actually runs.** The first version re-hashed the downloaded bundle
before each run, but the thing executed is the unpacked launcher script and
binary, which sit in a gitignored directory where an edit is invisible to
`git status`. `run` now re-hashes those two files against pinned values and
re-unpacks from the verified bundle on a mismatch. I did not hash the whole
unpacked tree (hundreds of MB of bundled libraries on every run); the comments
and docs now say exactly which files are checked instead of claiming more.

**Compile the shim per run.** A cached `.so` was both stale-prone (a source
edit never took effect) and one more unverified file being preloaded. Building
it into the run's private temp dir costs about 50 ms and removes both problems.

**Async spawn with signal handling.** `spawnSync` blocks the event loop, so a
harness timeout or `kill` left the compositor and its temp dir behind. The
slicer now runs under `spawn`; SIGINT/SIGTERM/SIGHUP are forwarded to it and
the compositor and temp dir are cleaned up. Verified by killing the wrapper
mid-slice.

**Shim tells the truth about the context.** It now reports a GLX display and
context only while an OSMesa context is current, so it cannot mask a run where
no GL context exists.

**Smaller hardening taken as-is from the review:** no shell interpolation in
the command lookup, clear errors for `--apt` without apt-get or root, a
readable message when the system C library is too old, and the multiarch /
`/sbin` cases in the library lookup.
