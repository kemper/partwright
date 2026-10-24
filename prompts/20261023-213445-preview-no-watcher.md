---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T21:34:45Z"
tools: [subagent, git-worktree]
sequence: 2
---

## Human

Do all remaining follow-ups of #1056.

## Assistant

## Key decisions

**Turn off the file watcher in the CLI's SSR servers.** `model:preview` (and the photo / segment / catalog-paint scripts) boot a Vite server in middleware mode only to `ssrLoadModule` app code. They never need HMR. Vite's default chokidar watcher registered about 6.5k inotify watches per run (measured from `/proc/self/fdinfo`), so more than two concurrent runs on a machine already running dev servers hit ENOSPC.

`server.watch: null` (supported by the pinned Vite 6) brings that to 0 watches. Four concurrent `model:preview --match-photo` runs now all succeed. The browser daemon's dev server keeps its watcher, because it serves a live app.
