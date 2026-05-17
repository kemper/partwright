// Editor lock — locks the code editor when the current version has color regions
// or sculpt strokes applied.
// Provides lock overlay banner and unlock modal with preserve/destructive paths.

import { setReadOnly } from '../editor/codeEditor';
import { hasRegions, clearRegions, serialize as serializeRegions, type SerializedColorRegion } from './regions';
import { hasStrokes, clearStrokes } from '../sculpt/strokes';

let locked = false;
let lockOverlay: HTMLElement | null = null;
let editorContainer: HTMLElement | null = null;
let runButton: HTMLElement | null = null;
let autoRunButton: HTMLElement | null = null;

// Callback to fork the current version (provided by main.ts)
let onUnlockFork: ((colorRegions: SerializedColorRegion[]) => Promise<void>) | null = null;
let onUnlockClear: (() => void) | null = null;

export function setUnlockHandlers(
  forkHandler: (colorRegions: SerializedColorRegion[]) => Promise<void>,
  clearHandler: () => void,
): void {
  onUnlockFork = forkHandler;
  onUnlockClear = clearHandler;
}

export function initEditorLock(container: HTMLElement): void {
  editorContainer = container;
  runButton = document.getElementById('btn-run');
  autoRunButton = document.getElementById('btn-auto-run');
}

export function isLocked(): boolean {
  return locked;
}

/** Sync lock state based on whether regions or sculpt strokes exist. Call
 *  after painting, sculpting, loading, or clearing. */
export function syncLockState(): void {
  const shouldLock = hasRegions() || hasStrokes();
  if (shouldLock === locked) {
    // Even when the overall lock state didn't change, the banner text
    // may need to swap between "color regions" and "sculpt strokes"
    // (e.g. user added strokes to an already-colored version).
    if (locked) refreshLockBanner();
    return;
  }

  locked = shouldLock;
  setReadOnly(locked);

  if (locked) {
    showLockOverlay();
    disableRun();
  } else {
    hideLockOverlay();
    enableRun();
  }
}

function bannerText(): string {
  // Color regions take priority in the banner if both are present —
  // the underlying lock state is the same either way.
  if (hasRegions() && hasStrokes()) {
    return '🔒 This version has color regions and sculpt strokes applied.';
  }
  if (hasStrokes()) return '🔒 This version has sculpt strokes applied.';
  return '🔒 This version has color regions applied.';
}

function refreshLockBanner(): void {
  if (!lockOverlay) return;
  const span = lockOverlay.querySelector('span');
  if (span) span.innerHTML = bannerText();
}

function showLockOverlay(): void {
  if (lockOverlay || !editorContainer) return;

  lockOverlay = document.createElement('div');
  lockOverlay.id = 'editor-lock-overlay';
  lockOverlay.className = 'flex items-center justify-between px-3 py-1.5 bg-amber-900/60 border-b border-amber-500/40 text-xs text-amber-200 shrink-0';

  const msg = document.createElement('span');
  msg.innerHTML = bannerText();

  const unlockBtn = document.createElement('button');
  unlockBtn.className = 'px-2 py-0.5 rounded text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-100 border border-amber-500/40 transition-colors';
  unlockBtn.textContent = 'Unlock to edit';
  unlockBtn.addEventListener('click', showUnlockModal);

  lockOverlay.appendChild(msg);
  lockOverlay.appendChild(unlockBtn);

  // Insert after the editor header (first child of editorContainer's parent)
  const editorPane = editorContainer.parentElement;
  if (editorPane) {
    // Insert before the editor container
    editorPane.insertBefore(lockOverlay, editorContainer);
  }
}

function hideLockOverlay(): void {
  if (lockOverlay) {
    lockOverlay.remove();
    lockOverlay = null;
  }
}

function disableRun(): void {
  if (runButton) {
    (runButton as HTMLButtonElement).disabled = true;
    runButton.classList.add('opacity-40', 'pointer-events-none');
  }
  if (autoRunButton) {
    (autoRunButton as HTMLButtonElement).disabled = true;
    autoRunButton.classList.add('opacity-40', 'pointer-events-none');
  }
}

function enableRun(): void {
  if (runButton) {
    (runButton as HTMLButtonElement).disabled = false;
    runButton.classList.remove('opacity-40', 'pointer-events-none');
  }
  if (autoRunButton) {
    (autoRunButton as HTMLButtonElement).disabled = false;
    autoRunButton.classList.remove('opacity-40', 'pointer-events-none');
  }
}

function showUnlockModal(): void {
  // Backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';

  const modal = document.createElement('div');
  modal.className = 'bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4';

  // Title
  const title = document.createElement('h2');
  title.className = 'text-base font-semibold text-zinc-100 mb-3';
  title.textContent = 'Editing will create a new uncolored version';

  // Explanation
  const explanation = document.createElement('p');
  explanation.className = 'text-sm text-zinc-400 mb-4 leading-relaxed';
  explanation.textContent = 'This version has color regions applied. To edit the code, Partwright will create a new version with the same code but no colors. The colored version stays in your gallery.';

  // Radio options
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'space-y-3 mb-5';

  // Option 1: Preserve (default)
  const opt1 = createRadioOption(
    'unlock-mode',
    'preserve',
    true,
    'Preserve this colored version and create a new version for editing',
    'The colored version stays in your gallery. A new uncolored copy opens in the editor.',
    'text-emerald-400',
  );

  // Option 2: Destructive
  const opt2 = createRadioOption(
    'unlock-mode',
    'destructive',
    false,
    'Remove color regions from this version instead',
    '\u26A0\uFE0F Color regions will be permanently removed. This cannot be undone.',
    'text-red-400',
  );

  optionsContainer.appendChild(opt1.wrapper);
  optionsContainer.appendChild(opt2.wrapper);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'flex justify-end gap-2';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'px-4 py-2 rounded text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => backdrop.remove());

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'px-4 py-2 rounded text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors';
  confirmBtn.textContent = 'Unlock editor';
  confirmBtn.addEventListener('click', async () => {
    const preserveRadio = opt1.wrapper.querySelector('input') as HTMLInputElement;
    const preserve = preserveRadio.checked;

    backdrop.remove();

    if (preserve && onUnlockFork) {
      const colorData = serializeRegions();
      clearRegions();
      clearStrokes();
      syncLockState();
      await onUnlockFork(colorData);
    } else if (!preserve && onUnlockClear) {
      clearRegions();
      clearStrokes();
      syncLockState();
      onUnlockClear();
    }
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);

  modal.appendChild(title);
  modal.appendChild(explanation);
  modal.appendChild(optionsContainer);
  modal.appendChild(btnRow);
  backdrop.appendChild(modal);

  // Close on backdrop click
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  // Close on Escape
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { backdrop.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(backdrop);
}

function createRadioOption(
  name: string,
  value: string,
  checked: boolean,
  label: string,
  description: string,
  labelColor: string,
): { wrapper: HTMLElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'flex items-start gap-3 p-3 rounded-lg border border-zinc-600/50 hover:border-zinc-500 cursor-pointer transition-colors';

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = name;
  radio.value = value;
  radio.checked = checked;
  radio.className = 'mt-0.5 accent-blue-500';

  const textDiv = document.createElement('div');
  const labelEl = document.createElement('div');
  labelEl.className = `text-sm font-medium ${labelColor}`;
  labelEl.textContent = label;

  const descEl = document.createElement('div');
  descEl.className = 'text-xs text-zinc-500 mt-0.5';
  descEl.textContent = description;

  textDiv.appendChild(labelEl);
  textDiv.appendChild(descEl);

  wrapper.appendChild(radio);
  wrapper.appendChild(textDiv);

  return { wrapper };
}
