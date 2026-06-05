// Pre-apply confirmation for a heavy enhance (mesh refine) whose projected
// triangle count crosses the warn threshold. A model this dense is slow to
// display and edit, and committing it can briefly stutter the page — so the
// Quality panel asks before running. Resolves true to proceed, false to cancel.
//
// This is distinct from the Worker's hard cap: above the *max* the Worker
// refuses outright; between *warn* and *max* we ask the user. The projected
// count is exact for the count knob and approximate (`approx`) for the
// edge-length knob.

import { createModalShell } from './modalShell';
import { BUTTON_PRIMARY, BUTTON_CANCEL } from './styleConstants';

export function showHeavyEnhanceConfirm(opts: {
  projected: number;
  warnLimit: number;
  approx: boolean;
}): Promise<boolean> {
  const { projected, warnLimit, approx } = opts;
  return new Promise((resolve) => {
    let result = false;
    const shell = createModalShell({
      title: 'Apply this heavy enhance?',
      onClose: () => {
        document.removeEventListener('keydown', onEnter);
        resolve(result);
      },
    });

    const block = document.createElement('div');
    block.className = 'rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200 leading-snug';
    block.innerHTML =
      `This enhance will produce ${approx ? 'about ' : ''}<strong>${projected.toLocaleString()}</strong> triangles ` +
      `(over the ${warnLimit.toLocaleString()} heads-up threshold). ` +
      'A model this dense is slower to display and edit, and applying it may briefly stutter the page. ' +
      'You can lower the target or pick a larger edge length to keep it lighter.';
    shell.body.appendChild(block);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = BUTTON_CANCEL;
    cancelBtn.textContent = 'Cancel';
    cancelBtn.setAttribute('data-testid', 'heavy-enhance-cancel');
    cancelBtn.addEventListener('click', () => { result = false; shell.close(); });
    shell.footer.appendChild(cancelBtn);

    const proceedBtn = document.createElement('button');
    proceedBtn.className = BUTTON_PRIMARY;
    proceedBtn.textContent = 'Apply anyway';
    proceedBtn.setAttribute('data-testid', 'heavy-enhance-proceed');
    proceedBtn.addEventListener('click', () => { result = true; shell.close(); });
    shell.footer.appendChild(proceedBtn);

    function onEnter(e: KeyboardEvent): void {
      if (e.key === 'Enter') { e.preventDefault(); result = true; shell.close(); }
    }
    document.addEventListener('keydown', onEnter);

    proceedBtn.focus();
  });
}
