import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCompanionFiles,
  setCompanionFiles,
  addCompanionFile,
  removeCompanionFile,
  updateCompanionFile,
  detectMissingIncludes,
  normalizeCompanionPath,
  companionFilesEqual,
} from '../../src/import/companionFiles';

describe('companion-file registry', () => {
  beforeEach(() => setCompanionFiles({}));

  it('round-trips set/get with a defensive copy', () => {
    const src = { 'a.scad': 'cube();' };
    setCompanionFiles(src);
    expect(getCompanionFiles()).toEqual({ 'a.scad': 'cube();' });
    // Mutating the source object must not bleed into the registry.
    src['b.scad'] = 'sphere();';
    expect(getCompanionFiles()['b.scad']).toBeUndefined();
  });

  it('adds, updates, and removes entries', () => {
    addCompanionFile('lib.scad', 'module m(){}');
    expect(getCompanionFiles()['lib.scad']).toBe('module m(){}');
    updateCompanionFile('lib.scad', 'module m(){ cube(); }');
    expect(getCompanionFiles()['lib.scad']).toBe('module m(){ cube(); }');
    removeCompanionFile('lib.scad');
    expect(getCompanionFiles()['lib.scad']).toBeUndefined();
  });
});

describe('detectMissingIncludes', () => {
  it('extracts both include and use paths', () => {
    const src = 'include <models.scad>\nuse <lib/utils.scad>\ncube();';
    expect(detectMissingIncludes(src)).toEqual(['models.scad', 'lib/utils.scad']);
  });

  it('skips BOSL2 and builtins, strips ./, and dedupes', () => {
    const src = [
      'include <BOSL2/std.scad>',
      'include <builtins.scad>',
      'use <./shared.scad>',
      'include <shared.scad>',
    ].join('\n');
    expect(detectMissingIncludes(src)).toEqual(['shared.scad']);
  });

  it('returns nothing for a file with no includes', () => {
    expect(detectMissingIncludes('cube([1,2,3]);')).toEqual([]);
  });
});

describe('normalizeCompanionPath', () => {
  it('appends .scad when missing', () => {
    expect(normalizeCompanionPath('models')).toBe('models.scad');
  });
  it('keeps an existing .scad extension', () => {
    expect(normalizeCompanionPath('models.scad')).toBe('models.scad');
  });
  it('strips a leading ./ and trims', () => {
    expect(normalizeCompanionPath('  ./lib/utils  ')).toBe('lib/utils.scad');
  });
});

describe('companionFilesEqual', () => {
  it('treats undefined and empty as equal', () => {
    expect(companionFilesEqual(undefined, {})).toBe(true);
    expect(companionFilesEqual({}, undefined)).toBe(true);
  });
  it('is order-independent', () => {
    expect(companionFilesEqual({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
  });
  it('detects content and key differences', () => {
    expect(companionFilesEqual({ a: '1' }, { a: '2' })).toBe(false);
    expect(companionFilesEqual({ a: '1' }, { a: '1', b: '2' })).toBe(false);
  });
});
