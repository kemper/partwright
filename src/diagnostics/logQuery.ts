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

const PARAM_RE = new RegExp(
  `([?&;#](?:${SECRET_PARAM_NAMES.map(escapeRe).join('|')})=)[^&#\\s"'<>]+`,
  'gi',
);

// "name": "value"  /  'name': 'value'  (JSON-ish)
const JSON_FIELD_RE = new RegExp(
  `((["'])(?:${SECRET_FIELD_NAMES.map(escapeRe).join('|')})\\2\\s*:\\s*)(["'])(?:(?!\\3).)*\\3`,
  'gi',
);

// name: value  /  name=value  (header-ish, to end of line or a delimiter)
const HEADER_FIELD_RE = new RegExp(
  `(\\b(?:${SECRET_FIELD_NAMES.map(escapeRe).join('|')})\\s*[:=]\\s*)(?!\\[REDACTED\\])(?:(?:Bearer|Basic|Token)\\s+)?[^\\s,;"'}\\]]+`,
  'gi',
);

/** Well-known credential shapes, redacted wherever they appear. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,              // bearer tokens
  /\bsk-ant-[A-Za-z0-9_-]{10,}/g,                     // Anthropic
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, // OpenAI-style
  /\bAIza[0-9A-Za-z_-]{30,}/g,                        // Google API keys
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,      // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                  // Slack
  /\bhf_[A-Za-z0-9]{20,}/g,                           // Hugging Face
  /\bAKIA[0-9A-Z]{16}\b/g,                            // AWS access key id
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];

/** Replace anything that looks like a secret in `text` with `[REDACTED]`:
 *  credential-named URL parameters, credential-named header / JSON fields
 *  (Authorization, x-api-key, apiKey, …), and well-known key formats
 *  (sk-…, sk-ant-…, AIza…, GitHub / Slack / HF tokens, AWS key ids, JWTs).
 *  Conservative by design: a false positive only hides a harmless string. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(PARAM_RE, `$1${REDACTED}`);
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

export const LOG_LEVELS: readonly ErrorLevel[] = ['error', 'warn', 'info'];
export const LOG_SOURCES: readonly ErrorSource[] = [
  'engine', 'ai', 'import', 'export', 'storage', 'network', 'reconstruct', 'app',
  'character', 'assembly', 'parts', 'uncaught',
];

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
