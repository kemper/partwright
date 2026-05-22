// Single-active-writer coordination per session, built on the Web Locks API.
//
// When the same session is open in two tabs, only one should be the active
// writer (driving the AI chat and saving versions); the other becomes a
// read-only viewer that live-updates via tabSync. This avoids two chat loops
// corrupting one transcript and two editors clobbering each other.
//
// Ownership transfers cooperatively. A viewer keeps a *waiting* lock request
// queued; when the owner releases (it closed, navigated away, or honored a
// takeover request) the waiter is granted the lock and is promoted to owner.
// "Take over" is a tabSync message asking the current owner to release.
//
// Where the Web Locks API is unavailable, every tab is treated as the owner so
// single-writer behavior degrades to today's last-write-wins (still safe for
// the common "two independent sessions" case).

import { onTabSync, publishTabSync } from './tabSync';

export interface OwnershipState {
  sessionId: string | null;
  owned: boolean;
}

let currentSessionId: string | null = null;
let owned = false;
let release: (() => void) | null = null;
/** Bumped on every acquireSession so stale lock callbacks (from a session we've
 *  since switched away from) can detect they've been superseded and bail. */
let generation = 0;

const listeners = new Set<(s: OwnershipState) => void>();

function emit(): void {
  const snapshot: OwnershipState = { sessionId: currentSessionId, owned };
  for (const fn of listeners) {
    try { fn(snapshot); } catch (err) { console.warn('sessionLock listener failed', err); }
  }
}

export function onOwnershipChange(fn: (s: OwnershipState) => void): () => void {
  listeners.add(fn);
  fn({ sessionId: currentSessionId, owned });
  return () => { listeners.delete(fn); };
}

export function isWriteOwner(): boolean {
  return owned;
}

function locksSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.locks;
}

function lockName(id: string): string {
  return `partwright-session-write:${id}`;
}

function releaseCurrent(): void {
  if (release) {
    release();
    release = null;
  }
  owned = false;
}

/** Begin coordinating write-ownership for `sessionId` (or release everything
 *  when null). Resolves once initial ownership is known. If another tab owns
 *  it, a waiting request is left queued so we're promoted when they release. */
export async function acquireSession(sessionId: string | null): Promise<void> {
  releaseCurrent();
  currentSessionId = sessionId;
  owned = false;

  if (!sessionId) {
    emit();
    return;
  }
  if (!locksSupported()) {
    // No Web Locks — assume sole ownership.
    owned = true;
    emit();
    return;
  }

  const gen = ++generation;

  const gotIt = await new Promise<boolean>((resolve) => {
    navigator.locks
      .request(lockName(sessionId), { ifAvailable: true }, (lock) => {
        if (gen !== generation) return; // superseded mid-request
        if (!lock) {
          resolve(false);
          return;
        }
        owned = true;
        resolve(true);
        // Hold the lock until releaseCurrent() resolves this promise.
        return new Promise<void>((rel) => { release = rel; });
      })
      .catch(() => resolve(false));
  });

  if (gen !== generation) return; // switched sessions while acquiring
  emit();
  if (gotIt) return;

  // We're a viewer. Queue a *waiting* request; it resolves into ownership when
  // the current owner releases (close / navigate / honored takeover).
  navigator.locks
    .request(lockName(sessionId), () => {
      if (gen !== generation) return; // switched away while waiting
      owned = true;
      emit();
      return new Promise<void>((rel) => { release = rel; });
    })
    .catch(() => {});
}

/** Ask the current owner of the open session to hand the lock over. The owner
 *  releases; our queued waiting request is then granted. */
export function requestTakeover(): void {
  if (currentSessionId && !owned) {
    publishTabSync({ kind: 'takeover', sessionId: currentSessionId });
  }
}

let takeoverWired = false;

/** Wire the owner side of takeover handling. Call once at app start. */
export function initSessionLockTakeover(): void {
  if (takeoverWired) return;
  takeoverWired = true;
  onTabSync((msg) => {
    if (msg.kind !== 'takeover') return;
    if (msg.sessionId !== currentSessionId || !owned) return;
    // Honor the request: release so the asker's queued request wins, then
    // re-queue ourselves as a viewer-waiter so we can reclaim it later.
    const id = currentSessionId;
    releaseCurrent();
    emit();
    void acquireSession(id);
  });
}
