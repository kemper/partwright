// Read-side helpers for the Diagnostic Log as an agent-facing API
// (`partwright.getDiagnosticLog`, the AI `getDiagnosticLog` tool): filter the
// ring buffer by level/source, cap the count, and REDACT anything that looks
// like a credential before it leaves the app.
//
// Why redaction: log entries are free text built from intercepted
// console.warn/error, uncaught errors, toasts and provider failures. Those can
// echo a request URL (`…?key=AIza…` for Gemini), an `Authorization: Bearer …`
// header, or a pasted API key. The log is the user's own data, but handing it
// to an AI provider (or an external agent) must never ship a secret along.
//
// Pure (no DOM, no storage), so it lives in the unit tier.

import type { ErrorLevel, ErrorSource, LogEntry } from './errorLog';

export const REDACTED = '[REDACTED]';

/** Query-string / form parameter names whose value is a credential. Matched
 *  case-insensitively as a whole parameter name. */
const SECRET_PARAM_NAMES = [
  'key', 'api_key', 'apikey', 'api-key', 'x-api-key', 'x-goog-api-key',
  'token', 'access_token', 'id_token', 'refresh_token', 'auth', 'auth_token',
  'secret', 'client_secret', 'password', 'passwd', 'pwd', 'signature', 'sig',
  'x-amz-signature', 'x-amz-credential', 'x-amz-security-token', 'session_token',
];

/** Header / JSON field names whose value is a credential. */
const SECRET_FIELD_NAMES = [
  'authorization', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'api-key',
  'apikey', 'api_key', 'apiKey', 'anthropic-api-key', 'openai-api-key', 'access_token',
  'accessToken', 'refresh_token', 'refreshToken', 'client_secret', 'clientSecret',
  'secret', 'password', 'token', 'cookie', 'set-cookie',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// name=value in a query string / form body / free text. The name must start
// the string or follow a delimiter (so `monkey=` never matches `key=`).
const PARAM_RE = new RegExp(
  `(^|[?&;#\\s,(])((?:${SECRET_PARAM_NAMES.map(escapeRe).join('|')})=)[^&#\\s"'<>]+`,
  'gi',
);

// scheme://user:password@host — URL userinfo; also a bare long token as the
// whole userinfo (scheme://TOKEN@host).
const USERINFO_RE = /(\b[a-z][a-z0-9+.-]*:\/\/)(?:[^\s/@:"'<>]+:[^\s/@"'<>]+|[^\s/@:"'<>]{16,})@/gi;

const FIELD_ALT = SECRET_FIELD_NAMES.map(escapeRe).join('|');
// "name": "value" / 'name': 'value' (JSON-ish; the value may contain escaped
// quotes).
const JSON_FIELD_RE = new RegExp(
  `((["'])(?:${FIELD_ALT})\\2\\s*:\\s*)(["'])((?:\\\\.|(?!\\3)[^\\\\])*)\\3`,
  'gi',
);
// \"name\": \"value\" — the same, inside a JSON string that was itself
// stringified (a request body echoed into an error message).
const ESCAPED_JSON_FIELD_RE = new RegExp(
  `((\\\\["'])(?:${FIELD_ALT})\\2\\s*:\\s*)(\\\\["'])(.*?)\\3`,
  'gi',
);

// name: value  /  name=value  (header-ish, to end of line or a delimiter)
const HEADER_FIELD_RE = new RegExp(
  `(\\b(?:${FIELD_ALT})\\s*[:=]\\s*)(?!\\[REDACTED\\])(?:(?:Bearer|Basic|Token)\\s+)?[^\\s,;"'}\\]]+`,
  'gi',
);

// Before a short, generic prefix (`sk-`, `hf_`) require a non-alphanumeric
// character — or a URL-encoded `=` / quote / space — so `task-…` / `disk-…`
// words survive while `key%3Dsk-…` is still caught. Distinctive prefixes
// (AIza, sk-ant-, ghp_, xoxb-, AKIA, eyJ…) need no boundary at all.
const SOFT_BOUNDARY = '(?<=^|[^A-Za-z0-9]|%3[Dd]|%22|%27|%20)';

/** Well-known credential shapes, redacted wherever they appear. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,                                  // bearer tokens
  /sk-ant-[A-Za-z0-9_-]{10,}/g,                                           // Anthropic
  new RegExp(`${SOFT_BOUNDARY}sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}`, 'g'), // OpenAI-style
  /AIza[0-9A-Za-z_-]{30,}/g,                                              // Google API keys
  /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,                            // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,                                        // Slack
  new RegExp(`${SOFT_BOUNDARY}hf_[A-Za-z0-9]{20,}`, 'g'),                 // Hugging Face
  /AKIA[0-9A-Z]{16}(?![0-9A-Z])/g,                                        // AWS access key id
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,      // JWT
];

/** Secrets the app actually holds (the user's saved provider API keys,
 *  registered by src/ai/db.ts as keys are loaded or saved). Redacted verbatim
 *  and URL-encoded, whatever their shape — a custom endpoint's key may match
 *  none of the patterns above. In-memory only, never persisted. */
const knownSecrets = new Set<string>();
/** Shorter values are too likely to collide with ordinary text. */
const MIN_KNOWN_SECRET_LENGTH = 8;

export function registerKnownSecret(value: string | null | undefined): void {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v.length >= MIN_KNOWN_SECRET_LENGTH) knownSecrets.add(v);
}

export function forgetKnownSecret(value: string | null | undefined): void {
  if (typeof value === 'string') knownSecrets.delete(value.trim());
}

/** Replace anything that looks like a secret in `text` with `[REDACTED]`:
 *  the app's known secrets (saved API keys), credential-named URL parameters,
 *  URL userinfo, credential-named header / JSON fields (Authorization,
 *  x-api-key, apiKey, …), and well-known key formats (sk-…, sk-ant-…, AIza…,
 *  GitHub / Slack / HF tokens, AWS key ids, JWTs). Conservative by design: a
 *  false positive only hides a harmless string. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  // Longest first, so a saved key that contains another saved key is replaced
  // whole rather than leaving its tail behind.
  for (const s of [...knownSecrets].sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(REDACTED);
    const enc = encodeURIComponent(s);
    if (enc !== s) out = out.split(enc).join(REDACTED);
  }
  out = out.replace(PARAM_RE, `$1$2${REDACTED}`);
  out = out.replace(USERINFO_RE, `$1${REDACTED}@`);
  out = out.replace(ESCAPED_JSON_FIELD_RE, `$1$3${REDACTED}$3`);
  out = out.replace(JSON_FIELD_RE, `$1$3${REDACTED}$3`);
  out = out.replace(HEADER_FIELD_RE, `$1${REDACTED}`);
  for (const re of TOKEN_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

export interface DiagnosticLogQuery {
  /** Keep only these levels (one level or a list). Omit for all. */
  level?: ErrorLevel | ErrorLevel[];
  /** Keep only these sources (one source or a list). Omit for all. */
  source?: ErrorSource | ErrorSource[];
  /** Max entries to return, newest first. */
  limit: number;
}

export interface DiagnosticLogEntryOut {
  id: string;
  /** ISO-8601 timestamp. */
  time: string;
  level: ErrorLevel;
  source: ErrorSource;
  message: string;
  detail?: string;
}

// Keyed by the ErrorLevel / ErrorSource unions with `satisfies`, so adding a
// level or source to errorLog.ts fails the type-check until it's listed here
// (and so reaches the API validator and the AI tool's enum).
const LEVEL_KEYS = { error: true, warn: true, info: true } satisfies Record<ErrorLevel, true>;
const SOURCE_KEYS = {
  engine: true, ai: true, import: true, export: true, storage: true, network: true,
  reconstruct: true, app: true, character: true, assembly: true, parts: true, uncaught: true,
} satisfies Record<ErrorSource, true>;
export const LOG_LEVELS = Object.keys(LEVEL_KEYS) as readonly ErrorLevel[];
export const LOG_SOURCES = Object.keys(SOURCE_KEYS) as readonly ErrorSource[];

/** Filter + cap + redact log entries (`entries` is newest-first, as the store
 *  keeps them). Returns the selection and how many matched in total. */
export function queryDiagnosticLog(
  entries: readonly LogEntry[],
  q: DiagnosticLogQuery,
): { entries: DiagnosticLogEntryOut[]; matched: number; total: number } {
  const levels = q.level === undefined ? null : new Set(Array.isArray(q.level) ? q.level : [q.level]);
  const sources = q.source === undefined ? null : new Set(Array.isArray(q.source) ? q.source : [q.source]);
  const matching = entries.filter(e => (!levels || levels.has(e.level)) && (!sources || sources.has(e.source)));
  const picked = matching.slice(0, Math.max(0, q.limit));
  return {
    entries: picked.map(e => ({
      id: e.id,
      time: new Date(e.timestamp).toISOString(),
      level: e.level,
      source: e.source,
      message: redactSecrets(e.message),
      ...(e.detail ? { detail: redactSecrets(e.detail) } : {}),
    })),
    matched: matching.length,
    total: entries.length,
  };
}
