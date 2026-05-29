import { describe, it, expect } from 'vitest';
import { isolationSupported } from '../../src/geometry/isolation';

describe('isolationSupported', () => {
  it('is true only when crossOriginIsolated is true AND SharedArrayBuffer exists', () => {
    expect(isolationSupported({ crossOriginIsolated: true, SharedArrayBuffer: class {} })).toBe(true);
  });

  it('is false when crossOriginIsolated is false', () => {
    expect(isolationSupported({ crossOriginIsolated: false, SharedArrayBuffer: class {} })).toBe(false);
  });

  it('is false when crossOriginIsolated is undefined', () => {
    expect(isolationSupported({ SharedArrayBuffer: class {} })).toBe(false);
  });

  it('is false when SharedArrayBuffer is missing even if isolated', () => {
    expect(isolationSupported({ crossOriginIsolated: true })).toBe(false);
    expect(isolationSupported({ crossOriginIsolated: true, SharedArrayBuffer: undefined })).toBe(false);
  });
});
