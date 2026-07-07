// Per-part progress overlay for multi-part exports. Where the shared
// `progressModal` shows one aggregate bar, a multi-part export bakes many parts
// at once (across a pool of geometry workers), so this modal shows a scrollable
// list with one row per part — each flipping queued → rendering → done / failed
// as the pool works through them — plus an aggregate bar and a Cancel button.
//
// A single part's WASM mesh build reports no incremental progress (it's one
// synchronous kernel call), so a "rendering" row shows an indeterminate animated
// bar rather than a fractional one — honest about what we can actually measure.
//
// Preact + signals, mirroring progressModal.tsx: a singleton mount, module-level
// state, and a handle returned per export so a stale call can't clobber a newer
// one. Shown immediately (no delay) — the user asked to watch parts progress.

import { render } from 'preact';
import { signal, type Signal } from '@preact/signals';

export type ExportPartStatus = 'queued' | 'rendering' | 'done' | 'failed';

interface Row {
  id: string;
  name: string;
  status: ExportPartStatus;
}

interface ExportProgressState {
  id: number;
  title: string;
  rows: Row[];
  onCancel: (() => void) | null;
}

export interface ExportProgressHandle {
  /** Set one part's status. No-op once the handle has ended or been superseded. */
  setStatus(partId: string, status: ExportPartStatus): void;
  /** Replace the modal title (e.g. "Baking parts…" → "Writing 3MF…"). */
  setTitle(title: string): void;
  /** Tear the modal down. Idempotent; a no-op if a newer export took over. */
  end(): void;
}

let nextId = 1;
let current: ExportProgressState | null = null;
const stateSignal: Signal<ExportProgressState | null> = signal(null);
let mountRoot: HTMLDivElement | null = null;

function ensureMount(): void {
  if (mountRoot) return;
  mountRoot = document.createElement('div');
  mountRoot.id = 'export-progress-root';
  document.body.appendChild(mountRoot);

  if (!document.getElementById('export-progress-style')) {
    const style = document.createElement('style');
    style.id = 'export-progress-style';
    style.textContent =
      '@keyframes export-progress-indeterminate {' +
      '0% { transform: translateX(-100%); }' +
      '100% { transform: translateX(400%); }' +
      '}';
    document.head.appendChild(style);
  }

  // Escape cancels — parity with the on-screen Cancel button. Registered once on
  // the singleton mount (capture phase so this top-most modal wins Escape).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const cancel = current?.onCancel;
    if (!cancel) return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  }, true);

  render(<ExportProgressOverlay />, mountRoot);
}

const STATUS_ICON: Record<ExportPartStatus, string> = {
  queued: '·',
  rendering: '',
  done: '✓',
  failed: '✗',
};

const STATUS_COLOR: Record<ExportPartStatus, string> = {
  queued: '#71717a',
  rendering: '#60a5fa',
  done: '#4ade80',
  failed: '#f87171',
};

function PartRow({ row }: { row: Row }) {
  const color = STATUS_COLOR[row.status];
  return (
    <div style="display:flex;align-items:center;gap:10px;padding:4px 0;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;color:#d4d4d8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          {row.name}
        </div>
        <div style="height:4px;border-radius:2px;background:#3f3f46;overflow:hidden;margin-top:3px;">
          {row.status === 'rendering' ? (
            <div style="height:100%;width:30%;background:#60a5fa;animation:export-progress-indeterminate 1.2s linear infinite;" />
          ) : (
            <div
              style={`height:100%;background:${row.status === 'done' ? '#4ade80' : row.status === 'failed' ? '#f87171' : '#3f3f46'};width:${row.status === 'queued' ? 0 : 100}%;transition:width 150ms ease-out;`}
            />
          )}
        </div>
      </div>
      <span
        style={`flex:none;width:14px;text-align:center;font-size:12px;color:${color};`}
        aria-hidden="true"
      >
        {row.status === 'rendering' ? '…' : STATUS_ICON[row.status]}
      </span>
    </div>
  );
}

function ExportProgressOverlay() {
  const st = stateSignal.value;
  if (!st) {
    return (
      <div
        id="export-progress-modal"
        role="dialog"
        aria-modal="true"
        style="position:fixed;inset:0;z-index:9999;display:none;"
      />
    );
  }

  const total = st.rows.length;
  const settled = st.rows.filter(r => r.status === 'done' || r.status === 'failed').length;
  const pct = total > 0 ? Math.round((settled / total) * 100) : 0;

  return (
    <div
      id="export-progress-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-progress-title"
      style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);"
    >
      <div style="min-width:320px;max-width:460px;width:90%;background:#27272a;color:#e4e4e7;border:1px solid #52525b;border-radius:8px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,0.55);display:flex;flex-direction:column;max-height:80vh;">
        <div id="export-progress-title" style="font-size:14px;font-weight:600;margin-bottom:4px;">
          {st.title}
        </div>
        <div style="font-size:12px;color:#a1a1aa;margin-bottom:10px;">
          {settled} of {total} part{total === 1 ? '' : 's'} done
        </div>
        <div style="height:6px;border-radius:3px;background:#3f3f46;overflow:hidden;margin-bottom:12px;">
          <div style={`height:100%;background:#60a5fa;width:${pct}%;transition:width 150ms ease-out;`} />
        </div>
        <div style="overflow-y:auto;flex:1;min-height:0;margin:0 -4px;padding:0 4px;">
          {st.rows.map(row => <PartRow key={row.id} row={row} />)}
        </div>
        {st.onCancel && (
          <div style="display:flex;justify-content:flex-end;margin-top:14px;">
            <button
              type="button"
              data-testid="export-progress-cancel"
              style="background:#3f3f46;color:#f4f4f5;border:0;border-radius:4px;padding:6px 14px;font-size:13px;cursor:pointer;"
              onClick={() => st.onCancel?.()}
            >Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Show the per-part export progress modal. All parts start "queued". Returns a
 *  handle to drive per-part status + the title, and to end (tear down) the modal. */
export function startExportProgress(opts: {
  title: string;
  parts: { id: string; name: string }[];
  onCancel?: () => void;
}): ExportProgressHandle {
  const id = nextId++;
  ensureMount();
  current = {
    id,
    title: opts.title,
    rows: opts.parts.map(p => ({ id: p.id, name: p.name, status: 'queued' as ExportPartStatus })),
    onCancel: opts.onCancel ?? null,
  };
  stateSignal.value = { ...current, rows: current.rows.map(r => ({ ...r })) };

  const isCurrent = () => current !== null && current.id === id;
  const flush = () => {
    if (isCurrent()) stateSignal.value = { ...current!, rows: current!.rows.map(r => ({ ...r })) };
  };

  return {
    setStatus(partId, status) {
      if (!isCurrent()) return;
      const row = current!.rows.find(r => r.id === partId);
      if (!row || row.status === status) return;
      row.status = status;
      flush();
    },
    setTitle(title) {
      if (!isCurrent()) return;
      current!.title = title;
      flush();
    },
    end() {
      if (!isCurrent()) return;
      current = null;
      stateSignal.value = null;
    },
  };
}
