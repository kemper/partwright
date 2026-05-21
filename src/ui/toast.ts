// Lightweight, non-blocking toast. A single transient message pinned to the
// bottom-center of the viewport — used for save confirmations and the
// agent-UI warning.

export type ToastVariant = 'neutral' | 'success' | 'warn';

const VARIANT_STYLE: Record<ToastVariant, string> = {
  neutral: 'background:#27272a;color:#e4e4e7;', // zinc-800 / zinc-200
  success: 'background:#052e16;color:#86efac;', // green-950 / green-300
  warn: 'background:#451a03;color:#fbbf24;', // amber-950 / amber-400
};

export function showToast(
  message: string,
  opts: { variant?: ToastVariant; durationMs?: number } = {},
): void {
  const { variant = 'neutral', durationMs = 2200 } = opts;
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
