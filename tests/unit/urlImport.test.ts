import { describe, it, expect } from 'vitest';
import {
  parseImportUrlInput,
  filenameFromUrl,
  classifyRemoteResource,
  ensureExtensionForSource,
} from '../../src/import/urlImport';

describe('parseImportUrlInput', () => {
  it('rejects empty / whitespace input', () => {
    expect(parseImportUrlInput('').kind).toBe('invalid');
    expect(parseImportUrlInput('   ').kind).toBe('invalid');
  });

  it('treats a raw #share= fragment as a local share decode', () => {
    const r = parseImportUrlInput('#share=abc123');
    expect(r).toEqual({ kind: 'share', hash: 'abc123' });
  });

  it('rejects an empty share fragment', () => {
    expect(parseImportUrlInput('#share=').kind).toBe('invalid');
  });

  it('extracts the share hash from a full share URL regardless of scheme', () => {
    const r = parseImportUrlInput('https://www.partwrightstudio.com/editor#share=ZZZ');
    expect(r).toEqual({ kind: 'share', hash: 'ZZZ' });
  });

  it('routes a plain https file URL to the remote path', () => {
    const r = parseImportUrlInput('https://example.com/part.partwright.json');
    expect(r).toEqual({ kind: 'remote', url: 'https://example.com/part.partwright.json' });
  });

  it('accepts http (mixed-content is enforced separately by the browser)', () => {
    expect(parseImportUrlInput('http://example.com/a.stl').kind).toBe('remote');
  });

  it('rejects non-http(s) schemes (file:, data:, blob:, javascript:)', () => {
    expect(parseImportUrlInput('file:///etc/passwd').kind).toBe('invalid');
    expect(parseImportUrlInput('data:application/json,{}').kind).toBe('invalid');
    expect(parseImportUrlInput('blob:https://x/y').kind).toBe('invalid');
    expect(parseImportUrlInput('javascript:alert(1)').kind).toBe('invalid');
  });

  it('rejects a bare non-URL string', () => {
    expect(parseImportUrlInput('not a url').kind).toBe('invalid');
  });
});

describe('filenameFromUrl', () => {
  it('takes the last path segment', () => {
    expect(filenameFromUrl('https://x.com/a/b/part.stl')).toBe('part.stl');
  });
  it('decodes percent-encoding', () => {
    expect(filenameFromUrl('https://x.com/my%20part.json')).toBe('my part.json');
  });
  it('ignores query strings', () => {
    expect(filenameFromUrl('https://x.com/a.svg?token=xyz')).toBe('a.svg');
  });
  it('falls back to a generic name when there is no segment', () => {
    expect(filenameFromUrl('https://x.com/')).toBe('import');
  });
});

describe('classifyRemoteResource', () => {
  it('prefers the filename extension', () => {
    expect(classifyRemoteResource('a.stl', 'application/octet-stream')).toBe('STL');
    expect(classifyRemoteResource('a.partwright.json', null)).toBe('JSON');
  });
  it('falls back to Content-Type when the name has no usable extension', () => {
    expect(classifyRemoteResource('download', 'application/json')).toBe('JSON');
    expect(classifyRemoteResource('download', 'image/png')).toBe('IMAGE');
    expect(classifyRemoteResource('download', 'image/svg+xml')).toBe('SVG');
    expect(classifyRemoteResource('download', 'model/step')).toBe('STEP');
  });
  it('returns null for unsupported types', () => {
    expect(classifyRemoteResource('download', 'application/pdf')).toBeNull();
    expect(classifyRemoteResource('download', null)).toBeNull();
  });
});

describe('ensureExtensionForSource', () => {
  it('leaves a matching filename untouched', () => {
    expect(ensureExtensionForSource('a.json', 'JSON')).toBe('a.json');
  });
  it('appends the right extension when the name does not classify', () => {
    expect(ensureExtensionForSource('download', 'JSON')).toBe('download.json');
    expect(ensureExtensionForSource('download', 'IMAGE')).toBe('download.png');
  });
  it('uses a generic base for the fallback name', () => {
    expect(ensureExtensionForSource('import', 'STL')).toBe('import.stl');
  });
});
