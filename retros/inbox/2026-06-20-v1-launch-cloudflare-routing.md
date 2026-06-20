# Retro — v1.0.0 go-live: versioned deployments + Cloudflare routing (#775, #779, #782)

## Liked
- The quality-gate pipeline did exactly what it promises: each push to `main`
  auto-ran the staging gate, fast-forwarded `staging` only on green, and the
  `staging → production` promotion auto-tagged `v1.0.0` + cut the GitHub Release
  via `release-tag.yml`. Zero manual tag/release steps at the finish line.
- The `production-promotion-guard` (`no-content-beyond-main`) passing was a
  high-signal green light that the promotion was a clean pure-promotion — exactly
  the reassurance you want before a first production cutover.
- Background self-wake polling (a `sleep N; echo` Bash job re-arming itself) is a
  workable substitute for `send_later` when babysitting CI in a remote session
  where webhooks don't deliver CI-success/merge events.

## Lacked
- **No way to verify Cloudflare routing from the sandbox.** The egress allowlist
  403s `*.partwright.pages.dev`, so every `_redirects` hypothesis needed a full
  user round-trip on a real preview. Two `_redirects` fixes (#774, then #775)
  shipped before the right one stuck — each only falsifiable by the user testing
  live. A local/CI emulation of Cloudflare's `_redirects` semantics would have
  collapsed that loop; `wrangler pages dev` is documented as unreliable for
  nested-SPA `_redirects`, so it isn't it.
- The GitHub Actions `actions_list` MCP call returns ~350k chars (full repo
  object per run) and overflows the token cap every time — had to dump to file
  and `jq` on every single status check. A fields-projection option would help.

## Learned
- **Cloudflare `_redirects` canonicalization is the whole ballgame for clean
  URLs.** Three distinct traps, learned the hard way: (a) a splat-to-index
  rewrite (`/v1/* /v1/index.html 200`) is *rejected as an infinite loop* because
  the destination canonicalizes (`/v1/index.html` → `/v1/`) back into the splat
  source; (b) an exact 200-rewrite to `…/index.html` has its *destination*
  canonicalized → 308-redirects the user off-route to the bare dir; (c) a **real
  `.html` file served at its clean URL** (`/editor` → `editor.html`) works
  reliably — the same mechanism Pages already uses for the content pages. The fix
  was a Vite plugin (`editorHtmlAlias()`) that copies `index.html` → `editor.html`
  into each build outDir, so `/editor` and `/v1/editor` are real files, no rewrite.
- **A first big promotion false-fails the CodeQL code-scanning gate.** When
  `production` is hundreds of commits behind, the promotion diff makes
  code-scanning attribute already-scanned-on-`main` alerts to the PR — the
  *analysis* jobs pass, only the aggregate "CodeQL" results check goes red.
  Diagnosis tell: 0-second duration + the diff size. Admin-merge is the clean
  path; it won't recur once `production` tracks `main` closely.
- A project-wide Cloudflare build command means a *separate* `build:deploy`
  script breaks every branch that predates it — folding the dual build into the
  default `npm run build` (and keeping `build:deploy` as an alias) is what makes
  the command safe to set once.

## Longed for
- A CI check (or a tiny local harness) that asserts the *actual* served behavior
  of `_redirects`/clean-URLs against Cloudflare's real semantics, so a routing
  regression is caught pre-merge instead of by a user clicking a preview. The
  `/v1/editor` route broke and was "fixed" twice before the editor.html approach
  stuck — all three rounds were gated only on human eyes-on.
- `send_later` (or any first-class self-wake) in web/remote sessions: the
  re-arming `sleep` background job works but is manual bookkeeping, and there's
  no automatic wake on CI-success or merge.
