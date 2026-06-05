---
session: "c7e1a9"
timestamp: "2026-06-05T20:05:00Z"
sequence: 3
---

## Human

Move onto phase 3 — but I don't want to distribute yet. I love the idea of a CLI
that agents can use to drive model creation and get feedback, and I want to keep
it Homebrew-compliant. (Chosen: both, ergonomics first; tap-ready skeleton.)

## Assistant

## Key decisions

**Reframed Phase 3 from "distribute" to "agent-grade CLI + tap-ready scaffolding."**
The user isn't shipping yet, so publishing is deferred; the leverage is in agent
ergonomics + keeping a one-step path to a tap.

**Agent ergonomics (Track A).**
- `iterate <file>` — the high-level one-shot feedback loop: `setActiveLanguage` +
  `run` in the warm daemon page, then return `getGeometryData` (which already
  carries stats + `warnings[]` + `printability`) **and** a real `renderViews`
  PNG, in a single call. `preview` stays as the fast stateless/software variant.
- `methods [filter]` — discovery over `Object.keys(window.partwright)` so an agent
  can find callable methods without reading source.
- `help` / `--help` / `-h` now print usage and exit 0 (needed for the Homebrew
  formula's `test do` block; previously unknown-command exited 1).
- Documented an "Agent quickstart" in docs/headless-cli.md: draft → iterate →
  read stats+image → fix; every command emits one JSON object, `ok:false` is a
  tractable in-model error vs a non-zero exit = CLI failure.

**Homebrew tap-ready (Track B), nothing published.**
- `Formula/partwright.rb` — a complete node-CLI formula skeleton (placeholder
  url/sha256, Chromium caveat for Phase 2, `--help` smoke test).
- Promoted `vite`/`playwright`/`sharp` from devDependencies to dependencies so a
  `--omit=dev` production install (what `brew install` runs) has the CLI's
  runtime needs; regenerated package-lock. App build unaffected (`npm ci`
  installs both sections). Verified knip stays green (they're used by the `bin`
  production entry, so the categorisation is correct).
- Local install path: `npm ci && npm link`.

Verified: build + 670 unit tests, the full static-analysis trio
(consistency/deadcode/deps), and a daemon smoke test of `iterate` (real
multi-view render + stats) and `methods`.
