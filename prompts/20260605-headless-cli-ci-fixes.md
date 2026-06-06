---
session: "c7e1a9"
timestamp: "2026-06-05T19:45:00Z"
sequence: 2
---

## Human

(PR #451 CI) static-analysis check failed; CodeQL flagged daemon.mjs for
information exposure through a stack trace. Address what needs attention.

## Assistant

## Key decisions

**knip false positive (the gating failure).** Refactoring moved the `import sharp`
out of `scripts/model-preview.mjs` into `scripts/cli/preview.mjs`, but knip's
entry glob was `scripts/*.mjs` (one level), so it never scanned the nested CLI
files and reported `sharp` as an unused devDependency (a gating `dependencies`
error). Broadened the globs to `scripts/**/*.mjs` + `bin/*.mjs`. The two
remaining knip hits (`resetClient`, `SurfaceModifierId`) are pre-existing
`warn`-level `exports`/`types` and don't gate.

**CodeQL stack-trace exposure (daemon control server).** The control server is
127.0.0.1-only, so exposing errors to the local CLI is intentional and useful —
but I restructured rather than dismiss, getting both safety and usefulness:
domain errors (bad model, failed boolean) are now caught **inside** the page and
returned as structured `{ok, error}` data — they never become a Node `Error`, so
no stack-trace data flows to the response — while the top-level HTTP catch (true
infra failures) logs the detail to `.partwright/daemon.log` and returns a generic
message. Verified knip exits 0 and the daemon's success / domain-error / infra
paths all behave correctly.
