// Pure ring-buffer reconciliation shared by the recent-imports and
// recent-exports inboxes. Both keep an in-memory, newest-first, capped buffer
// that's mirrored to IndexedDB; on boot they merge whatever was persisted back
// into memory. That merge is identical for both, so it lives here as a pure
// function (no IndexedDB, no DOM) — which also makes it unit-testable.

export interface InboxItem {
  id: string;
  timestamp: number;
}

export interface ReconcileResult<T> {
  /** The buffer to keep in memory: newest-first, deduped by id, capped. */
  merged: T[];
  /** Persisted ids that didn't survive the merge/cap and should be evicted
   *  from storage so IndexedDB stays in sync with (and bounded like) memory. */
  staleIds: string[];
}

/**
 * Merge persisted entries back into the in-memory buffer during hydration.
 *
 * - Entries already in memory win over persisted ones with the same id (a fresh
 *   register that raced boot keeps its newer copy).
 * - The union is sorted newest-first and truncated to `cap`.
 * - Any persisted id that falls outside the capped result is reported in
 *   `staleIds` so the caller can delete it (keeps storage bounded even if the
 *   cap shrank between releases, or an overflow eviction was missed).
 */
export function reconcileInbox<T extends InboxItem>(
  inMemory: T[],
  persisted: T[],
  cap: number,
): ReconcileResult<T> {
  const byId = new Map<string, T>();
  for (const e of inMemory) byId.set(e.id, e);
  for (const e of persisted) if (!byId.has(e.id)) byId.set(e.id, e);

  const merged = [...byId.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, Math.max(0, cap));

  const keptIds = new Set(merged.map(e => e.id));
  const staleIds = persisted.filter(e => !keptIds.has(e.id)).map(e => e.id);

  return { merged, staleIds };
}
