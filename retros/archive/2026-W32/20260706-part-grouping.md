# 4-Ls — part grouping (threaded part list) + dummy13 armor group

**Liked** — The pre-work exploration mapped every constraint before I wrote
a line: the seven-location schema ladder, both import loops, the NUL-byte
`main.ts` caveat, and the drag internals were all in `CLAUDE.md`/docs, so
the design (an additive `Part.group` string, no DB_VERSION bump, no new
store) fell out immediately. Splitting the pure tree logic into
`partTree.ts` meant the threading rules got fast vitest coverage without a
browser, and the `work-reviewer` pass earned its keep — it caught the one
real regression (collapsed groups no-oping all drags) that my own e2e
hadn't exercised because the first tests only grouped *expanded*.

**Lacked** — A cheap way to eyeball the rail during dev. The parts-list is
a short scroll box at the default 720px viewport (~55px tall with a few
parts), so drag-targeting e2e silently missed until I set a 1400px
viewport; I burned two runs and a debug scratch discovering rows were
scrolled out of the clip. A note in the playwright guide ("rail/list drags
need a tall viewport") would have saved that loop.

**Learned** — The `promptlog-guard` PreToolUse hook evaluates staged files
at hook time, i.e. BEFORE a compound `git add -A && git commit` runs its
own `git add` — so staging must be its own prior Bash call, never chained
in the same command as the commit. Cost two blocked commits to see it.
Also: `assertString(..., {optional:true})` already accepts `null` (not just
`undefined`), so there's no `allowNull` option to reach for.

**Longed for** — (1) `send_later` in web/remote sessions — it's documented
unavailable and the permission stream just closes, so there's no
hour-out self-wake to confirm CI went green; the PR-watch loop is
failure-webhook-only. (2) The viewport-height gotcha above baked into the
`snap`/manual-verification tooling (auto-tall for rail interactions). (3) A
capability registry so a new part affordance (grouping) couldn't drift out
of `window.partwright`/`help()`/`ai.md` parity — the same-PR norm is still
manual vigilance.
