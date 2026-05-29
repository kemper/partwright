// Pure summarization of a `.partwright.json` payload for the import-preview
// modal. Kept DOM-free (no modalShell/document/escapeHtml imports) so the
// logic — especially modeling-language resolution — can be unit-tested
// directly, mirroring how languageFallback.ts was split out.

import type { ExportedSession } from '../storage/sessionManager';
import { effectiveVersionLanguage, asLanguage, type Language } from '../storage/languageFallback';

export interface SessionImportSummary {
  sessionName: string;
  schemaVersion: string;
  versionCount: number;
  noteCount: number;
  annotationCount: number;
  referenceSides: string[];
  /**
   * Distinct modeling languages present across the file's versions, in
   * first-seen order. Each is resolved through the per-version → session →
   * default fallback chain (the same one openSession uses), then sanitized so
   * a junk on-disk value can't leak through. A session created as manifold-js
   * and later switched to another engine per-version (e.g. voxel) carries the
   * engine on `versions[].language`, NOT at the session level — so this
   * resolves to ['voxel'], matching the engine the editor lands on after
   * import. Reading `session.language` alone (the old behavior) wrongly
   * reported "manifold-js" for those sessions.
   */
  languages: Language[];
  createdAt: number | null;
  updatedAt: number | null;
}

/** Build a SessionImportSummary from a parsed .partwright.json payload. */
export function summarizeSessionImport(data: ExportedSession): SessionImportSummary {
  // Build a list of image labels for the import preview. Handle three shapes:
  //   - current: array of {id, src, label?}
  //   - pre-unification: array of {id, angle, src, label?} — fall back to angle
  //   - pre-array: object map {front: 'url', ...} — use the keys
  // Items with no label and no angle are listed as "(unlabeled)".
  const imgs = data.session.images ?? data.session.referenceImages ?? null;
  const referenceSides: string[] = [];
  if (Array.isArray(imgs)) {
    for (const item of imgs) {
      const it = item as { label?: string; angle?: string };
      const label = (it.label ?? '').trim() || (it.angle ? it.angle : '');
      referenceSides.push(label || '(unlabeled)');
    }
  } else if (imgs && typeof imgs === 'object') {
    for (const k of ['front', 'right', 'back', 'left', 'top', 'perspective'] as const) {
      if ((imgs as Record<string, unknown>)[k]) referenceSides.push(k);
    }
  }
  // Annotations live per-version since schema 1.3, but 1.2 files put them at
  // the top level. Sum across both locations so the preview is accurate
  // regardless of which schema the file was exported with. Versions can be
  // absent for chat/notes-only exports — fall back to an empty list.
  const versions = Array.isArray(data.versions) ? data.versions : [];
  const perVersionAnnotations = versions.reduce(
    (sum, v) => sum + (v.annotations?.length ?? 0),
    0,
  );
  const topLevelAnnotations = data.annotations?.length ?? 0;

  // Resolve the modeling language(s). The old code read only
  // `data.session.language`, which is stale for sessions that were created as
  // manifold-js and later switched to another engine per-version (the engine
  // is recorded on versions[].language, not at the session level). Resolve
  // each version through the canonical fallback chain — sanitizing both inputs
  // through asLanguage so a junk on-disk value (e.g. "python") can't leak —
  // and collect the distinct set in first-seen order.
  const sessionLanguage = asLanguage(data.session.language);
  const languages: Language[] = [];
  for (const v of versions) {
    const lang = effectiveVersionLanguage(
      { language: asLanguage(v.language) },
      { language: sessionLanguage },
    );
    if (!languages.includes(lang)) languages.push(lang);
  }
  // No versions (chat/notes-only export): fall back to the session-level hint.
  if (languages.length === 0) {
    languages.push(effectiveVersionLanguage(null, { language: sessionLanguage }));
  }

  return {
    sessionName: data.session.name || '(unnamed)',
    schemaVersion: data.partwright ?? data.mainifold ?? 'unknown',
    versionCount: versions.length,
    noteCount: data.notes?.length ?? 0,
    annotationCount: perVersionAnnotations + topLevelAnnotations,
    referenceSides,
    languages,
    createdAt: data.session.created ?? null,
    updatedAt: data.session.updated ?? null,
  };
}
