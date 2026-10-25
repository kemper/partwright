// Engine-sandbox status pill (docs/engine-sandbox.md). A persistent status
// indicator, not a toast: it stays up while the tab's engine sandbox is
// UNAVAILABLE (fail-closed — model code won't run) or BYPASSED (the user chose
// to run without it), and offers the explicit per-tab "Run without sandbox"
// action. Hidden while the sandbox is off or healthy.

import { getEngineSandboxStatus, onEngineSandboxStatusChange, runWithoutEngineSandbox } from '../sandbox/sandboxHost';
import { BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';

/** Mount the pill into `container` (the viewport pane). Singleton for the page. */
export function mountEngineSandboxPill(container: HTMLElement): void {
  const pill = document.createElement('div');
  pill.id = 'engine-sandbox-pill';
  pill.setAttribute('role', 'status');
  pill.className = 'absolute bottom-16 md:bottom-auto md:top-14 left-2 z-20 max-w-[calc(100%-1rem)] flex flex-wrap items-center gap-2 text-xs font-mono bg-zinc-900/90 px-2 py-1 rounded border';
  pill.style.display = 'none';
  const label = document.createElement('span');
  const action = document.createElement('button');
  action.type = 'button';
  action.className = BUTTON_SMALL_SECONDARY + ' font-sans min-h-[44px] md:min-h-0';
  action.textContent = 'Run without sandbox (this tab)';
  action.title = 'Model code will run in a plain Worker that can reach this site\'s saved sessions and AI keys, and the network. Only do this for code you trust. Reload to re-enable the sandbox.';
  action.addEventListener('click', () => {
    if (runWithoutEngineSandbox()) {
      showToast('Engine sandbox bypassed for this tab — re-run your model. Reload to turn the sandbox back on.', { variant: 'warn', source: 'engine', log: false });
    }
  });
  pill.append(label, action);
  container.appendChild(pill);

  let announced = false;
  const render = (): void => {
    const s = getEngineSandboxStatus();
    if (s.state === 'unavailable') {
      pill.style.display = '';
      pill.classList.remove('border-amber-700/60', 'text-amber-300');
      pill.classList.add('border-red-700/60', 'text-red-300');
      label.textContent = '🔒 Engine sandbox unavailable — model code is paused';
      pill.title = `The engine sandbox could not run (${s.unavailableReason}). To keep this site's data safe, model code is blocked in this tab instead of running unsandboxed. Reload to retry, or run without the sandbox if you trust the code.`;
      action.style.display = '';
      if (!announced) {
        announced = true;
        // The Diagnostic Log entry is written by the sandbox host itself.
        showToast(`Engine sandbox unavailable (${s.unavailableReason}) — model code is paused in this tab.`, { variant: 'warn', source: 'engine', log: false });
      }
    } else if (s.state === 'bypassed') {
      pill.style.display = '';
      pill.classList.remove('border-red-700/60', 'text-red-300');
      pill.classList.add('border-amber-700/60', 'text-amber-300');
      label.textContent = '⚠ Running without the engine sandbox (this tab)';
      pill.title = 'You chose to run model code without the engine sandbox in this tab. Reload to turn it back on.';
      action.style.display = 'none';
    } else {
      pill.style.display = 'none';
    }
  };
  onEngineSandboxStatusChange(render);
  render();
}
