// Shared scaffolding for the AI-related modals (key entry, settings,
// compact-confirm). Each used to hand-roll the same overlay, header,
// ✕ button, Escape handler, and click-outside-to-close logic, plus a
// module-level `modalEl` for "close-existing-before-show" — and each
// also leaked one document keydown listener per open/close cycle.
//
// Callers receive an empty body + footer to fill. Opening a new shell
// auto-closes any previous shell, so two of these can never overlap.

export interface ModalShellOptions {
  title: string;
  /** Tailwind max-width fragment without the `max-w-` prefix.
   *  Defaults to `'md'`. Compact-confirm uses `'2xl'`. */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Full Tailwind width class(es) — e.g. `'max-w-lg sm:max-w-3xl'` — that
   *  override {@link maxWidth}. Use this when the panel needs a *responsive*
   *  width (the `maxWidth` enum only expresses a single breakpoint-less size).
   *  Pass the complete `max-w-*` literals so Tailwind's content scanner emits
   *  them. */
  widthClass?: string;
  /** When true, applies `max-h-[80vh]` + `overflow-auto` so long bodies
   *  (e.g. compaction proposal with many notes) scroll. */
  scrollable?: boolean;
  /** Called when the shell is dismissed by Escape, click-outside, the ✕
   *  button, or a programmatic `close()`. Promise-returning modals use
   *  this to resolve with a cancellation value. Fires exactly once. */
  onClose?: () => void;
}

export interface ModalShell {
  /** Empty flex column. Append your form rows, paragraphs, etc. */
  body: HTMLElement;
  /** Empty right-aligned button row with a top divider. Append Cancel /
   *  primary action buttons. */
  footer: HTMLElement;
  /** Tear down the modal. Safe to call multiple times. */
  close: () => void;
}

let currentModal: HTMLElement | null = null;
let modalSeq = 0;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Full, literal Tailwind class names per width. The scanner only emits classes
// it sees as complete literal strings in source, so building this with
// `max-w-${opts.maxWidth}` interpolation left the class invisible to it — and
// `max-w-2xl` (never written literally anywhere else) got purged from the CSS
// entirely, so every `'2xl'` modal silently rendered uncapped at full width.
// Mapping to literals here keeps all sizes — `'2xl'` included — in the build.
const MAX_WIDTH_CLASS: Record<NonNullable<ModalShellOptions['maxWidth']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
}

export function createModalShell(opts: ModalShellOptions): ModalShell {
  // Only one shell modal at a time. Close any previous before showing
  // the new one — the previous shell's Escape listener is removed by
  // its own teardown path so we don't double-leak.
  if (currentModal) {
    currentModal.dispatchEvent(new CustomEvent('shell:force-close'));
  }

  // Remember what was focused so we can restore it when the modal closes.
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const maxW = opts.widthClass ?? MAX_WIDTH_CLASS[opts.maxWidth ?? 'md'];
  const maxH = opts.scrollable ? 'max-h-[calc(100vh-2rem)]' : '';
  const overlayPad = opts.scrollable ? 'p-4' : '';

  const overlay = document.createElement('div');
  overlay.className = `fixed inset-0 bg-black/60 flex items-center justify-center z-50 ${overlayPad}`;

  const titleId = `modal-title-${++modalSeq}`;
  const modal = document.createElement('div');
  modal.className = `bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full ${maxW} ${maxH} flex flex-col`.replace(/\s+/g, ' ').trim();
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', titleId);
  modal.tabIndex = -1;

  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between';
  const titleEl = document.createElement('h2');
  titleEl.id = titleId;
  titleEl.className = 'text-sm font-semibold text-zinc-100';
  titleEl.textContent = opts.title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  const overflowClass = opts.scrollable ? 'overflow-y-auto flex-1 min-h-0' : '';
  body.className = `px-5 py-4 flex flex-col gap-3 text-sm text-zinc-200 ${overflowClass}`.trim();
  modal.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'px-5 py-3 border-t border-zinc-700 flex items-center justify-end gap-2';
  modal.appendChild(footer);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  currentModal = overlay;

  let closed = false;
  const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', escHandler);
  overlay.addEventListener('shell:force-close', () => close());

  // Keep Tab focus inside the dialog so keyboard users can't tab into the
  // (inert) page behind it. Wraps both directions, and pulls focus in if it's
  // currently on the container or has escaped the modal.
  modal.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = focusableIn(modal);
    if (focusables.length === 0) { e.preventDefault(); return; }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? focusables.indexOf(active) : -1;
    if (e.shiftKey && (active === first || idx === -1)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || idx === -1)) {
      e.preventDefault();
      first.focus();
    }
  });

  // Move focus into the dialog on open — but only if the caller hasn't already
  // focused something inside it (e.g. an input via setTimeout), so we don't
  // steal focus from a more intentional target.
  requestAnimationFrame(() => {
    if (closed || modal.contains(document.activeElement)) return;
    (focusableIn(modal)[0] ?? modal).focus();
  });

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    if (currentModal === overlay) currentModal = null;
    // Restore focus to whatever opened the modal, if it's still in the document.
    if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    opts.onClose?.();
  }

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  closeBtn.addEventListener('click', close);

  return { body, footer, close };
}
