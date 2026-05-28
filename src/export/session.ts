// Session JSON + raw code exports

import { exportSession, getState, type ExportedSession, type ExportOptions } from '../storage/sessionManager';
import { downloadBlob } from './download';
import type { BuiltExport } from './gltf';

/** Sanitize a session name into a filename-safe slug. Falls back to "session". */
function slugify(name: string): string {
  const slug = name
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return slug || 'session';
}

export interface BuiltSessionExport extends BuiltExport {
  /** The parsed session data — convenient for AI callers that want the JSON directly. */
  data: ExportedSession;
}

/** Build a `.partwright.json` blob for the current (or specified) session. */
export async function buildSessionJSON(
  sessionId?: string,
  options?: ExportOptions,
): Promise<BuiltSessionExport | null> {
  const data = await exportSession(sessionId, options);
  if (!data) return null;
  const mimeType = 'application/json';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: mimeType });
  return {
    blob,
    filename: `${slugify(data.session.name)}.partwright.json`,
    mimeType,
    data,
  };
}

/**
 * Export the current (or specified) session as a `.partwright.json` file.
 * Returns true if a download was triggered, false if no session was available.
 */
export async function exportSessionJSON(
  sessionId?: string,
  options?: ExportOptions,
): Promise<boolean> {
  const built = await buildSessionJSON(sessionId, options);
  if (!built) return false;
  downloadBlob(built.blob, built.filename, 'Session JSON');
  return true;
}

export interface BuiltCodeExport extends BuiltExport {
  text: string;
  language: 'manifold-js' | 'scad' | 'replicad';
}

/** Build the raw code blob for the editor source. */
export function buildRawCode(code: string, language: 'manifold-js' | 'scad' | 'replicad'): BuiltCodeExport {
  // BREP/replicad sessions are JavaScript on disk (they use api.BREP.*) so
  // they share the .js extension with manifold-js. The session JSON carries
  // the language metadata that recovers the engine choice on re-import.
  const ext = language === 'scad' ? 'scad' : 'js';
  const state = getState();
  let base = state.session?.name ?? 'code';
  if (state.currentVersion?.label) base += `_${state.currentVersion.label}`;
  const mimeType = 'text/plain';
  const blob = new Blob([code], { type: mimeType });
  return {
    blob,
    filename: `${slugify(base)}.${ext}`,
    mimeType,
    text: code,
    language,
  };
}

/**
 * Export the editor's current code as a plain `.js` or `.scad` file.
 * Uses the active session/version for the filename when available.
 */
export function exportRawCode(code: string, language: 'manifold-js' | 'scad' | 'replicad'): void {
  const built = buildRawCode(code, language);
  downloadBlob(built.blob, built.filename, 'Code');
}
