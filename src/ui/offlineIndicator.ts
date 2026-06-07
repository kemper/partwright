// Global offline indicator.
//
// A small fixed pill that appears only when the browser reports it's offline.
// It reassures the user that the app still works — their work is saved locally
// and modeling keeps running — while explaining that cloud AI is unavailable.
// Hidden (and invisible to tests, which run with navigator.onLine === true)
// whenever there's connectivity, so it's purely additive.
//
// Styling follows the app's persistent-status-pill convention (Tailwind class
// strings + a toggled `hidden` class — see the viewport printability pill in
// main.ts and the AI-panel notices in aiPanel.ts), not inline cssText.

import { onConnectivityChange } from '../util/connectivity';

let pill: HTMLElement | null = null;

export function initOfflineIndicator(): void {
  if (pill) return; // singleton — installed once at boot
  pill = document.createElement('div');
  pill.id = 'offline-indicator';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  pill.className =
    'fixed bottom-3 left-3 z-[9998] hidden items-center gap-1.5 px-2.5 py-1 ' +
    'rounded-full text-xs font-medium pointer-events-none shadow-lg ' +
    'bg-amber-950 text-amber-300 border border-amber-800/60';
  // Dot + label. Modeling and the local AI model keep working; only cloud
  // providers and downloads need the network.
  const dot = document.createElement('span');
  dot.className = 'w-[7px] h-[7px] rounded-full bg-amber-400 inline-block';
  const label = document.createElement('span');
  label.textContent = 'Offline — your work is saved locally';
  pill.append(dot, label);
  document.body.appendChild(pill);

  onConnectivityChange((online) => {
    if (!pill) return;
    // `hidden` (display:none) when online; `flex` when offline — toggled the
    // same way as the panel notices.
    pill.classList.toggle('hidden', online);
    pill.classList.toggle('flex', !online);
  });
}
