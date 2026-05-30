// Detect a browser storage-quota-exceeded error across the various shapes
// browsers throw it in. Dependency-free so it can be unit-tested in isolation.
//
// - Chrome/Edge: DOMException with name 'QuotaExceededError'
// - Firefox: DOMException name 'NS_ERROR_DOM_QUOTA_REACHED' (code 1014)
// - Safari: sometimes a plain Error whose message mentions "quota"
// IndexedDB wraps these, so we also sniff the message text as a fallback.
export function isQuotaError(e: unknown): boolean {
  if (e == null) return false;
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof err.name === 'string' ? err.name : '';
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (err.code === 22 || err.code === 1014) return true;
  const message = typeof err.message === 'string' ? err.message : '';
  return /quota/i.test(message);
}
