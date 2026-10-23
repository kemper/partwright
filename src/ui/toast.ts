// Lightweight, non-blocking toast. A single transient message pinned to the
// bottom-center of the viewport — used for save confirmations and the
// agent-UI warning.
//
// Every toast is also mirrored into the central Diagnostic Log (errorLog) so
// the messaging users see on screen has a durable, reviewable record. The
// fade-away toast is the transient surface; the Diagnostic Log (toolbar ⚠) is
// the history. Variant maps to log level: warn → 'warn', everything else →
// 'info' (routine activity, kept out of the error badge). Pass `log: false`
// for the rare toast that should stay screen-only.

import { getConfig } from '../config/appConfig';
import { errorLog, type ErrorSource } from '../diagnostics/errorLog';

export type ToastVariant = 'neutral' | 'success' | 'warn';

const VARIANT_STYLE: Record<ToastVariant, string> = {
  neutral: 'background:#27272a;color:#e4e4e7;', // zinc-800 / zinc-200
  success: 'background:#052e16;color:#86efac;', // green-950 / green-300
  warn: 'background:#451a03;color:#fbbf24;', // amber-950 / amber-400
};

function coarsePointer(): boolean {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch { return false; }
}

export function showToast(
  message: string,
  opts: {
    variant?: ToastVariant;
    durationMs?: number;
    /** Set false to keep this toast screen-only (skip the Diagnostic Log). */
    log?: boolean;
    /** Subsystem tag for the Diagnostic Log entry (defaults to 'app'). */
    source?: ErrorSource;
    /** An inline button (e.g. "Undo") — clicking it runs `run` and dismisses
     *  the toast. A toast with an action stays up for `ui.undoToastDurationMs`
     *  by default and, unlike a plain toast, takes pointer input. */
    action?: { label: string; run: () => void };
  } = {},
): void {
  const {
    variant = 'neutral',
    action,
    durationMs = action ? getConfig().ui.undoToastDurationMs : getConfig().ui.toastDurationMs,
    log = true,
    source = 'app',
  } = opts;

  // Mirror to the Diagnostic Log so on-screen messaging is reviewable later.
  // warn toasts are problems; success/neutral are routine activity ('info').
  if (log) {
    errorLog.capture({
      level: variant === 'warn' ? 'warn' : 'info',
      source,
      message,
    });
  }

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  toast.style.cssText =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);' +
    'padding:8px 16px;border-radius:6px;font-size:13px;z-index:9999;' +
    'max-width:min(600px,calc(100vw - 32px));text-align:center;' +
    (action ? 'pointer-events:auto;' : 'pointer-events:none;') +
    'box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    VARIANT_STYLE[variant];
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.toastAction = '';
    btn.textContent = action.label;
    btn.style.cssText =
      'margin-left:12px;padding:2px 10px;border-radius:4px;font-weight:600;' +
      'background:rgba(255,255,255,0.12);color:inherit;cursor:pointer;' +
      // A fingertip-sized target on touch screens.
      `min-height:${coarsePointer() ? 44 : 28}px;`;
    btn.addEventListener('click', () => {
      toast.remove();
      action.run();
    });
    toast.appendChild(btn);
  }
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}
