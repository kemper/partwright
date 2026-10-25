// Keep the full app off the engine-sandbox host (docs/engine-sandbox.md).
//
// In 'origin' mode the geometry Worker runs on VITE_SANDBOX_ORIGIN. A
// deployment usually serves that host from the SAME build as the app (e.g. a
// second Pages project, partwright-sandbox.pages.dev), so its `/editor` would
// boot the whole app. Anything a visitor saved there (sessions, AI keys) would
// sit in the very origin untrusted model code runs in. entry.ts checks this
// before it loads any app bundle or touches storage, and sends the visitor to
// the real app instead.
//
// Only the exact configured origin matters: per-deploy hosts
// (<hash>.<project>.pages.dev) are different origins the frame never runs on.
// The production sandbox host is also matched by name, so a build that is
// missing VITE_SANDBOX_ORIGIN (e.g. env vars not set on the sandbox project)
// still fails closed. Keep it in sync with `frame-src` in public/_headers.
//
// Pure, so it runs in the unit tier.

import { allowedParentOrigins } from './frameProtocol';
import { parseSandboxOrigin } from './engineSandboxSetting';

/** The production sandbox host and where it sends visitors when the build
 *  carries no VITE_APP_ORIGIN. */
const PRODUCTION_SANDBOX_ORIGIN = 'https://partwright-sandbox.pages.dev';
const PRODUCTION_APP_ORIGIN = 'https://www.partwrightstudio.com';

export type SandboxHostAction =
  | { kind: 'redirect'; url: string }
  /** On the sandbox host with no app origin to send the visitor to. */
  | { kind: 'block' };

/** What entry.ts should do instead of booting the app, or null to boot it.
 *  `href` is the current location; `sandboxOrigin` / `appOrigins` are the raw
 *  build env values (VITE_SANDBOX_ORIGIN / VITE_APP_ORIGIN). */
export function sandboxHostAction(
  href: string,
  sandboxOrigin: unknown,
  appOrigins: unknown,
): SandboxHostAction | null {
  let here: URL;
  try {
    here = new URL(href);
  } catch {
    return null;
  }
  const isProduction = here.origin === PRODUCTION_SANDBOX_ORIGIN;
  if (here.origin !== parseSandboxOrigin(sandboxOrigin) && !isProduction) return null;
  // allowedParentOrigins adds its first argument; pass '' so only the
  // configured list comes back, then never "redirect" to this host itself.
  const [configured] = [...allowedParentOrigins('', appOrigins)].filter(o => o !== here.origin);
  const app = configured ?? (isProduction ? PRODUCTION_APP_ORIGIN : undefined);
  if (!app) return { kind: 'block' };
  return { kind: 'redirect', url: app + here.pathname + here.search + here.hash };
}
