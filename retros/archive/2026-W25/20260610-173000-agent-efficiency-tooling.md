---
date: "2026-06-10T17:30:00Z"
task: "feat: agent-efficiency tooling — headless paint preview, version-rewrite helper, voxel stats, camera pins, preflight/snap"
pr: 573
areas: [tooling, testing, ci, pr-flow, docs]
cost: medium
---

## Liked / Worked

- **The retro loop fed itself.** The task brief was "what tooling should
  agents have?" and `retros/inbox` + the W23/W24 reports WERE the answer —
  ranked, with frequency counts and even design sketches (`worldBBox`,
  `--paint`, per-label counts). Grounding the proposal in those files took
  ~3 reads instead of a from-scratch survey. Keep the inbox honest; it is
  directly actionable.
- **Two parallel read-only `explore` agents** (paint-resolution map,
  version-rewrite/camera map) returned exactly the file:line maps needed.
  The paint map's "descriptors already ride MeshResult; only the resolver is
  browser-bound" finding cut the implementation to a small pure module.
- **`model:preview` as its own verification tool**: the new paint/voxel
  stats were verified by running the tool on scratch models in `.plans/` —
  no browser round-trip, instant JSON to assert against.
- **The work-reviewer caught a real should-fix** (new MeshResult fields
  dropped at the worker postMessage boundary) that typecheck can't see —
  optional fields silently vanish across structured-clone plumbing.

## Lacked

- **CodeQL feedback arrived only after the draft push** — the
  string-escaping flag in generated-spec code (`snap.mjs`) cost a fix
  commit + full CI re-run. A local `codeql`-lite pass doesn't exist; even a
  note in CLAUDE.md ("CodeQL scans PRs; prefer JSON.stringify over
  hand-rolled escaping in generated code") would have prevented it.
  (cost: ~3 turns + one CI cycle)
- **Webhooks deliver no CI-success event and `send_later` was unavailable**,
  so after the last push there was no way to self-wake and flip the draft to
  ready; the human merged it directly from draft. (cost: none this time, but
  the ready-flip step silently fell to the human)

## Learned

- **Two azimuth conventions coexist and disagree on paper.** The browser
  renderer (`src/renderer/multiview.ts:323`) defines azimuth 0=front/−Y,
  90=right/+X — so `STANDARD_VIEWS.iso` az 45 IS the "+X/−Y corner" that
  `catalog/README.md` calls "≈135°" (different convention), and
  `public/ai.md` (~line 277) repeats the 135 figure as if it were the
  renderer's number. The headless CLI rasterizer (`scripts/cli/views.mjs`)
  uses a third basis (`iso = az −50`). Anyone wiring camera angles must
  check which convention their layer uses; only multiview.ts documents its
  own. The stale `ai.md` line is still unfixed (pre-existing, left for a
  docs pass).
- **`statsComputation.ts` is browser-bound transitively** (units →
  perTabPref → localStorage), which is why Node scripts had inlined
  `simpleHash`. Now extracted to `src/geometry/simpleHash.ts`; the pattern
  ("extract the leaf, re-export from the old home") is cheap and worked
  first try.
- **Node scripts can consume canonical TS helpers via
  `createServer().ssrLoadModule()`** (see `convert-catalog-paint.mjs`) —
  the same trick `model:preview` uses. ~1 s overhead; beats duplicating
  logic in .mjs.

## Longed for

- **A pre-push static pass that includes the CI-only scanners** — even just
  `npm run preflight` growing a grep-able "generated-code escaping" lint, or
  a documented list of what CodeQL flags here historically.
- **`send_later` (or any self-scheduling) in remote sessions** so a
  PR-watching session can re-check shard status after the last push instead
  of going dark on success.
- The stale-doc fix backlog: `public/ai.md` thumbnail azimuth line (above),
  flagged by the reviewer but out of scope for the PR.
