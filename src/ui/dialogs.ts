// Stackable confirm / prompt dialogs — the app's replacement for the native
// `window.confirm` / `window.prompt`, which block the event loop, ignore the
// app's styling and focus model, and never reach the Diagnostic Log.
//
// These intentionally do NOT use `createModalShell`. The shell is a *single*
// modal at a time — opening one force-closes the previous — but a confirmation
// is frequently raised from *inside* another modal (delete a cached model,
// remove an API key, clear the diagnostics log) and must stack on top WITHOUT
// dismissing its parent. So this is a small, self-contained, promise-based
// overlay that:
//   - layers above any modal (`Z_DIALOG` / z-70, vs modals' z-50);
//   - captures Escape at the capture phase and calls stopImmediatePropagation,
//     so a parent modal's (or vanilla overlay's) own bubble-phase Escape
//     handler never also fires and closes the parent underneath it;
//   - traps Tab within the dialog, restores focus on close, and resolves its
//     promise exactly once.
//
// Use `showToast(..., { variant: 'warn' })` for fire-and-forget error notices;
// use these only when you need a blocking yes/no or a text input.

import { OVERLAY_DIALOG, BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_DANGER } from './styleConstants';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let dialogSeq = 0;

interface DialogBase {
  /** Optional heading shown above the message. */
  title?: string;
  /** Confirm button label. Defaults to 'OK'. */
  confirmLabel?: string;
  /** Cancel button label. Defaults to 'Cancel'. */
  cancelLabel?: string;
}

export interface ConfirmOptions extends DialogBase {
  /** Render the confirm button as destructive (red) — for deletes/clears. */
  danger?: boolean;
}

export interface PromptOptions extends DialogBase {
  /** Pre-filled input value. */
  initialValue?: string;
  /** Input placeholder. */
  placeholder?: string;
}

/**
 * Build the shared dialog scaffold. `onSubmit` returns the resolution value for
 * the confirm action (or `undefined` to block submission, e.g. empty prompt);
 * `cancelValue` is what the promise resolves to on Escape / backdrop / Cancel.
 */
function openDialog<T>(
  message: string,
  opts: DialogBase,
  build: (body: HTMLElement, submit: () => void, confirmBtn: HTMLButtonElement) => { focusEl: HTMLElement; onSubmit: () => T | undefined },
  confirmClass: string,
  cancelValue: T,
  resolve: (value: T) => void,
): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  let settled = false;

  const overlay = document.createElement('div');
  overlay.className = OVERLAY_DIALOG;

  const titleId = `dialog-title-${++dialogSeq}`;
  const box = document.createElement('div');
  box.className = 'bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full max-w-sm flex flex-col';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  if (opts.title) box.setAttribute('aria-labelledby', titleId);

  const body = document.createElement('div');
  body.className = 'px-5 py-4 flex flex-col gap-3 text-sm text-zinc-200';
  if (opts.title) {
    const h = document.createElement('h2');
    h.id = titleId;
    h.className = 'text-sm font-semibold text-zinc-100';
    h.textContent = opts.title;
    body.appendChild(h);
  }
  const msg = document.createElement('p');
  msg.className = 'whitespace-pre-line leading-snug';
  msg.textContent = message;
  body.appendChild(msg);
  box.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'px-5 py-3 border-t border-zinc-700 flex items-center justify-end gap-2';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = BUTTON_CANCEL;
  cancelBtn.textContent = opts.cancelLabel ?? 'Cancel';
  const confirmBtn = document.createElement('button');
  confirmBtn.className = confirmClass;
  confirmBtn.textContent = opts.confirmLabel ?? 'OK';
  footer.append(cancelBtn, confirmBtn);
  box.appendChild(footer);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function finish(value: T): void {
    if (settled) return;
    settled = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (previouslyFocused?.isConnected) previouslyFocused.focus();
    resolve(value);
  }

  const submit = () => {
    const v = onSubmit();
    if (v !== undefined) finish(v);
  };

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // Capture + stopImmediatePropagation so a parent modal's own Escape
      // handler doesn't also fire and close the parent beneath us.
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(cancelValue);
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      submit();
    } else if (e.key === 'Tab') {
      const f = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !box.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !box.contains(active))) { e.preventDefault(); first.focus(); }
    }
  }

  const { focusEl, onSubmit } = build(body, submit, confirmBtn);
  cancelBtn.addEventListener('click', () => finish(cancelValue));
  confirmBtn.addEventListener('click', submit);
  overlay.addEventListener('click', e => { if (e.target === overlay) finish(cancelValue); });
  document.addEventListener('keydown', onKey, true);
  requestAnimationFrame(() => { if (!settled) focusEl.focus(); });
}

/** Promise-based replacement for `window.confirm`. Resolves true on confirm,
 *  false on cancel / Escape / backdrop. */
export function confirmDialog(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    openDialog<boolean>(
      message,
      opts,
      (_body, _submit, confirmBtn) => ({ focusEl: confirmBtn, onSubmit: () => true }),
      opts.danger ? BUTTON_DANGER : BUTTON_PRIMARY,
      false,
      resolve,
    );
  });
}

/** Promise-based replacement for `window.prompt`. Resolves the trimmed string
 *  on confirm, or null on cancel / Escape / backdrop / empty input. */
export function promptDialog(message: string, opts: PromptOptions = {}): Promise<string | null> {
  return new Promise<string | null>(resolve => {
    let input: HTMLInputElement;
    openDialog<string | null>(
      message,
      opts,
      (body, submit) => {
        input = document.createElement('input');
        input.type = 'text';
        input.className =
          'w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-blue-500';
        input.value = opts.initialValue ?? '';
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        body.appendChild(input);
        // Match native prompt(): OK resolves the (trimmed) value even when
        // empty; only Cancel / Escape / backdrop resolve null.
        return { focusEl: input, onSubmit: () => input.value.trim() };
      },
      BUTTON_PRIMARY,
      null,
      resolve,
    );
  });
}
