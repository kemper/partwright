// Cross-tab synchronization over BroadcastChannel.
//
// All Partwright state lives in this origin's IndexedDB / localStorage, which
// every tab shares. Each tab also keeps in-memory caches (the current session,
// the chat transcript, AI settings) that go stale the instant another tab
// writes the underlying store. This channel lets a tab announce a mutation so
// peer tabs can invalidate their caches and reload from the source of truth.
//
// BroadcastChannel never delivers a message back to the sender, so a publish is
// only ever seen by *other* tabs — no echo-suppression needed. When the API is
// unavailable (older Safari), every function degrades to a no-op and single-tab
// behavior is unaffected.

export type TabSyncMessage =
  /** A version was added to / changed in this session (transcript of edits). */
  | { kind: 'session-versions'; sessionId: string }
  /** Session metadata changed: name, language, images, or AI preference. */
  | { kind: 'session-meta'; sessionId: string }
  /** A session was deleted. */
  | { kind: 'session-deleted'; sessionId: string }
  /** All local sessions/data were wiped. */
  | { kind: 'sessions-cleared' }
  /** The AI chat transcript for this session changed. */
  | { kind: 'chat'; sessionId: string }
  /** Session notes changed. */
  | { kind: 'notes'; sessionId: string };

type Handler = (msg: TabSyncMessage) => void;

const CHANNEL_NAME = 'partwright-sync';

let channel: BroadcastChannel | null = null;
const handlers = new Set<Handler>();

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent<TabSyncMessage>) => {
    const msg = e.data;
    if (!msg || typeof (msg as { kind?: unknown }).kind !== 'string') return;
    for (const fn of handlers) {
      try {
        fn(msg);
      } catch (err) {
        console.warn('tabSync: handler failed', err);
      }
    }
  };
  return channel;
}

/** Announce a mutation to peer tabs. No-op in the originating tab. */
export function publishTabSync(msg: TabSyncMessage): void {
  ensureChannel()?.postMessage(msg);
}

/** Subscribe to mutations published by other tabs. Returns an unsubscribe. */
export function onTabSync(fn: Handler): () => void {
  ensureChannel();
  handlers.add(fn);
  return () => {
    handlers.delete(fn);
  };
}
