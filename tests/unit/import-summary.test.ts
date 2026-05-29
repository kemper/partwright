import { describe, it, expect } from 'vitest';
import { summarizeSessionImport } from '../../src/ui/importSummary';
import type { ExportedSession } from '../../src/storage/sessionManager';

type V = ExportedSession['versions'][number];

/** Build a single exported version, optionally tagged with a language and a
 *  count of (dummy) annotations. `language` accepts junk on purpose so we can
 *  exercise the sanitize-on-read path. */
function version(language?: string, annotationCount = 0): V {
  return {
    label: 'v',
    code: 'return 1;',
    timestamp: 0,
    ...(language ? { language: language as V['language'] } : {}),
    ...(annotationCount
      ? { annotations: Array.from({ length: annotationCount }, () => ({})) as unknown as V['annotations'] }
      : {}),
  };
}

/** Build a minimal ExportedSession payload, overriding only what a test cares
 *  about. */
function payload(over: {
  partwright?: string;
  mainifold?: string;
  session?: Partial<ExportedSession['session']>;
  notes?: ExportedSession['notes'];
  versions?: ExportedSession['versions'];
  annotations?: ExportedSession['annotations'];
} = {}): ExportedSession {
  const { session, versions, ...rest } = over;
  return {
    partwright: '1.8',
    session: { name: 'Test', created: 1, updated: 2, ...session },
    versions: versions ?? [],
    ...rest,
  };
}

describe('summarizeSessionImport — language resolution', () => {
  it('reports the per-version language even when the session-level field is absent (the voxel bug)', () => {
    // A session created as manifold-js and switched to voxel carries the
    // engine on versions[].language, not at the session level.
    const summary = summarizeSessionImport(payload({ versions: [version('voxel'), version('voxel')] }));
    expect(summary.languages).toEqual(['voxel']);
  });

  it('prefers the per-version language over a stale session-level language', () => {
    const summary = summarizeSessionImport(
      payload({ session: { language: 'manifold-js' }, versions: [version('voxel')] }),
    );
    expect(summary.languages).toEqual(['voxel']);
  });

  it('collects distinct languages across mixed-engine versions in first-seen order', () => {
    const summary = summarizeSessionImport(
      payload({ versions: [version(), version('voxel')] }),
    );
    // version() has no language ⇒ falls back to session (absent) ⇒ default.
    expect(summary.languages).toEqual(['manifold-js', 'voxel']);
  });

  it('de-dups repeated languages while preserving order', () => {
    const summary = summarizeSessionImport(
      payload({ versions: [version('scad'), version('replicad'), version('scad')] }),
    );
    expect(summary.languages).toEqual(['scad', 'replicad']);
  });

  it('falls back to the session-level language when there are no versions', () => {
    const summary = summarizeSessionImport(payload({ session: { language: 'voxel' }, versions: [] }));
    expect(summary.languages).toEqual(['voxel']);
  });

  it('falls back to manifold-js when neither version nor session carries a language', () => {
    const summary = summarizeSessionImport(payload({ versions: [] }));
    expect(summary.languages).toEqual(['manifold-js']);
  });

  it('sanitizes a junk on-disk language, falling through to the session level', () => {
    const summary = summarizeSessionImport(
      payload({ session: { language: 'voxel' }, versions: [version('python')] }),
    );
    expect(summary.languages).toEqual(['voxel']);
  });

  it('sanitizes a junk on-disk language down to the default when nothing else applies', () => {
    const summary = summarizeSessionImport(payload({ versions: [version('python')] }));
    expect(summary.languages).toEqual(['manifold-js']);
  });
});

describe('summarizeSessionImport — other fields', () => {
  it('summarizes the core counts and metadata', () => {
    const summary = summarizeSessionImport(
      payload({
        session: { name: 'My Part' },
        notes: [{}, {}] as unknown as ExportedSession['notes'],
        versions: [version('voxel', 2), version('voxel', 1)],
      }),
    );
    expect(summary.sessionName).toBe('My Part');
    expect(summary.versionCount).toBe(2);
    expect(summary.noteCount).toBe(2);
    expect(summary.annotationCount).toBe(3); // 2 + 1 per-version
    expect(summary.schemaVersion).toBe('1.8');
  });

  it('falls back to "(unnamed)" and the legacy mainifold schema field', () => {
    const summary = summarizeSessionImport(
      payload({ partwright: undefined, mainifold: '1.2', session: { name: '' } }),
    );
    expect(summary.sessionName).toBe('(unnamed)');
    expect(summary.schemaVersion).toBe('1.2');
  });

  it('counts top-level (schema 1.2) annotations alongside per-version ones', () => {
    const summary = summarizeSessionImport(
      payload({
        versions: [version('manifold-js', 1)],
        annotations: [{}, {}] as unknown as ExportedSession['annotations'],
      }),
    );
    expect(summary.annotationCount).toBe(3); // 1 per-version + 2 top-level
  });
});
