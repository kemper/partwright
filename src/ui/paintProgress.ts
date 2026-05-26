// Non-blocking progress indicator for the paint subdivision worker. Shows up
// only when a refine job has been running long enough that the user might
// wonder if the app froze, and offers a Cancel button so they don't have to
// wait it out. The UI is intentionally tiny — a single fixed badge — so it
// doesn't get in the way of a fast paint workflow.

const DEFAULT_SHOW_DELAY_MS = 250;
/** Tests override this to 0 so the badge appears synchronously and the
 *  Cancel-flow assertions don't depend on timing the worker against the
 *  250ms threshold. Production code path always uses the default. */
let showDelayMs = DEFAULT_SHOW_DELAY_MS;
export function __setPaintProgressDelayForTests(ms: number): void {
  showDelayMs = Math.max(0, ms | 0);
}

let host: HTMLDivElement | null = null;
let label: HTMLSpanElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;
let timer: number | null = null;
let onCancelHandler: (() => void) | null = null;

function ensureHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'paint-progress';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  host.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
    'display:none;align-items:center;gap:10px;' +
    'padding:8px 12px 8px 14px;border-radius:6px;font-size:13px;z-index:9999;' +
    'background:#1e293b;color:#e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,0.4);';

  const spinner = document.createElement('span');
  spinner.setAttribute('aria-hidden', 'true');
  spinner.style.cssText =
    'width:12px;height:12px;border-radius:50%;' +
    'border:2px solid rgba(226,232,240,0.25);border-top-color:#e2e8f0;' +
    'display:inline-block;animation:paint-progress-spin 0.8s linear infinite;';
  host.appendChild(spinner);

  label = document.createElement('span');
  label.textContent = 'Painting…';
  host.appendChild(label);

  cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.setAttribute('data-testid', 'paint-progress-cancel');
  cancelBtn.style.cssText =
    'background:#334155;color:#f8fafc;border:0;border-radius:4px;' +
    'padding:3px 10px;font-size:12px;cursor:pointer;';
  cancelBtn.addEventListener('click', () => {
    if (onCancelHandler) onCancelHandler();
  });
  host.appendChild(cancelBtn);

  // One global keyframes block — re-adding is a no-op if it already exists.
  if (!document.getElementById('paint-progress-style')) {
    const style = document.createElement('style');
    style.id = 'paint-progress-style';
    style.textContent = '@keyframes paint-progress-spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }

  document.body.appendChild(host);
  return host;
}

/** Show the progress badge after a short delay (so quick jobs don't flash a
 *  spinner). `onCancel` fires when the Cancel button is clicked — the caller
 *  is responsible for actually aborting the underlying job. */
export function startPaintProgress(opts: { onCancel: () => void; message?: string } = { onCancel: () => {} }): void {
  // Replace any in-flight progress's cancel handler with the new one — a fresh
  // job supersedes the previous (which already aborted) without flashing the
  // badge off and back on.
  onCancelHandler = opts.onCancel;
  const message = opts.message ?? 'Painting…';
  if (label) label.textContent = message;

  if (timer !== null) return; // already pending or visible

  timer = window.setTimeout(() => {
    timer = null;
    const el = ensureHost();
    if (label) label.textContent = message;
    el.style.display = 'flex';
  }, showDelayMs);
}

/** Hide the badge and drop the cancel handler. Safe to call when nothing is
 *  showing. */
export function endPaintProgress(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  onCancelHandler = null;
  if (host) host.style.display = 'none';
}
