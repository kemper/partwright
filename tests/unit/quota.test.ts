import { describe, it, expect } from 'vitest';
import { isQuotaError } from '../../src/storage/quota';

describe('isQuotaError', () => {
  it('detects the Chrome/Edge QuotaExceededError name', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
  });

  it('detects the Firefox quota error name and code', () => {
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ code: 1014 })).toBe(true);
  });

  it('detects the legacy DOMException code 22', () => {
    expect(isQuotaError({ code: 22 })).toBe(true);
  });

  it('falls back to a message containing "quota" (case-insensitive)', () => {
    expect(isQuotaError(new Error('The quota has been exceeded.'))).toBe(true);
    expect(isQuotaError({ message: 'QUOTA full' })).toBe(true);
  });

  it('returns false for unrelated errors and nullish values', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false);
    expect(isQuotaError({ name: 'TypeError' })).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError('a string')).toBe(false);
  });
});
