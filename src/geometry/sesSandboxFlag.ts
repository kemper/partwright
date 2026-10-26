// Main-thread side of the SES model-code sandbox (#1127; sesSandbox.ts).
//
// SES is ON by default: every engine Worker (the editor's geometry Worker, the
// Assembly/export pool, and the #1110 iframe-sandbox Worker) runs `lockdown()`
// before its engines initialise and evaluates model code in a fresh
// Compartment per run. The kill switch turns it off for this browser profile:
//
//   localStorage.setItem('partwright.sesSandbox', 'off')   // or '0' / 'false'
//   VITE_SES_SANDBOX=0 npm run dev                          // build/dev default
//
// localStorage wins over the env default (so a dev who built with the env off
// can turn it back on with 'on'). Off behaves exactly like before #1127: the
// Worker never loads `ses`, model code is compiled with `new Function`.
//
// The setting rides on the Worker's `init` message (`ses: boolean`). The
// Worker treats a missing field as ON, so a Worker can only run without SES
// when the trusted app explicitly asked for it.

const KEY = 'partwright.sesSandbox';

/** Result of reading the flag. `'test-fail'` (dev builds only) makes the Worker
 *  act as if `lockdown()` threw, to exercise the fail-closed path end to end. */
export type SesFlag = 'on' | 'off' | 'test-fail';

/** Parse a flag value. Unknown / empty values mean "no opinion" (null). Pure —
 *  unit-tested. */
export function parseSesFlagValue(raw: unknown, allowTestFail: boolean): SesFlag | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false' || v === 'no') return 'off';
  if (v === 'on' || v === '1' || v === 'true' || v === 'yes') return 'on';
  if (v === 'test-fail' && allowTestFail) return 'test-fail';
  return null;
}

/** Resolve the effective flag from the per-profile override and the build
 *  default. Pure — unit-tested. */
export function resolveSesFlag(stored: unknown, envDefault: unknown, allowTestFail: boolean): SesFlag {
  return parseSesFlagValue(stored, allowTestFail) ?? parseSesFlagValue(envDefault, false) ?? 'on';
}

function readFlag(): SesFlag {
  let stored: string | null = null;
  try { stored = globalThis.localStorage?.getItem(KEY) ?? null; } catch { /* private mode */ }
  const env = import.meta.env?.VITE_SES_SANDBOX as unknown;
  return resolveSesFlag(stored, env, import.meta.env?.DEV === true);
}

/** The engine Worker's `init` message. */
export function engineInitMessage(): { type: 'init'; ses: boolean; sesTestFail?: true } {
  const flag = readFlag();
  if (flag === 'test-fail') return { type: 'init', ses: true, sesTestFail: true };
  return { type: 'init', ses: flag === 'on' };
}
