// Shared progress modal — a centered overlay with a progress bar, optional
// indeterminate spinner, and a Cancel button. Used by both the paint
// subdivision worker and the simplify pipeline so multi-second operations
// feel consistent (and the user always has a way out).
//
// State is module-level and survives any panel close/reopen: closing the
// simplify panel doesn't cancel the apply, and reopening shows the latest
// progress + ultimately the final result without a flicker. Each
// startProgress() call returns a job id; updateProgress / endProgress take
// the id so a stale call from a superseded job can't clobber the active one.
//
// Internals are Preact now (signal drives the bar fill, the message, and
// the Cancel button visibility). Public API unchanged.

import { render } from 'preact';
import { signal, type Signal } from '@preact/signals';

const DEFAULT_SHOW_DELAY_MS = 250;
let showDelayMs = DEFAULT_SHOW_DELAY_MS;

/** Tests override the show delay to 0 so the Cancel button is hittable
 *  without racing the worker. Returns the previous value. */
export function __setProgressModalDelayForTests(ms: number): number {
  const prev = showDelayMs;
  showDelayMs = Math.max(0, ms | 0);
  return prev;
}

interface ProgressJob {
  id: number;
  title: string;
  /** Current fraction in [0,1], or -1 for indeterminate. */
  fraction: number;
  message: string;
  onCancel: (() => void) | null;
}

let nextJobId = 1;
let currentJob: ProgressJob | null = null;
let showTimer: number | null = null;

const jobSignal: Signal<ProgressJob | null> = signal(null);
const visibleSignal: Signal<boolean> = signal(false);
let mountRoot: HTMLDivElement | null = null;

function ensureMount(): void {
  if (mountRoot) return;
  mountRoot = document.createElement('div');
  mountRoot.id = 'progress-modal-root';
  document.body.appendChild(mountRoot);

  // Indeterminate keyframes — one global style block.
  if (!document.getElementById('progress-modal-style')) {
    const style = document.createElement('style');
    style.id = 'progress-modal-style';
    style.textContent =
      '@keyframes progress-modal-indeterminate {' +
      '0% { transform: translateX(-100%); }' +
      '100% { transform: translateX(400%); }' +
      '}';
    document.head.appendChild(style);
  }

  render(<ProgressOverlay />, mountRoot);
}

function ProgressOverlay() {
  const job = jobSignal.value;
  const visible = visibleSignal.value;
  if (!job || !visible) {
    return (
      <div
        id="progress-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-modal-title"
        style="position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);"
      />
    );
  }

  const indeterminate = job.fraction < 0;
  const pct = Math.max(0, Math.min(100, Math.round(job.fraction * 100)));
  const message = job.message || (indeterminate ? 'Working…' : `${pct}%`);
  const fillStyle = indeterminate
    ? 'height:100%;background:#60a5fa;width:25%;animation:progress-modal-indeterminate 1.2s linear infinite;'
    : `height:100%;background:#60a5fa;width:${pct}%;transition:width 120ms ease-out;`;

  return (
    <div
      id="progress-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-modal-title"
      style="position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px);"
    >
      <div style="min-width:300px;max-width:420px;width:90%;background:#27272a;color:#e4e4e7;border:1px solid #52525b;border-radius:8px;padding:18px 20px;box-shadow:0 10px 30px rgba(0,0,0,0.55);">
        <div id="progress-modal-title" style="font-size:14px;font-weight:600;margin-bottom:12px;">
          {job.title}
        </div>
        <div style="height:6px;border-radius:3px;background:#3f3f46;overflow:hidden;margin-bottom:8px;">
          <div style={fillStyle} />
        </div>
        <div style="font-size:12px;color:#a1a1aa;margin-bottom:14px;">{message}</div>
        <div style="display:flex;justify-content:flex-end;">
          {job.onCancel && (
            <button
              type="button"
              data-testid="progress-modal-cancel"
              style="background:#3f3f46;color:#f4f4f5;border:0;border-radius:4px;padding:6px 14px;font-size:13px;cursor:pointer;"
              onClick={() => job.onCancel?.()}
            >Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

function showModalNow(): void {
  if (!currentJob) return;
  ensureMount();
  jobSignal.value = { ...currentJob };
  visibleSignal.value = true;
}

function hideModal(): void {
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  visibleSignal.value = false;
}

/** Start a progress job. Returns a job id callers pass to update/end so a
 *  stale completion from a superseded job can't dismiss the new one. */
export function startProgress(opts: {
  title: string;
  onCancel?: () => void;
  /** True for an indeterminate spinner (paint subdivision doesn't currently
   *  report incremental progress). False for a determinate bar fed by
   *  updateProgress(). */
  indeterminate?: boolean;
  message?: string;
}): number {
  const id = nextJobId++;
  currentJob = {
    id,
    title: opts.title,
    fraction: opts.indeterminate ? -1 : 0,
    message: opts.message ?? '',
    onCancel: opts.onCancel ?? null,
  };

  // A fresh job clears any pending show-timer from the previous one.
  if (showTimer !== null) {
    clearTimeout(showTimer);
    showTimer = null;
  }

  if (showDelayMs <= 0) {
    showModalNow();
  } else {
    showTimer = window.setTimeout(() => {
      showTimer = null;
      if (currentJob && currentJob.id === id) showModalNow();
    }, showDelayMs);
  }

  return id;
}

/** Update an in-flight job's progress. Ignored if `id` doesn't match. */
export function updateProgress(id: number, fraction: number, message?: string): void {
  if (!currentJob || currentJob.id !== id) return;
  currentJob.fraction = fraction;
  if (message !== undefined) currentJob.message = message;
  if (visibleSignal.value) jobSignal.value = { ...currentJob };
}

/** End a job. Ignored if `id` doesn't match — a superseding startProgress()
 *  has already taken over the modal, so dismissing it now would hide the
 *  active job. */
export function endProgress(id: number): void {
  if (!currentJob || currentJob.id !== id) return;
  currentJob = null;
  hideModal();
}

/** True when a progress job is in flight (badge may not be visible yet —
 *  it waits out the show delay). */
export function isProgressActive(): boolean {
  return currentJob !== null;
}

/** Read the active job's title + current fraction. Used by panels (simplify)
 *  that want to mirror the modal's state into their own status line on
 *  reopen — purely a query, no side-effects. */
export function getCurrentProgress(): { title: string; fraction: number; message: string } | null {
  if (!currentJob) return null;
  return { title: currentJob.title, fraction: currentJob.fraction, message: currentJob.message };
}
