// Single-active-writer ("leader") election per session, via a localStorage
// token + the cross-tab `storage` event.
//
// Why not the Web Locks API: locks grant in FIFO order and can't be stolen, so
// an explicit "take control" can't deterministically win, and a reload drops a
// tab's queued request. A localStorage token is last-writer-wins — taking
// control is just writing your id — and the `storage` event notifies the old
// leader instantly so it can step down. A short heartbeat + staleness check
// recovers leadership when a leader tab is closed or silently killed (mobile).
//
// The public surface (onOwnershipChange / acquireSession) is unchanged, so the
// UI keeps consuming "am I the writer?" the same way.

export interface OwnershipState {
  sessionId: string | null;
  owned: boolean;
}

const HEARTBEAT_MS = 3000;
/** A leader is considered dead if its token hasn't been refreshed in this long
 *  (more than two missed heartbeats). */
const STALE_MS = 8000;

const tabId =
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

let currentSessionId: string | null = null;
let owned = false;
let lastEmitted: OwnershipState | null = null;
let initialized = false;

const listeners = new Set<(s: OwnershipState) => void>();

interface LeaderToken {
  tabId: string;
  ts: number;
}

function key(sessionId: string): string {
  return `pw-leader:${sessionId}`;
}

function readToken(sessionId: string): LeaderToken | null {
  try {
    const raw = localStorage.getItem(key(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaderToken;
    if (typeof parsed.tabId === 'string' && typeof parsed.ts === 'number') return parsed;
  } catch {
    // ignore
  }
  return null;
}

function writeToken(sessionId: string): void {
  try {
    localStorage.setItem(key(sessionId), JSON.stringify({ tabId, ts: Date.now() } satisfies LeaderToken));
  } catch {
    // localStorage unavailable (private mode) — degrade to sole leader.
  }
}

function clearOwnToken(sessionId: string): void {
  const tok = readToken(sessionId);
  if (tok && tok.tabId === tabId) {
    try { localStorage.removeItem(key(sessionId)); } catch { /* ignore */ }
  }
}

function isStale(tok: LeaderToken | null): boolean {
  return !tok || Date.now() - tok.ts > STALE_MS;
}

function emit(): void {
  const snapshot: OwnershipState = { sessionId: currentSessionId, owned };
  if (lastEmitted && lastEmitted.sessionId === snapshot.sessionId && lastEmitted.owned === snapshot.owned) {
    return; // no change — don't spam subscribers
  }
  lastEmitted = snapshot;
  for (const fn of listeners) {
    try { fn(snapshot); } catch (err) { console.warn('sessionLock listener failed', err); }
  }
}

export function onOwnershipChange(fn: (s: OwnershipState) => void): () => void {
  listeners.add(fn);
  fn({ sessionId: currentSessionId, owned });
  return () => { listeners.delete(fn); };
}

function becomeLeader(): void {
  if (!currentSessionId) return;
  owned = true;
  writeToken(currentSessionId);
  emit();
  // Compare-after-write: if two tabs claimed near-simultaneously (e.g. two
  // viewers both promoting after a leader died without clearing its token), the
  // later writer's id wins the token. Re-read after a short jittered delay and
  // step down if we lost, so any dual-leader window self-closes within ~300ms.
  const claimed = currentSessionId;
  setTimeout(() => {
    if (!owned || currentSessionId !== claimed) return;
    const tok = readToken(claimed);
    if (tok && tok.tabId !== tabId) becomeViewer();
  }, 80 + Math.floor(Math.random() * 200));
}

function becomeViewer(): void {
  owned = false;
  emit();
}

/** Heartbeat + staleness tick. Always running once initialized: a leader
 *  refreshes its token; a viewer promotes itself if the leader's token has gone
 *  stale (leader tab closed/killed without clearing it). */
function tick(): void {
  if (!currentSessionId) return;
  if (owned) {
    writeToken(currentSessionId);
  } else if (isStale(readToken(currentSessionId))) {
    becomeLeader();
  }
}

/** Attach the cross-tab listeners + heartbeat. Call once at app start. */
export function initSessionLeader(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('storage', (e) => {
    if (!currentSessionId || e.key !== key(currentSessionId)) return;
    const tok = readToken(currentSessionId);
    if (owned) {
      // Someone wrote a different id (took control) → step down.
      if (tok && tok.tabId !== tabId) becomeViewer();
    } else {
      // Leader cleared its token (closed) or it's stale → promote ourselves.
      if (isStale(tok)) becomeLeader();
    }
  });

  // Best-effort: release leadership on close so a peer claims instantly. The
  // staleness check covers the case where this doesn't fire (mobile kill).
  window.addEventListener('pagehide', () => {
    if (owned && currentSessionId) clearOwnToken(currentSessionId);
  });

  setInterval(tick, HEARTBEAT_MS);
}

/** Begin coordinating leadership for `sessionId` (or release when null).
 *  `steal:true` claims leadership unconditionally — used by the "take control"
 *  reload so the new tab deterministically wins. */
export async function acquireSession(sessionId: string | null, opts: { steal?: boolean } = {}): Promise<void> {
  // Drop leadership of any prior session.
  if (owned && currentSessionId && currentSessionId !== sessionId) {
    clearOwnToken(currentSessionId);
  }
  owned = false;
  currentSessionId = sessionId;

  if (!sessionId) {
    emit();
    return;
  }
  if (typeof localStorage === 'undefined') {
    becomeLeader();
    return;
  }

  const tok = readToken(sessionId);
  if (opts.steal || isStale(tok) || (tok && tok.tabId === tabId)) {
    becomeLeader();
  } else {
    becomeViewer();
  }
}
