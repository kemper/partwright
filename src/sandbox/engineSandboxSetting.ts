// Engine-sandbox mode setting (kemper/partwright#1090, "option 2").
//
// Untrusted model code (typed, AI-written, or arriving in an imported/shared
// session) runs inside the geometry Worker. A dedicated Worker on the APP
// origin could still open the app's IndexedDB (AI keys, sessions) and `fetch`
// anything the app CSP allows if it ever escaped the SES compartment and the
// Worker lockdown. The engine sandbox moves that Worker into a hidden iframe on
// a separate origin so the code has no path to the app's storage at all:
//
//   'origin' — the frame is served from a separate origin (build env
//              `VITE_SANDBOX_ORIGIN`, e.g. partwright-sandbox.pages.dev).
//              The DEFAULT whenever the build configures one and this page's
//              origin is one of the app origins the frame accepts
//              (`VITE_APP_ORIGIN`).
//   'off'    — the Worker is created directly by the app. The default when no
//              sandbox origin is configured (`npm run dev`, preview deploys);
//              an explicit 'off' (per browser, or `VITE_ENGINE_SANDBOX=off`)
//              is the kill switch.
//
// There used to be an 'opaque' mode (a sandboxed iframe with an opaque origin
// on the app's own URL). It was dropped: an opaque origin gets a fresh HTTP /
// code-cache partition per frame, so every page load re-downloaded and
// recompiled the engines, and it needed CORS on every static asset. A saved
// 'opaque' choice is cleared and falls back to the default.
//
// The value is a per-browser setting (localStorage — AppConfig only stores
// numbers/booleans) with a build-time default from `VITE_ENGINE_SANDBOX`. It's
// read once when the page loads, so a change applies on reload.
//
// Pure apart from the guarded localStorage / location access, so it runs in
// the unit tier.

import { allowedParentOrigins } from './frameProtocol';

export type EngineSandboxMode = 'off' | 'origin';

export const ENGINE_SANDBOX_MODES: readonly EngineSandboxMode[] = ['off', 'origin'];

const STORAGE_KEY = 'partwright-engine-sandbox';

/** A removed mode name a stored setting may still hold. */
const REMOVED_MODES: readonly string[] = ['opaque'];

export function isEngineSandboxMode(v: unknown): v is EngineSandboxMode {
  return typeof v === 'string' && (ENGINE_SANDBOX_MODES as readonly string[]).includes(v);
}

/** True for a mode that existed once and was removed ('opaque'). */
export function isRemovedEngineSandboxMode(v: unknown): boolean {
  return typeof v === 'string' && REMOVED_MODES.includes(v);
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

function env(name: string): unknown {
  return typeof import.meta !== 'undefined' ? (import.meta.env as Record<string, unknown> | undefined)?.[name] : undefined;
}

/** The origin the 'origin' mode frame is served from (`VITE_SANDBOX_ORIGIN`),
 *  or null when the build doesn't configure one. */
export function configuredSandboxOrigin(): string | null {
  return parseSandboxOrigin(env('VITE_SANDBOX_ORIGIN'));
}

export interface SandboxModeInputs {
  /** The per-browser override (localStorage), raw. */
  stored: unknown;
  /** `VITE_ENGINE_SANDBOX`, raw. */
  buildDefault: unknown;
  /** `VITE_SANDBOX_ORIGIN`, raw. */
  sandboxOrigin: unknown;
  /** `VITE_APP_ORIGIN` (comma-separated), raw. */
  appOrigins: unknown;
  /** This page's origin (`location.origin`), or null outside a page. */
  pageOrigin: string | null;
}

/** True when this page can use 'origin' mode: a sandbox origin is configured,
 *  it isn't this page's own origin, and this page's origin is one the frame
 *  accepts spawn requests from (VITE_APP_ORIGIN). Pure — unit-tested. */
export function originModeAvailable(i: Pick<SandboxModeInputs, 'sandboxOrigin' | 'appOrigins' | 'pageOrigin'>): boolean {
  const sandbox = parseSandboxOrigin(i.sandboxOrigin);
  if (!sandbox || !i.pageOrigin || sandbox === i.pageOrigin) return false;
  return allowedParentOrigins(i.appOrigins).has(i.pageOrigin);
}

/** The mode with no per-browser choice: `VITE_ENGINE_SANDBOX` when it names a
 *  mode, else 'origin' when available, else 'off'. Pure — unit-tested. */
export function resolveDefaultEngineSandboxMode(i: Omit<SandboxModeInputs, 'stored'>): EngineSandboxMode {
  if (isEngineSandboxMode(i.buildDefault)) return i.buildDefault;
  return originModeAvailable(i) ? 'origin' : 'off';
}

/** The effective mode: a valid stored choice wins, else the default (a stored
 *  removed mode counts as no choice). Pure — unit-tested. */
export function resolveEngineSandboxMode(i: SandboxModeInputs): EngineSandboxMode {
  return isEngineSandboxMode(i.stored) ? i.stored : resolveDefaultEngineSandboxMode(i);
}

function pageOrigin(): string | null {
  try {
    const o = globalThis.location?.origin;
    return typeof o === 'string' && o !== 'null' ? o : null;
  } catch {
    return null;
  }
}

function inputs(stored: unknown): SandboxModeInputs {
  return {
    stored,
    buildDefault: env('VITE_ENGINE_SANDBOX'),
    sandboxOrigin: env('VITE_SANDBOX_ORIGIN'),
    appOrigins: env('VITE_APP_ORIGIN'),
    pageOrigin: pageOrigin(),
  };
}

/** This page's default mode (no per-browser choice). */
export function defaultEngineSandboxMode(): EngineSandboxMode {
  return resolveDefaultEngineSandboxMode(inputs(undefined));
}

/** True when this page can run in 'origin' mode. */
export function engineSandboxOriginAvailable(): boolean {
  return originModeAvailable(inputs(undefined));
}

/** The requested mode: the per-browser override if one is saved, else the
 *  default. A saved removed mode ('opaque') is deleted on the way. Never throws
 *  (storage may be blocked). */
export function getEngineSandboxMode(): EngineSandboxMode {
  let stored: string | null = null;
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    if (isRemovedEngineSandboxMode(stored)) {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
      stored = null;
    }
  } catch {
    /* storage blocked — fall through to the default */
  }
  return resolveEngineSandboxMode(inputs(stored));
}

/** Persist a per-browser mode override (applies on the next reload). Passing
 *  the default clears the override. */
export function setEngineSandboxMode(mode: EngineSandboxMode): void {
  try {
    if (mode === defaultEngineSandboxMode()) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    /* quota / private mode — the in-memory default still applies */
  }
}
