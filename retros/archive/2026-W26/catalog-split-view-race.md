# Retro — catalog split-view bug (rapid clicks stack panes) (#811)

## Liked
- The `explore` subagent nailed the root cause in one pass: it traced the full
  router path (`syncRouteFromURL` → `showCatalogPage`), spotted that the
  `if (!catalogEl)` guard straddles an `await createCatalogPage(...)` that does a
  manifest fetch, and named the exact race window — all returned as file:line
  conclusions, no file dumps in my context. A clean delegation win.
- `git stash` → re-run test → `git stash pop` to prove the regression test
  actually fails on the pre-fix code took ~30s and turned "I think this is the
  bug" into "this is the bug." Cheap, high-confidence.

## Lacked
- No shared helper for "lazy-init an async-built singleton page." This same
  `if (!x) x = await build()` shape is repeated for each overlay page in
  `main.ts`; the others happen to be synchronous today, but the next async one
  will reintroduce this exact race. A tiny `lazyOnce(build)` util that caches
  the in-flight promise would make the safe pattern the default.

## Learned
- **`history.pushState` fires `popstate` synchronously**, so a single click into
  `showCatalogPage` can re-enter itself via the router *before* its own `await`
  resolves — re-entrancy isn't only from a literal double-click. Any lazy guard
  on an awaited build must use an in-flight-promise lock, not a post-await flag.
- The screenshot path is reused across runs, so a `git stash` re-run overwrites
  it — the on-disk PNG after a stash/pop dance is the *last* run's, not the one
  you think. Copy to `-BEFORE`/`-AFTER` names when capturing both states.

## Longed for
- A way to self-wake on CI *success* / mergeability in this remote env: no
  `send_later`, no `gh` CLI, and Monitor can't query GitHub from bash without a
  token — so I fell back to a blind `sleep` timer Monitor to re-poll via MCP.
  A first-class "notify me when PR checks settle" hook would replace the timer.
