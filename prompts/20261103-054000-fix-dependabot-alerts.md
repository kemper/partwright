---
session: "e301f0b4"
timestamp: "2026-11-03T05:40:00Z"
tools: [npm-audit]
---

## Human

I see when pushing that there are Dependabot failures on main. Please investigate.

## Assistant

## Key decisions

**What the "failures" were**: GitHub's push banner listing open Dependabot
security alerts on `main`, not a failing CI job (the repo has no
`dependabot.yml` and the session token can't read the alerts API). `npm audit`
reproduced them: 22 advisories (9 high, 13 moderate), all in dependencies.

**Fixes, smallest bump first**:
- In-range bumps: vite 6.4.2 → 6.4.5 (stays on v6), vitest 4.1.8 → 4.1.12,
  plus transitive fflate, zod, smol-toml, nanoid, postcss, source-map-js,
  ndarray-pixels, brace-expansion.
- sharp 0.34.5 → 0.35.5. It is only used by Node scripts and tests, never the
  browser bundle, and ndarray-pixels 5.2 already needs `^0.35`, so this also
  dedupes to one copy. Checked with `model:preview`.
- madge 8 and js-beautify 1.15 are already the newest usable versions;
  `npm audit fix --force` would only downgrade them. Instead, scoped `overrides`
  move only their subtrees to the fixed minimatch ^11.0.1 and glob ^14.0.2.
  Their API is unchanged: `Minimatch`, `globSync` and `hasMagic` still exist,
  and glob 14 still ships CJS. Checked with the js-beautify CLI, editorconfig
  parsing and `lint:deps`.

**npm workaround**: npm 10.9 crashes on vitest's peer set ("Cannot read
properties of null (reading 'edgesOut')"), so `npm audit fix` and
`npm install vitest@…` both failed. npm 11 re-resolved the lock. That also
restored the cross-platform optional binaries (esbuild, rollup, sharp, oxc)
that the old Linux-only lock had pruned, so most of the lockfile diff is
expected. A clean `npm ci` with npm 10 (the CI toolchain) still works and
reports 0 vulnerabilities.
