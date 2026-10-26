// Enter-to-confirm + initial focus for the export confirm dialogs, with a
// guarded mode for dialogs opened programmatically (openTool from the AI or
// the console): the user hasn't looked at the dialog yet, so a stray Enter /
// Space (e.g. still typing in the chat) must not press Export. Guarded, the
// dialog container takes focus (Enter / Space do nothing on it) and
// Enter-to-confirm arms only once the user interacts INSIDE the dialog — a
// pointerdown, or moving focus onto one of its controls (Tab).

export interface DialogConfirmOptions {
  /** Any element inside the modal (its role="dialog" ancestor is used). */
  within: HTMLElement;
  /** The primary (confirm) button — focused on a normal, user-initiated open. */
  primary: HTMLElement;
  onConfirm: () => void;
  /** Opened by openTool (AI / API) rather than by the user. */
  guarded: boolean;
}

/** Wire the keyboard confirm; returns the teardown (call it on close). */
export function armDialogConfirm(opts: DialogConfirmOptions): () => void {
  const dialog = (opts.within.closest('[role="dialog"]') as HTMLElement | null) ?? opts.within;
  let armed = !opts.guarded;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Enter') return;
    if (!armed) return;
    e.preventDefault();
    opts.onConfirm();
  };
  const arm = (): void => { armed = true; };
  const onFocusIn = (e: FocusEvent): void => { if (e.target !== dialog) arm(); };
  document.addEventListener('keydown', onKey);
  if (opts.guarded) {
    dialog.addEventListener('pointerdown', arm, true);
    dialog.addEventListener('focusin', onFocusIn);
    if (dialog.tabIndex < 0 && !dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;
    dialog.focus({ preventScroll: true });
  } else {
    opts.primary.focus();
  }
  return () => {
    document.removeEventListener('keydown', onKey);
    dialog.removeEventListener('pointerdown', arm, true);
    dialog.removeEventListener('focusin', onFocusIn);
  };
}
