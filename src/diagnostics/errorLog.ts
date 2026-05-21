// Central diagnostic log. Collects errors and warnings from all subsystems
// into a single ring buffer, persisted to sessionStorage so entries survive
// a page refresh within the same browser tab.
//
// Call errorLog.install() once at app startup to wire up:
//   - window.onerror / unhandledrejection (uncaught JS errors)
//   - console.error / console.warn interception (existing callsites free-ride)
//
// Subsystems that don't go through console (e.g. geometry engine, AI turns)
// should call errorLog.capture() directly with an explicit source tag.

export type ErrorLevel = 'error' | 'warn';
export type ErrorSource =
  | 'engine'
  | 'ai'
  | 'import'
  | 'export'
  | 'storage'
  | 'network'
  | 'app'
  | 'uncaught';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: ErrorLevel;
  source: ErrorSource;
  message: string;
  /** Stack trace or extended diagnostic text. */
  detail?: string;
}

type Subscriber = (entries: readonly LogEntry[]) => void;

const MAX_ENTRIES = 200;
const STORAGE_KEY = 'partwright-error-log-v1';

function argsToString(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

// Best-effort origin trace for an intercepted console.error/warn. Prefers the
// stack of a real Error argument; otherwise synthesizes a call-site stack so
// the log can answer "where did this come from" even for plain-string warnings
// (e.g. a third-party library's deprecation notice). Frames inside this module
// (the console override + this helper) are stripped so the trace starts at the
// real caller.
function detailFromArgs(args: unknown[]): string | undefined {
  for (const a of args) {
    if (a instanceof Error && a.stack) return a.stack;
  }
  const raw = new Error().stack;
  if (!raw) return undefined;
  const cleaned = raw
    .split('\n')
    .filter((l) => l.trim() && l.trim() !== 'Error' && !l.includes('errorLog'))
    .join('\n')
    .trim();
  return cleaned || undefined;
}

class ErrorLogStore {
  private _entries: LogEntry[] = [];
  private _subscribers = new Set<Subscriber>();
  // Prevents re-entrant console captures triggered during subscriber notification.
  private _inNotify = false;

  constructor() {
    this._restore();
  }

  /** Wire up global error handlers and console interception. Call once at startup. */
  install(): void {
    window.addEventListener('error', (e) => {
      const where = e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : undefined;
      this.capture({
        level: 'error',
        source: 'uncaught',
        message: e.message || 'Uncaught error',
        detail: e.error instanceof Error ? e.error.stack : where,
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      this.capture({
        level: 'error',
        source: 'uncaught',
        message:
          r instanceof Error
            ? r.message
            : `Unhandled rejection: ${String(r)}`,
        detail: r instanceof Error ? r.stack : undefined,
      });
    });

    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    const self = this;

    console.error = function (...args: unknown[]) {
      origError(...args);
      if (!self._inNotify) {
        self.capture({
          level: 'error',
          source: 'app',
          message: argsToString(args),
          detail: detailFromArgs(args),
        });
      }
    };

    console.warn = function (...args: unknown[]) {
      origWarn(...args);
      if (!self._inNotify) {
        self.capture({
          level: 'warn',
          source: 'app',
          message: argsToString(args),
          detail: detailFromArgs(args),
        });
      }
    };
  }

  /** Add an entry to the log and notify subscribers. */
  capture(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    const full: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ...entry,
    };
    this._entries.unshift(full);
    if (this._entries.length > MAX_ENTRIES) this._entries.length = MAX_ENTRIES;
    this._persist();
    this._notify();
  }

  getEntries(): readonly LogEntry[] {
    return this._entries;
  }

  clear(): void {
    this._entries = [];
    this._persist();
    this._notify();
  }

  /** Subscribe to log changes. Returns an unsubscribe function. */
  subscribe(fn: Subscriber): () => void {
    this._subscribers.add(fn);
    return () => {
      this._subscribers.delete(fn);
    };
  }

  private _notify(): void {
    this._inNotify = true;
    try {
      for (const fn of this._subscribers) fn(this._entries);
    } finally {
      this._inNotify = false;
    }
  }

  private _persist(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this._entries));
    } catch {
      // Quota exceeded — silently drop persistence.
    }
  }

  private _restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) this._entries = JSON.parse(raw) as LogEntry[];
    } catch {
      // Corrupt storage — start fresh.
    }
  }
}

export const errorLog = new ErrorLogStore();
