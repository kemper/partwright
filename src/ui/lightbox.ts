// Full-screen image lightbox — click a thumbnail to see it large. Shared by
// the gallery, the Images tab and Annotate's view history.
//
// Every dismissal path (backdrop click, × button, Escape) goes through one
// `close` that removes the DOM and the keydown listener. Escape is caught in
// the capture phase and stopped there, so it closes only the lightbox — not
// the tool panel (Annotate, …) that opened it.

export function showLightbox(src: string, label: string, opts: {
  /** Set the <img> source yourself (e.g. a click-to-load guard for remote
   *  URLs). Default: `img.src = src`. */
  applySrc?: (img: HTMLImageElement, src: string) => void;
} = {}): void {
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', label || 'Image');
  overlay.dataset.lightbox = '';

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const container = document.createElement('div');
  container.className = 'relative max-w-[90vw] max-h-[90vh] flex flex-col items-center';

  const img = document.createElement('img');
  img.className = 'max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl';
  img.alt = label;
  if (opts.applySrc) opts.applySrc(img, src);
  else img.src = src;
  container.appendChild(img);

  if (label) {
    const caption = document.createElement('div');
    caption.className = 'text-sm text-zinc-300 font-mono mt-2';
    caption.textContent = label;
    container.appendChild(caption);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'absolute -top-3 -right-3 w-8 h-8 rounded-full bg-zinc-700 text-zinc-300 hover:bg-zinc-600 flex items-center justify-center text-lg';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', close);
  container.appendChild(closeBtn);

  overlay.appendChild(container);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey, true);
}
