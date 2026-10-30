// AI session-trace export: gathers one chat's persisted messages, the in-memory
// AI Call Log, and the ai-sourced Diagnostic Log entries, shapes them with the
// pure builder (src/ai/sessionTrace.ts), redacts secrets, and downloads the
// result as JSON. Shared by the 🩺 modal, the /trace slash command, and
// `partwright.getAiSessionTrace` / `downloadAiSessionTrace`.

import { listMessages, registerSavedKeysForRedaction, GLOBAL_CHAT_BUCKET } from '../ai/db';
import { listEvents } from '../ai/diagnostics';
import { loadSettings } from '../ai/settings';
import { buildActiveSystemPrompt } from '../ai/chatLoop';
import { buildSessionTrace, type SessionTrace } from '../ai/sessionTrace';
import { buildInfo } from '../buildInfo';
import { getConfig } from '../config/appConfig';
import { errorLog } from '../diagnostics/errorLog';
import { queryDiagnosticLog, redactSecrets } from '../diagnostics/logQuery';
import { getState } from '../storage/sessionManager';
import { downloadBlob, getExportFilename } from './download';

export interface AiTraceOptions {
  /** Chat bucket to trace. Defaults to the open session (or the pre-session
   *  global chat when none is open). */
  sessionId?: string;
  /** Embed base64 image data (attachments + tool renders). Default false. */
  includeImages?: boolean;
  /** Embed the full system prompt text. Default false (size only). */
  includeSystemPrompt?: boolean;
}

/** Redact secret-shaped substrings from every string in the trace, except
 *  base64 image payloads (`data` beside a `mediaType`), which can't hold a
 *  key and which a pattern could otherwise corrupt. Mutates in place. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = redactDeep(value[i]);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (k === 'data' && typeof obj[k] === 'string' && typeof obj.mediaType === 'string') continue;
      obj[k] = redactDeep(obj[k]);
    }
  }
  return value;
}

/** Build the trace for a chat. Resolves to `null` when the chat is empty. */
export async function collectAiSessionTrace(opts: AiTraceOptions = {}): Promise<SessionTrace | null> {
  const current = getState().session;
  const sessionId = opts.sessionId ?? current?.id ?? GLOBAL_CHAT_BUCKET;
  const messages = await listMessages(sessionId);
  if (messages.length === 0) return null;
  const name = sessionId === GLOBAL_CHAT_BUCKET ? null
    : current?.id === sessionId ? current.name : null;
  const toggles = loadSettings().toggles;
  let systemPrompt: string | null = null;
  try { systemPrompt = await buildActiveSystemPrompt(toggles); } catch { /* ai.md unavailable — size omitted */ }
  try { await registerSavedKeysForRedaction(); } catch { /* storage unavailable — pattern redaction still applies */ }
  const errors = queryDiagnosticLog(errorLog.getEntries(), { source: 'ai', limit: 200 }).entries;
  const trace = buildSessionTrace({
    messages,
    session: { id: sessionId, name },
    app: { version: buildInfo.version, commit: buildInfo.commit, buildTime: buildInfo.buildTime },
    toggles,
    systemPrompt,
    // Copy: redaction below mutates in place.
    callLog: structuredClone(listEvents()),
    errors,
    includeImages: opts.includeImages === true,
    includeSystemPrompt: opts.includeSystemPrompt === true,
    charsPerToken: getConfig().ai.charsPerToken,
  });
  return redactDeep(trace) as SessionTrace;
}

/** Collect the trace and download it as `<session>-ai-trace_<date>.json`.
 *  Resolves to the filename and size, or `null` when the chat is empty. */
export async function downloadAiSessionTrace(opts: AiTraceOptions = {}): Promise<{ filename: string; bytes: number; trace: SessionTrace } | null> {
  const trace = await collectAiSessionTrace(opts);
  if (!trace) return null;
  const json = JSON.stringify(trace, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const label = trace.session.name ?? (trace.session.id === GLOBAL_CHAT_BUCKET ? 'global' : trace.session.id);
  const filename = getExportFilename('json', `${label}-ai-trace`);
  downloadBlob(blob, filename, 'AI trace');
  return { filename, bytes: blob.size, trace };
}
