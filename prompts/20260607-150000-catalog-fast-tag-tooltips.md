---
date: 2026-06-07
branch: claude/adoring-mendel-JoRLs
files_changed:
  - src/content/catalogEntry.ts
---

## Human

There is a long delay when hovering over tags in the catalog. I want the hover
hints to show much faster.

## Assistant

**Root cause: the catalog tags used the browser's native `title` tooltip.** The
tile badges (Parametric, print-tested) and the language filter pills are
rendered server-side by the static pre-renderer (`render.ts`) with plain
`title=` attributes. The browser shows native `title` tooltips only after a
long, JS-uncontrollable delay (~0.5–1.5s) — that's the lag.

The app already solves this everywhere else: `src/ui/tooltip.ts` (`initTooltips`)
installs a delegated `[title]` listener that suppresses the native tooltip and
shows a fast styled bubble after a short, config-driven delay
(`ui.tooltipDelayMs`, default 150ms). But `/catalog` is a static pre-rendered
page that loads `src/content/catalogEntry.ts` instead of `main.ts`, so
`initTooltips()` (called from `main.ts`) never ran there — leaving the tags on
the slow native path.

**Fix: call `initTooltips()` from `catalogEntry.ts`.** One import + one call in
`init()`. This reuses the exact same fast tooltip and the user's configurable
delay, so the catalog matches the editor.

**Honoring the "empty import graph" rule.** `catalogEntry.ts` deliberately
avoids pulling in app/engine code. `tooltip.ts`'s only dependency is
`getConfig` from `appConfig.ts`, which is fully self-contained (zero imports,
pure TS + localStorage — no DOM/engine/WASM). Confirmed the build splits it into
its own ~5 KB chunk; the catalog entry chunk stays tiny and no engine code
leaks in. Updated the header comment to reflect that the new import is still
dependency-free.

Verified in a real browser: a throwaway Playwright spec on `/catalog` hovered a
language pill and asserted the `.pw-tooltip.visible` bubble appears within
400 ms (well inside the native delay) — passed, screenshot confirmed the styled
"Hide JS models" bubble. Build + unit tests green.
