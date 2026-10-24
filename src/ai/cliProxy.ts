// CLIProxyAPI helpers — pure logic shared by the Custom tab's bridge setup,
// the saved-endpoints store, and the Custom provider's error reporting.
//
// CLIProxyAPI (https://github.com/router-for-me/CLIProxyAPI) is a small local
// bridge that turns a Claude / ChatGPT-Codex / Gemini subscription into an
// OpenAI-compatible endpoint on localhost:8317. Two things about it shape
// what's here:
//
//   1. It refuses to start while its config still holds the template
//      `your-api-key-N` keys, so setting a key is a required setup step. The
//      command we hand the user APPENDS the endpoint's key to `api-keys` and
//      drops only the template placeholders — every other key already there
//      stays, so a second browser (or an earlier setup) keeps working. The
//      old one-liner replaced every Partwright key with a new one, which
//      silently 401'd every other browser that had connected before.
//   2. Its subscription login (`--claude-login` etc.) expires or gets revoked
//      independently of the API key. When that happens requests fail with
//      bridge/upstream auth errors that look nothing like "log in again", so
//      we recognize them and say which login command to run.
//
// No DOM, no IndexedDB — unit-tested in tests/unit/cliProxy.test.ts (which
// also runs the generated awk script against sample configs).

/** CLIProxyAPI's default OpenAI-compatible base URL. */
export const CLI_PROXY_DEFAULT_BASE_URL = 'http://localhost:8317/v1';
/** Where CLIProxyAPI serves its status / config-error page. */
export const CLI_PROXY_STATUS_URL = 'http://localhost:8317';
export const CLI_PROXY_REPO_URL = 'https://github.com/router-for-me/CLIProxyAPI';

/** A strong random API key, generated in the browser. Prefixed so it's
 *  recognizable in a config file; the hex body has no shell/YAML
 *  metacharacters, so it drops safely into the generated commands. */
export function generateApiKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'pw-' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** True when `key` can be embedded in the generated shell command as-is:
 *  single-quoted for the shell and double-quoted in YAML, so no quotes,
 *  backslashes, `$` or whitespace. Keys outside this set get a manual
 *  instruction instead of a command. */
export function isCommandSafeKey(key: string): boolean {
  return /^[A-Za-z0-9._~+/=:@-]+$/.test(key);
}

export type BridgeOs = 'mac' | 'windows' | 'other';

export function detectBridgeOs(): BridgeOs {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const hay = `${nav?.userAgent ?? ''} ${(nav as { platform?: string } | null)?.platform ?? ''}`.toLowerCase();
  if (hay.includes('mac')) return 'mac';
  if (hay.includes('win')) return 'windows';
  return 'other';
}

/** The bridge's command name: Homebrew installs `cliproxyapi`; the release
 *  binaries (Windows, Linux) are `cli-proxy-api`. */
export function bridgeBinary(os: BridgeOs): string {
  return os === 'mac' ? 'cliproxyapi' : 'cli-proxy-api';
}

/** Default config path per OS. macOS is the Homebrew formula's config; the
 *  release binary reads `config.yaml` from its own folder. */
export function defaultConfigPath(os: BridgeOs): string {
  return os === 'mac' ? '$(brew --prefix)/etc/cliproxyapi.conf' : './config.yaml';
}

/** Shell-quote a config path. The Homebrew default stays double-quoted so
 *  `$(brew --prefix)` expands; anything the user typed is single-quoted. */
function quotePath(path: string): string {
  if (path.startsWith('$(brew --prefix)')) return `"${path}"`;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

/** awk program that appends `k` to the `api-keys:` list. Keeps every key
 *  already there, drops the `your-api-key-N` template lines (which stop the
 *  bridge from starting), matches the list's existing indentation, turns
 *  `api-keys: []` into a block list, and adds the section when the config
 *  has none. Blank/comment lines that trail the list stay after the new key.
 *  Contains no single quotes, so it can sit inside '…' in the shell. */
export const APPEND_KEY_AWK = [
  'function ind(){match($0,/^[ \\t]*/);return substr($0,1,RLENGTH)}',
  'function add(){if(!done)print (hl?li:ki "  ") "- \\"" k "\\"";done=1;printf "%s",b;b=""}',
  '{if(!seen&&$0~/^[ \\t]*api-keys:[ \\t]*(\\[\\])?[ \\t]*$/){seen=1;inb=1;ki=ind();sub(/[ \\t]*\\[\\][ \\t]*$/,"");print;next}',
  'if(inb){if($0~/^[ \\t]*-[ \\t]*.?your-api-key-[0-9]+.?[ \\t]*$/){if(!hl){li=ind();hl=1}next}',
  'if($0~/^[ \\t]*-/){li=ind();hl=1;printf "%s",b;b="";print;next}',
  'if($0~/^[ \\t]*(#.*)?$/){b=b $0 "\\n";next}',
  'add();inb=0}',
  'print}',
  'END{if(inb)add();if(!seen){print "api-keys:";add()}}',
].join('');

/** awk program that prints each key under `api-keys:`, one per line. */
export const LIST_KEYS_AWK =
  '/^[ \\t]*api-keys:/{f=1;next} f&&/^[ \\t]*-/{s=$0;sub(/^[ \\t]*-[ \\t]*/,"",s);sub(/[ \\t]+#.*$/,"",s);gsub(/["\\047 \\t]/,"",s);print s;next} f&&/^[ \\t]*[^ \\t#]/{f=0}';

/** One-liner that adds `key` to the bridge config (idempotent: a key that's
 *  already there is left alone) and, on macOS, restarts the service. Null
 *  when the key or OS can't be scripted safely — show manualAddKeyText. */
export function addKeyCommand(key: string, os: BridgeOs, configPath?: string): string | null {
  if (os === 'windows' || !isCommandSafeKey(key)) return null;
  const cfg = quotePath((configPath ?? '').trim() || defaultConfigPath(os));
  const restart = os === 'mac' ? '; brew services restart cliproxyapi' : '';
  return `CFG=${cfg}; KEY='${key}'; if grep -qF -- "$KEY" "$CFG"; then echo "Key already in $CFG"; else awk -v k="$KEY" '${APPEND_KEY_AWK}' "$CFG" > "$CFG.pw-tmp" && cat "$CFG.pw-tmp" > "$CFG" && rm -f "$CFG.pw-tmp" && echo "Added the key to $CFG"; fi${restart}`;
}

/** Command that prints the keys the bridge accepts, so a second browser (or
 *  one whose site data was cleared) can reuse one instead of adding another. */
export function listKeysCommand(os: BridgeOs, configPath?: string): string | null {
  if (os === 'windows') return null;
  const cfg = quotePath((configPath ?? '').trim() || defaultConfigPath(os));
  return `awk '${LIST_KEYS_AWK}' ${cfg}`;
}

/** Manual fallback for Windows / keys the command can't carry. */
export function manualAddKeyText(key: string): string {
  return `Open the config file named on the status page (${CLI_PROXY_STATUS_URL}). Under api-keys:, delete any your-api-key-N lines and add this line, indented like the others: - "${key}". Keep any other keys that are there. Then stop and re-run cli-proxy-api.`;
}

/** Which subscription a model id is served by, for picking the login flag. */
export type BridgeFamily = 'claude' | 'codex' | 'gemini';

export function modelFamily(model: string): BridgeFamily | null {
  const m = model.trim().toLowerCase();
  if (!m) return null;
  if (m.startsWith('claude')) return 'claude';
  if (/^(gpt|o\d|codex)/.test(m) || m.includes('codex')) return 'codex';
  if (m.startsWith('gemini')) return 'gemini';
  return null;
}

const FAMILY_LABEL: Record<BridgeFamily, string> = {
  claude: 'Claude',
  codex: 'ChatGPT/Codex',
  gemini: 'Gemini',
};

const LOGIN_FLAG: Record<BridgeFamily, string> = {
  claude: '--claude-login',
  codex: '--codex-login',
  gemini: '--login',
};

/** The login command for a model's subscription (Claude when unknown — the
 *  bridge's main use here). */
export function loginCommand(model: string, os: BridgeOs = detectBridgeOs()): string {
  return `${bridgeBinary(os)} ${LOGIN_FLAG[modelFamily(model) ?? 'claude']}`;
}

export type BridgeErrorKind =
  /** The bridge rejected Partwright's API key (its own access check). */
  | 'bridge-key'
  /** The bridge has no working subscription login for the model. */
  | 'subscription-auth';

/** The bridge's own key check answers "Missing API key" / "Invalid API key". */
const BRIDGE_KEY_RE = /\b(invalid|missing) api key\b/i;
/** Signals that the subscription side lost its auth: CLIProxyAPI's
 *  "no auth available" family (auth_not_found / auth_unavailable), its
 *  "unknown provider for model" (no credential registered the model), and
 *  upstream OAuth failures the bridge passes through (Anthropic's
 *  "OAuth token has expired", authentication_error, invalid_grant, …). */
const SUBSCRIPTION_AUTH_RE = /auth_not_found|auth_unavailable|no (?:available )?auth(?: available)?\b|unknown provider for model|oauth[^"]{0,40}(?:expired|invalid|revoked|not supported)|token (?:has )?expired|invalid_grant|refresh[_ ]token|authentication_error|not logged in|please (?:log ?in|login|re-?authenticate|reauthenticate)|re-?login|credentials? (?:expired|invalid|not found)/i;

/** Classify an error message from the Custom provider. Null = not an auth
 *  problem we can explain. The bridge's own key check wins: its message is
 *  unambiguous, and the fix (add the key to the config) is different. */
export function classifyBridgeError(message: string): BridgeErrorKind | null {
  if (BRIDGE_KEY_RE.test(message)) return 'bridge-key';
  if (SUBSCRIPTION_AUTH_RE.test(message)) return 'subscription-auth';
  return null;
}

/** True for errors that mean "the subscription login is gone" — never worth
 *  a blind retry, since the bridge will answer the same until the user logs
 *  in again (CLIProxyAPI reports some of these as 500s). */
export function isSubscriptionAuthError(message: string): boolean {
  return classifyBridgeError(message) === 'subscription-auth';
}

/** One-paragraph explanation + fix for a lost subscription login. */
export function loginHint(model: string, os: BridgeOs = detectBridgeOs()): string {
  const fam = FAMILY_LABEL[modelFamily(model) ?? 'claude'];
  return `This looks like your CLIProxyAPI bridge lost its ${fam} subscription login (it expired, was revoked, or never finished). Run \`${loginCommand(model, os)}\` in a terminal, complete the browser sign-in, then retry. Your Partwright API key doesn't need to change.`;
}

/** Look at the model list a bridge advertised and say whether it looks
 *  signed out. CLIProxyAPI only lists models it has a working login for, so
 *  an empty list (or one missing the family of the model the user picked)
 *  is the earliest, cheapest signal that a login is needed. Null = fine. */
export function diagnoseBridgeModels(ids: string[], wantedModel: string, os: BridgeOs = detectBridgeOs()): { text: string; command: string } | null {
  if (ids.length === 0) {
    return {
      text: 'The bridge is running but offers no models, so it isn\'t signed in to a subscription yet. Run this (or --codex-login for ChatGPT/Codex), then Connect again:',
      command: loginCommand('claude', os),
    };
  }
  const fam = modelFamily(wantedModel);
  if (fam && !ids.some(id => modelFamily(id) === fam)) {
    return {
      text: `The bridge offers no ${FAMILY_LABEL[fam]} models, so its ${FAMILY_LABEL[fam]} login is probably missing or expired. Run this, then Connect again:`,
      command: loginCommand(wantedModel, os),
    };
  }
  return null;
}

/** Pick a sensible default from a freshly fetched list: the only model, else
 *  the newest Claude Opus, then Sonnet, then the first id. Lists arrive
 *  sorted numerically, so "newest" is the last match. */
export function pickDefaultModel(ids: string[]): string {
  if (ids.length === 0) return '';
  if (ids.length === 1) return ids[0];
  const last = (re: RegExp) => [...ids].reverse().find(id => re.test(id));
  return last(/^claude-opus/i) ?? last(/^claude-sonnet/i) ?? last(/^claude/i) ?? ids[0];
}

/** True for a base URL that points at a CLIProxyAPI default (port 8317). */
export function looksLikeCliProxyUrl(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]):8317(\/|$)/i.test(baseUrl.trim());
}

/** CLIProxyAPI-only phrasings — enough on their own to know the endpoint is
 *  a bridge, whatever its URL. */
const BRIDGE_SPECIFIC_RE = /auth_not_found|auth_unavailable|no (?:available )?auth(?: available)?\b|unknown provider for model/i;

/** The sentence to append to a Custom-provider error, or null when it isn't
 *  an auth problem we can explain. Confident for a bridge (port 8317, or an
 *  error only CLIProxyAPI produces); hedged for any other endpoint, which
 *  may be a remote bridge — or something else entirely. */
export function bridgeErrorHint(message: string, baseUrl: string, model: string, os: BridgeOs = detectBridgeOs()): string | null {
  const kind = classifyBridgeError(message);
  if (!kind) return null;
  const sure = looksLikeCliProxyUrl(baseUrl) || BRIDGE_SPECIFIC_RE.test(message);
  if (kind === 'subscription-auth') {
    return sure ? loginHint(model, os) : `If this endpoint is a CLIProxyAPI bridge: ${loginHint(model, os)}`;
  }
  // The bridge's own key check. Only worth a bridge-specific hint when it is
  // one — other servers' "invalid API key" already says what to fix.
  return sure
    ? 'The bridge doesn\'t accept this API key. In AI Settings → Custom, run the endpoint\'s step 2 command — it adds this key to the bridge config without removing any others.'
    : null;
}
