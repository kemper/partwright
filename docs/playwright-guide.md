# Playwright Guide

## Multi-environment browser detection

`playwright.config.ts` auto-picks the right Chromium binary so the same test command works on a developer laptop and inside the Claude Code on the web sandbox:

- **Sandbox** (`/opt/pw-browsers/` exists): config picks the highest installed `chromium-N` directory and uses its `chrome` binary directly via `launchOptions.executablePath`. The version pinned by the `playwright` npm package may differ from what's cached, but the installed browser still satisfies the test runner — no download needed (the sandbox often blocks Chrome for Testing's CDN).
- **Local laptop** (no `/opt/pw-browsers/`): config leaves `executablePath` unset, and Playwright finds its own cache at `~/.cache/ms-playwright/` (Linux) or `~/Library/Caches/ms-playwright/` (macOS). Run `npx playwright install chromium` once on a new machine.

Override at the shell if needed:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome npm run test:e2e
```

## AI agent gotchas

1. **Don't reinstall browsers blindly.** Check `/opt/pw-browsers/` first; the sandbox image already has Chromium. `playwright.config.ts` handles the wiring.
2. **Viewport size.** The default Desktop Chrome viewport (1280×720) clips the AI panel's toggle strip. The config sets 1280×900 — keep it that way for anything that interacts with elements in the bottom half of the panel.
3. **Viewport hit-test.** Tiny flex children of recently-transformed parents sometimes fail Playwright's viewport hit-test (`Element is outside of the viewport`). When the bounding box is verifiably inside, prefer `locator.dispatchEvent('click')` over `locator.click({ force: true })` — the latter still enforces the viewport bound.
4. **Fresh contexts.** Each Playwright test gets a fresh `BrowserContext`, so localStorage and IndexedDB are isolated by default. Don't add `localStorage.clear()` in `beforeEach` unless you mean it — it fires on `page.reload()` inside a test too, breaking any "state persists across reload" assertion.
5. **No external network.** The `validateKey` flow hits `api.anthropic.com`; assert on the surfaced error message, not on whether the request succeeded.
6. **List/rail drags need a tall viewport.** The parts list is a short scroll box at 900px height (a few rows ≈ 55px); drag-target e2e silently misses rows scrolled out of the clip. Set `page.setViewportSize({ width: 1280, height: 1400 })` before drag interactions.
7. **Poll for readiness, don't sleep.** Fixed `waitForTimeout` and modal races caused the paint-cancel and threemf-multipart flakes. Wait on an observable condition (`waitForFunction` on the engine/API, an element state) instead.
8. **Assert on persistent state, not toasts.** `showToast` renders a fading global node outside `#ai-panel`; a panel-scoped `toContainText` on it silently fails. Assert on the transcript or the IndexedDB store instead.
