---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-27T04:00:00Z"
model: claude-opus-5-5
tools: [playwright]
sequence: 5
---

## Human

[Coordinator, relaying the user's decision on PR #1138.] Keep all three
layers (SES, the Worker lockdown, the iframe sandbox), make the separate-origin
iframe sandbox ON by default, and drop the `opaque` mode entirely. Default =
`origin` when the build configures a sandbox origin; an explicit `off` (stored,
or `VITE_ENGINE_SANDBOX=off`) stays the kill switch; keep fail-closed; don't
break dev or e2e. Remove opaque from the sandbox code, settings UI, status
`modes`, `setEngineSandboxMode('opaque')` (clear `{ error }`), the opaque-only
CORS in `_headers` and the dev CORS mirror; migrate a stored 'opaque' away;
convert the opaque tests and the bench. Update engine-sandbox.md (with a short
"why not opaque"), ai.md, help(), architecture-notes and the legal copy;
re-shoot the settings section.

## Assistant

- **Default needs this page's origin in `VITE_APP_ORIGIN`, not just a sandbox
  origin.** The frame only accepts spawn requests from those origins, so a
  preview deploy on another host with the production env would otherwise
  default to `origin` and fail closed on every load. Such pages default to
  `off` instead; `originModeAvailable` is the single pure check, shared by the
  default, the settings label ("not configured for this site") and the
  `setEngineSandboxMode('origin')` refusal.
- **The frame no longer accepts its own origin as a parent.** That was only
  needed for the opaque frame on the app URL; `allowedParentOrigins` now takes
  just the configured app origins.
- **Migration:** a stored `'opaque'` is deleted on read and the default
  applies; storing the default clears the key, so a browser follows future
  default changes unless it explicitly chose otherwise.
- **e2e pins the build default to `off`** in `playwright.config.ts`
  (`VITE_ENGINE_SANDBOX`, overridable) because the second dev server makes
  origin "available" there; the sandbox specs opt in per page, and
  `VITE_ENGINE_SANDBOX=origin` runs any spec inside the frame.
- Kept the frame's classic blob-Worker bootstrap and `frame-ancestors 'self'`
  (dev only) — both still work for origin mode. The perf table drops the opaque
  column; its findings stay as the "why not opaque" rationale.
