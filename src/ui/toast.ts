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

export function showToast(
  message: string,
  opts: {
    variant?: ToastVariant;
    durationMs?: number;
    /** Set false to keep this toast screen-only (skip the Diagnostic Log). */
    log?: boolean;
    /** Subsystem tag for the Diagnostic Log entry (defaults to 'app'). */
    source?: ErrorSource;
  } = {},
): void {
  const {
    variant = 'neutral',
    durationMs = getConfig().ui.toastDurationMs,
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
    'max-width:600px;text-align:center;pointer-events:none;' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.4);' +
    VARIANT_STYLE[variant];
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}
