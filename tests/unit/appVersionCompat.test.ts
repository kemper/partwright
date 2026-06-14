import { describe, it, expect } from 'vitest';
import {
  parseAppMajor,
  exportedAppVersion,
  appVersionCompatibility,
} from '../../src/storage/appVersionCompat';

describe('parseAppMajor', () => {
  it('reads the major component', () => {
    expect(parseAppMajor('1.0.0')).toBe(1);
    expect(parseAppMajor('2.5.9')).toBe(2);
    expect(parseAppMajor('10.0.0')).toBe(10);
    expect(parseAppMajor('3')).toBe(3);
  });
  it('returns null for unusable values', () => {
    expect(parseAppMajor(undefined)).toBeNull();
    expect(parseAppMajor(null)).toBeNull();
    expect(parseAppMajor('')).toBeNull();
    expect(parseAppMajor('unknown')).toBeNull();
    expect(parseAppMajor('vX')).toBeNull();
  });
});

describe('exportedAppVersion', () => {
  it('prefers the top-level appVersion', () => {
    expect(exportedAppVersion({ appVersion: '1.2.3', versions: [{ appVersion: '1.0.0' }] }))
      .toBe('1.2.3');
  });
  it('falls back to the newest per-version stamp', () => {
    expect(exportedAppVersion({ versions: [{ appVersion: '1.1.0' }, { appVersion: '1.4.2' }, { appVersion: '1.2.0' }] }))
      .toBe('1.4.2');
  });
  it('ignores unknown/empty stamps', () => {
    expect(exportedAppVersion({ appVersion: 'unknown', versions: [{ appVersion: 'unknown' }] }))
      .toBeNull();
    expect(exportedAppVersion({ versions: [{ appVersion: '' }, { appVersion: '2.0.0' }] }))
      .toBe('2.0.0');
  });
  it('returns null when nothing is stamped (pre-1.15 file)', () => {
    expect(exportedAppVersion({})).toBeNull();
    expect(exportedAppVersion({ versions: [{}, {}] })).toBeNull();
  });
});

describe('appVersionCompatibility', () => {
  it('warns when the file is from a newer major', () => {
    const r = appVersionCompatibility({ appVersion: '2.0.0' }, '1.4.0');
    expect(r.relation).toBe('newer');
    expect(r.fileVersion).toBe('2.0.0');
    expect(r.warning).toMatch(/newer major/i);
  });
  it('is silent for an older major (the migration seam)', () => {
    const r = appVersionCompatibility({ appVersion: '1.9.0' }, '2.1.0');
    expect(r.relation).toBe('older');
    expect(r.warning).toBeNull();
  });
  it('is silent within the same major', () => {
    const r = appVersionCompatibility({ appVersion: '1.0.0' }, '1.5.2');
    expect(r.relation).toBe('same');
    expect(r.warning).toBeNull();
  });
  it('is silent/unknown when the file has no stamp', () => {
    const r = appVersionCompatibility({}, '1.0.0');
    expect(r.relation).toBe('unknown');
    expect(r.warning).toBeNull();
  });
  it('is silent/unknown when the running version is unparseable', () => {
    const r = appVersionCompatibility({ appVersion: '2.0.0' }, 'unknown');
    expect(r.relation).toBe('unknown');
    expect(r.warning).toBeNull();
  });
});
