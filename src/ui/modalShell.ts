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
  /** When true, applies `max-h-[80vh]` + `overflow-auto` so long bodies
   *  (e.g. compaction proposal with many notes) scroll. */
  scrollable?: boolean;
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

export function createModalShell(opts: ModalShellOptions): ModalShell {
  // Only one shell modal at a time. Close any previous before showing
  // the new one — the previous shell's Escape listener is removed by
  // its own teardown path so we don't double-leak.
  if (currentModal) {
    currentModal.dispatchEvent(new CustomEvent('shell:force-close'));
  }

  const maxW = `max-w-${opts.maxWidth ?? 'md'}`;
  const maxH = opts.scrollable ? 'max-h-[80vh]' : '';

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';

  const modal = document.createElement('div');
  modal.className = `bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 w-full ${maxW} ${maxH} flex flex-col`.replace(/\s+/g, ' ').trim();

  const header = document.createElement('div');
  header.className = 'px-5 py-3 border-b border-zinc-700 flex items-center justify-between';
  const titleEl = document.createElement('h2');
  titleEl.className = 'text-sm font-semibold text-zinc-100';
  titleEl.textContent = opts.title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'px-2 py-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 text-sm';
  closeBtn.textContent = '✕';
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  const overflowClass = opts.scrollable ? 'overflow-auto' : '';
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

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', escHandler);
    overlay.remove();
    if (currentModal === overlay) currentModal = null;
  }

  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  closeBtn.addEventListener('click', close);

  return { body, footer, close };
}
