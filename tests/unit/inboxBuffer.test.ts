// Unit tests for the pure ring-buffer reconciliation shared by the recent-
// imports and recent-exports inboxes (src/storage/inboxBuffer.ts). No browser
// or IndexedDB — just the merge/cap/dedupe/eviction math that runs on boot.

import { describe, test, expect } from 'vitest';
import { reconcileInbox, type InboxItem } from '../../src/storage/inboxBuffer';

const item = (id: string, timestamp: number): InboxItem => ({ id, timestamp });

describe('reconcileInbox', () => {
  test('on a fresh boot, returns persisted entries newest-first', () => {
    const persisted = [item('a', 100), item('b', 300), item('c', 200)];
    const { merged, staleIds } = reconcileInbox([], persisted, 10);
    expect(merged.map(e => e.id)).toEqual(['b', 'c', 'a']);
    expect(staleIds).toEqual([]);
  });

  test('caps the result and reports the overflow as stale', () => {
    const persisted = [item('a', 1), item('b', 2), item('c', 3), item('d', 4)];
    const { merged, staleIds } = reconcileInbox([], persisted, 2);
    // Newest two survive; the older two are evicted from storage.
    expect(merged.map(e => e.id)).toEqual(['d', 'c']);
    expect(staleIds.sort()).toEqual(['a', 'b']);
  });

  test('in-memory entries win over persisted ones with the same id', () => {
    const inMemory = [{ id: 'a', timestamp: 999 }];
    const persisted = [item('a', 100), item('b', 200)];
    const { merged } = reconcileInbox(inMemory, persisted, 10);
    const a = merged.find(e => e.id === 'a');
    expect(a?.timestamp).toBe(999); // the live copy, not the stale persisted one
    expect(merged.map(e => e.id)).toEqual(['a', 'b']); // 999 > 200, so a is first
  });

  test('merges a registered-during-boot entry with persisted ones', () => {
    const inMemory = [item('new', 500)];
    const persisted = [item('old1', 100), item('old2', 200)];
    const { merged, staleIds } = reconcileInbox(inMemory, persisted, 10);
    expect(merged.map(e => e.id)).toEqual(['new', 'old2', 'old1']);
    expect(staleIds).toEqual([]);
  });

  test('keeps the freshest across both sources when capping', () => {
    const inMemory = [item('live', 50)]; // oldest overall
    const persisted = [item('p1', 100), item('p2', 200)];
    const { merged, staleIds } = reconcileInbox(inMemory, persisted, 2);
    expect(merged.map(e => e.id)).toEqual(['p2', 'p1']);
    // 'live' didn't make the cap and isn't persisted; only persisted ids that
    // were dropped count as stale, so nothing to evict from storage here.
    expect(staleIds).toEqual([]);
  });

  test('empty persisted is a no-op (no stale evictions)', () => {
    const { merged, staleIds } = reconcileInbox([item('a', 1)], [], 10);
    expect(merged.map(e => e.id)).toEqual(['a']);
    expect(staleIds).toEqual([]);
  });

  test('a zero cap evicts every persisted id', () => {
    const persisted = [item('a', 1), item('b', 2)];
    const { merged, staleIds } = reconcileInbox([], persisted, 0);
    expect(merged).toEqual([]);
    expect(staleIds.sort()).toEqual(['a', 'b']);
  });
});
