// Engine-sandbox mode setting (kemper/partwright#1090, "option 2").
//
// Untrusted model code (typed, AI-written, or arriving in an imported/shared
// session) runs via `new Function('api', code)` inside the geometry Worker. A
// dedicated Worker on the APP origin can still open the app's IndexedDB (AI
// keys, sessions) and `fetch` anything the app CSP allows. The engine sandbox
// moves that Worker into a hidden iframe on a different origin so the code has
// no path to the app's storage:
//
//   'off'    — today's behaviour: the Worker is created directly by the app.
//   'opaque' — `<iframe sandbox="allow-scripts">` on the app's own URL, which
//              gives the frame (and the Worker it spawns) an OPAQUE origin.
//              Needs no extra hostname, but the frame's subresource loads are
//              cross-origin (CORS) and lose HTTP-cache reuse with the app.
//   'origin' — the frame is served from a separate origin
//              (build env `VITE_SANDBOX_ORIGIN`, e.g. sandbox.example.com).
//
// The value is a per-browser setting (localStorage — AppConfig only stores
// numbers/booleans) with a build-time default from `VITE_ENGINE_SANDBOX`, so a
// deployment can turn the sandbox on for everyone while a user can still pick a
// mode in Advanced Settings. It's read once when a geometry Worker is created
// (i.e. effectively at page load), so a change applies on reload.
//
// Pure apart from the guarded localStorage access, so it runs in the unit tier.

export type EngineSandboxMode = 'off' | 'opaque' | 'origin';

export const ENGINE_SANDBOX_MODES: readonly EngineSandboxMode[] = ['off', 'opaque', 'origin'];

const STORAGE_KEY = 'partwright-engine-sandbox';

export function isEngineSandboxMode(v: unknown): v is EngineSandboxMode {
  return typeof v === 'string' && (ENGINE_SANDBOX_MODES as readonly string[]).includes(v);
}

function buildDefault(): EngineSandboxMode {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_ENGINE_SANDBOX : undefined;
  return isEngineSandboxMode(raw) ? raw : 'off';
}

/** The build's default mode (`VITE_ENGINE_SANDBOX`, else 'off'). */
export function defaultEngineSandboxMode(): EngineSandboxMode {
  return buildDefault();
}

/** The requested mode: the per-browser override if one is saved, else the
 *  build default. Never throws (storage may be blocked). */
export function getEngineSandboxMode(): EngineSandboxMode {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isEngineSandboxMode(stored)) return stored;
  } catch {
    /* storage blocked — fall through to the build default */
  }
  return buildDefault();
}

/** Persist a per-browser mode override (applies on the next reload). Passing
 *  the build default clears the override. */
export function setEngineSandboxMode(mode: EngineSandboxMode): void {
  try {
    if (mode === buildDefault()) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    /* quota / private mode — the in-memory default still applies */
  }
}

/** Normalize a configured sandbox origin: an absolute http(s) URL reduced to
 *  its origin, or null when unset/invalid. Exported for unit tests. */
export function parseSandboxOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The origin the 'origin' mode frame is served from (`VITE_SANDBOX_ORIGIN`),
 *  or null when the build doesn't configure one. */
export function configuredSandboxOrigin(): string | null {
  const raw = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SANDBOX_ORIGIN : undefined;
  return parseSandboxOrigin(raw);
}
