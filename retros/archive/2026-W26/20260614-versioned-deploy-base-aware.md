# Retro — versioned-deployment readiness (Phase 1–3: PRs #651, #653, #656, #660, #679)

## Liked
- **No-op slicing.** Every slice was engineered to be byte-identical at the
  current `base: '/'` (or major 1), so each PR was independently verifiable and
  mergeable with near-zero risk despite touching scary surfaces (`main.ts`
  routing, the schema ladder). "Make it ready, change nothing yet" kept five PRs
  shippable without a flag day.
- **`work-reviewer` earned its keep on the no-op PRs specifically.** Because the
  changes were no-ops at `/`, CI and browser checks *couldn't* catch base-leak
  gaps — the reviewer found the missed `/catalog/${file}` fetches (#656), the
  `sessionList.ts` writers + base-prefixed back-target predicates (#660), and the
  dual-context `content/data/help.ts` links (#679). Latent-under-`/vN/` bugs are
  invisible to a base-`/` test suite; a human/LLM diff review is the only net.
- The pure-helper-in-a-leaf pattern (`deployment.ts`, mirroring
  `languageFallback.ts`/`appVersionCompat.ts`) made the foundation unit-testable
  and kept the dep graph acyclic.

## Lacked
- **No way to actually exercise a `/vN/` base.** Everything is verified as a
  no-op at `/`; the real correctness (does it work mounted at `/v2/`?) can't be
  tested until PR4 flips the base. A `DEPLOY_BASE=/v2/ npm run build` smoke path
  + one Playwright run against a `/v2/`-served preview would have let each slice
  prove the non-trivial half, not just the no-op half.
- **The build-time vs runtime context split wasn't obvious up front.** I scoped
  PR3 as "SEO/content" assuming `appPath` would work everywhere, then discovered
  the content pages prerender in the Node build context (no
  `import.meta.env.BASE_URL`) and that `chrome.ts`/`content/data` are
  dual-context. Re-scoping mid-PR was clean but the upfront touch-point audit
  (explore agent) didn't flag the execution-context axis.

## Learned
- `import.meta.env.BASE_URL` is inlined only into the client/worker bundles.
  Anything that runs in the Vite config / plugin Node context (prerender,
  sitemap) must take the base as a **threaded parameter** (`config.base`), not
  read it from `deployment.ts`. Pure helpers (`joinBase`) are safe to share
  across both contexts; the `BASE`-reading wrappers are runtime-only.
- `updateAppHistory`'s self-guard compares against the raw base-prefixed URL, so
  a writer that pushes a *bare* `/editor` under `/vN/` isn't suppressed by the
  guard — it actually navigates out of the deployment. Base-leak in a history
  writer is worse than in a predicate.
- The export **schema version** (`partwright: "1.x"`) and the **app semver**
  (`1.0.0`) are independent axes; conflating them into one number would have
  broken the migration seam. Keeping them separate (#653) was the right call.

## Longed for
- A lint rule (ast-grep) that flags root-absolute string literals in
  `history.pushState`/`replaceState`/`location.assign`/`fetch`/`href=` outside
  `deployment.ts` — the exact class of base-leak the reviewer caught by hand
  three times. That would turn "diff-review catches it" into "CI catches it."
- A single capability/route registry both the router and the helpers derive
  from, so route literals exist in exactly one place (also the standing
  UI↔API-parity wish in CLAUDE.md).
