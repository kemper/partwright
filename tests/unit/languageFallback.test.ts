import { describe, it, expect } from 'vitest';
import { effectiveVersionLanguage, DEFAULT_LANGUAGE, asLanguage } from '../../src/storage/languageFallback';

describe('effectiveVersionLanguage', () => {
  it('returns the per-version language when set', () => {
    expect(effectiveVersionLanguage({ language: 'scad' }, { language: 'manifold-js' })).toBe('scad');
    expect(effectiveVersionLanguage({ language: 'manifold-js' }, { language: 'scad' })).toBe('manifold-js');
  });

  it('falls back to the session language when the version is untagged', () => {
    // Pre-schema-1.8 versions have no `language` field; the session-level
    // hint is the next signal.
    expect(effectiveVersionLanguage({}, { language: 'scad' })).toBe('scad');
    expect(effectiveVersionLanguage({}, { language: 'manifold-js' })).toBe('manifold-js');
  });

  it('falls back to the default when both are missing', () => {
    // Truly legacy data: neither the version nor the session has a language.
    expect(effectiveVersionLanguage({}, {})).toBe(DEFAULT_LANGUAGE);
    expect(effectiveVersionLanguage(undefined, undefined)).toBe(DEFAULT_LANGUAGE);
    expect(effectiveVersionLanguage(null, null)).toBe(DEFAULT_LANGUAGE);
  });

  it('mixed-language session: each version resolves to its own', () => {
    const session = { language: 'manifold-js' as const };
    const v1 = { language: 'manifold-js' as const };
    const v2 = { language: 'scad' as const };
    // v2 keeps its SCAD tag even though the session-level default is JS —
    // this is what lets a single session hold both engines.
    expect(effectiveVersionLanguage(v1, session)).toBe('manifold-js');
    expect(effectiveVersionLanguage(v2, session)).toBe('scad');
  });

  it('null/undefined version with session hint', () => {
    // No current version yet (fresh part), but the session has a hint.
    expect(effectiveVersionLanguage(null, { language: 'scad' })).toBe('scad');
    expect(effectiveVersionLanguage(undefined, { language: 'scad' })).toBe('scad');
  });

  it('DEFAULT_LANGUAGE is "manifold-js"', () => {
    // Pinned by contract — changing the default would silently re-engine
    // every legacy untagged version.
    expect(DEFAULT_LANGUAGE).toBe('manifold-js');
  });
});

describe('asLanguage', () => {
  it('returns the value when it is a known language', () => {
    expect(asLanguage('manifold-js')).toBe('manifold-js');
    expect(asLanguage('scad')).toBe('scad');
  });

  it('returns undefined for unknown strings', () => {
    // Trust-boundary guard: a malformed .partwright.json could set the
    // field to anything; the importer must filter the value rather than
    // propagating it to the engine and editor.
    expect(asLanguage('python')).toBeUndefined();
    expect(asLanguage('JS')).toBeUndefined();
    expect(asLanguage('')).toBeUndefined();
    expect(asLanguage('Manifold-JS')).toBeUndefined();
  });

  it('returns undefined for non-string values', () => {
    expect(asLanguage(undefined)).toBeUndefined();
    expect(asLanguage(null)).toBeUndefined();
    expect(asLanguage(42)).toBeUndefined();
    expect(asLanguage(true)).toBeUndefined();
    expect(asLanguage({})).toBeUndefined();
    expect(asLanguage(['scad'])).toBeUndefined();
  });
});
