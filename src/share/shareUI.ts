// DOM widgets for the shareable-link feature: the "copy this link" modal, the
// read-only preview banner, and the viewport overlay. These take callbacks and
// hold NO main.ts / session state — main.ts owns insertion and removal so the
// resource lifecycle (listeners, the thumbnail <img>) stays in one place.
//
// Security: every shared string is rendered via textContent and the thumbnail
// is assigned to img.src ONLY after isSafeImageDataUrl passes — never innerHTML,
// style, or background-image. See src/share/shareLink.ts.

import { showToast } from '../ui/toast';
import { isSafeImageDataUrl } from './shareLink';

/** Above this many encoded bytes, the share modal shows an amber warning that
 *  the link is large (some chat apps / browsers truncate very long URLs). */
const LARGE_SHARE_BYTES = 500_000;

/** Open the "copy your share link" modal. `url` is the full
 *  `${origin}/editor#share=…` link; `encodedBytes` is the encoded payload length
 *  (drives the size readout + large-link warning). Mirrors the editorLock modal
 *  structure and its single leak-free `close()` teardown. */
export function openShareModal(url: string, encodedBytes: number): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4';

  const title = document.createElement('h2');
  title.className = 'text-base font-semibold text-zinc-100 mb-2';
  title.textContent = 'Share a read-only link';

  const explanation = document.createElement('p');
  explanation.className = 'text-sm text-zinc-400 mb-4 leading-relaxed';
  explanation.textContent =
    'This link encodes the current version entirely inside the URL — nothing is uploaded to any server. Anyone who opens it sees a read-only preview and can fork it into their own local copy.';

  // Single teardown for every dismissal path (Copy stays open; Close, backdrop,
  // Escape all run this) so the keydown listener is always removed.
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  // URL field + Copy button row.
  const row = document.createElement('div');
  row.className = 'flex items-stretch gap-2 mb-3';

  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.value = url; // value, never innerHTML
  input.className =
    'flex-1 min-w-0 px-3 py-2 rounded bg-zinc-900 border border-zinc-600 text-xs text-zinc-200 font-mono';
  input.addEventListener('focus', () => input.select());

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  // ≥44px tall touch target for mobile.
  copyBtn.className =
    'shrink-0 min-h-[44px] px-4 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied', { variant: 'success' });
    } catch {
      // Clipboard can be blocked (permissions, insecure context). Fall back to
      // selecting the field so the user can copy manually.
      input.focus();
      input.select();
      showToast('Press Ctrl/Cmd+C to copy', { variant: 'warn' });
    }
  });

  row.append(input, copyBtn);

  // Size readout.
  const sizeKb = Math.max(1, Math.round(encodedBytes / 1024));
  const sizeRow = document.createElement('p');
  sizeRow.className = 'text-xs text-zinc-500 mb-1';
  sizeRow.textContent = `Link size: ~${sizeKb} KB`;

  modal.append(title, explanation, row, sizeRow);

  // Large-link warning (amber), only when the encoded payload is big.
  if (encodedBytes > LARGE_SHARE_BYTES) {
    const warn = document.createElement('p');
    warn.className = 'mt-2 px-3 py-2 rounded bg-amber-900/40 border border-amber-500/40 text-xs text-amber-200 leading-relaxed';
    warn.textContent =
      '⚠️ This link is large. Some chat apps and browsers truncate very long URLs — if the preview fails to open, send the exported .partwright.json file instead.';
    modal.appendChild(warn);
  }

  // Provenance / trust note.
  const trust = document.createElement('p');
  trust.className = 'mt-3 text-[11px] text-zinc-500 leading-relaxed';
  trust.textContent =
    'Only open share links from people you trust. Shared code never runs until you choose to fork it.';
  modal.appendChild(trust);

  const btnRow = document.createElement('div');
  btnRow.className = 'flex justify-end mt-4';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'px-4 py-2 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => close());
  btnRow.appendChild(closeBtn);
  modal.appendChild(btnRow);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);

  // Pre-select the URL so a keyboard copy works immediately.
  input.focus();
  input.select();
}

/** Read-only banner shown above the editor while previewing a shared link.
 *  Returns the element; main.ts owns insertion/removal. */
export function renderSharedBanner(onFork: () => void): HTMLElement {
  const banner = document.createElement('div');
  banner.id = 'shared-preview-banner';
  banner.className =
    'flex items-center justify-between px-3 py-1.5 bg-blue-900/50 border-b border-blue-500/40 text-xs text-blue-100 shrink-0';

  const msg = document.createElement('span');
  msg.textContent = 'Read-only shared preview. Fork it to edit and run.';

  const forkBtn = document.createElement('button');
  forkBtn.type = 'button';
  forkBtn.className =
    'px-2 py-0.5 rounded text-xs bg-blue-500/20 hover:bg-blue-500/40 text-blue-50 border border-blue-500/40 transition-colors';
  forkBtn.textContent = 'Fork to edit';
  forkBtn.addEventListener('click', onFork);

  banner.append(msg, forkBtn);
  return banner;
}

/** Full-viewport overlay for the shared preview: shows the decoded thumbnail (if
 *  safe) and a prominent "Fork to edit & run" CTA. Modeled on viewerMode's
 *  overlay; it both displays the preview image and blocks viewport interaction
 *  (the geometry pipeline stays cold until Fork). Returns the element; main.ts
 *  owns insertion/removal so the <img> is torn down explicitly. */
export function renderSharedOverlay(opts: { thumbnail?: string; onFork: () => void }): HTMLElement {
  const overlay = document.createElement('div');
  overlay.id = 'shared-preview-overlay';
  // Cover the viewport pane only (main.ts mounts it into the viewport),
  // pointer-events on so it intercepts orbit/click on the cold scene.
  overlay.className =
    'absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-zinc-900/80 backdrop-blur-[1px] p-6 text-center';

  const card = document.createElement('div');
  card.className = 'flex flex-col items-center gap-4 max-w-sm w-full';

  if (isSafeImageDataUrl(opts.thumbnail)) {
    const img = document.createElement('img');
    img.alt = 'Shared design preview';
    img.className = 'max-h-64 w-auto rounded-lg border border-zinc-600 bg-zinc-800 object-contain';
    // Assign ONLY to src, ONLY after the safety check above.
    img.src = opts.thumbnail;
    card.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'text-sm text-zinc-400';
    placeholder.textContent = 'No preview image — fork to render this design.';
    card.appendChild(placeholder);
  }

  const cta = document.createElement('button');
  cta.type = 'button';
  cta.className =
    'min-h-[44px] px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg transition-colors';
  cta.textContent = 'Fork to edit & run';
  cta.addEventListener('click', opts.onFork);
  card.appendChild(cta);

  const hint = document.createElement('p');
  hint.className = 'text-[11px] text-zinc-400 leading-relaxed';
  hint.textContent = 'This is a read-only preview. The shared code does not run until you fork it.';
  card.appendChild(hint);

  overlay.appendChild(card);
  return overlay;
}
